import { defineStore } from "pinia";
import { api } from "../api";
import type { AgentConfig, AgentSkillStatus, TunnelStatus } from "../types";
import { useSettingsStore } from "./settings";

/**
 * 无头调用约定的预设：{prompt} 占位符由应用替换为提示词；没有占位符时提示词经标准输入传入。
 * claude 带 --output-format json：stdout 变 JSON 信封（含 session_id/成本），应用解信封后
 * 会话回链自动落库；pi 的 -r 是会话选择器（按 id 恢复时后端自动换成 --session <id>）
 */
export const AGENT_PRESETS: Record<string, Omit<AgentConfig, "id" | "timeoutSecs" | "enabled">> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt} --allowedTools Bash(pk:*) --output-format json",
    historyArgs: "--resume",
  },
  opencode: { name: "OpenCode", command: "opencode", args: "run {prompt}", historyArgs: "" },
  pi: { name: "pi", command: "pi", args: "-p {prompt}", historyArgs: "-r" },
  custom: { name: "", command: "", args: "{prompt}", historyArgs: "" },
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * AI agent CLI 域状态（从 SettingsTab 上移）：列表与设置键 ai_agents 的双向同步、
 * CRUD 与重名去重、常驻隧道状态与 pk 技能状态（跨分区切换不丢失）。
 */
export const useAgentsStore = defineStore("agents", {
  state: () => ({
    list: [] as AgentConfig[],
    /** agent 的 pk 技能检查结果（id → 状态；检查/安装时更新） */
    skillStatus: {} as Record<string, AgentSkillStatus>,
    /** 常驻反向隧道状态（id → 后端 tunnel_status） */
    tunnelStates: {} as Record<string, TunnelStatus>,
  }),
  actions: {
    /** 从设置键解析 agent 列表（旧配置无 workdir 字段归一成空串，输入框受控；残留的 mode 字段（对接方式已下线）忽略） */
    load() {
      const settings = useSettingsStore();
      try {
        const parsed = JSON.parse(settings.sget("ai_agents") || "[]");
        this.list = Array.isArray(parsed)
          ? parsed.map((a: AgentConfig): AgentConfig => ({ ...a, workdir: a.workdir ?? "" }))
          : [];
      } catch {
        this.list = [];
      }
    },
    /**
     * 把编辑中的 agent 列表序列化进设置并落库（隧道端口空值归一成 null，空串会让后端反序列化失败）；
     * 落库后对齐常驻隧道集合（开关/启停的增删在这生效，失败静默——保存本身不因此报错）
     */
    async save() {
      const settings = useSettingsStore();
      settings.values.ai_agents = JSON.stringify(
        this.list.map((a) => ({
          ...a,
          remote: a.remote
            ? { ...a.remote, tunnel: a.remote.tunnel || null, persistent: a.remote.persistent || false }
            : null,
        })),
      );
      await settings.save(["ai_agents", "ai_agent_id"]);
      await api.syncTunnels().catch(() => {});
      this.loadTunnelStatuses();
    },
    /** 预设名已被占用时加序号后缀（如 Claude Code 2）：同类型配多个（本地 + 远程）时列表仍可辨 */
    dedupeName(base: string): string {
      if (!base || !this.list.some((a) => a.name === base)) return base;
      let n = 2;
      while (this.list.some((a) => a.name === `${base} ${n}`)) n++;
      return `${base} ${n}`;
    },
    /** 按预设新增一个 agent（未知预设键回落 custom） */
    add(presetKey: string) {
      const preset = AGENT_PRESETS[presetKey] ?? AGENT_PRESETS.custom;
      this.list.push({
        id: newId(),
        timeoutSecs: 120,
        enabled: true,
        workdir: "",
        ...preset,
        name: this.dedupeName(preset.name),
      });
    },
    /** 删除 agent；「用于收音机分类」正指向它时一并清空 */
    remove(id: string) {
      const settings = useSettingsStore();
      this.list = this.list.filter((a) => a.id !== id);
      if (settings.values.ai_agent_id === id) settings.values.ai_agent_id = "";
    },
    /** 拉单个 agent 的常驻隧道状态（失败清掉旧条目，回退「未知」） */
    refreshTunnel(id: string) {
      if (!id) return;
      api
        .tunnelStatus(id)
        .then((s) => {
          this.tunnelStates[id] = s;
        })
        .catch(() => {
          delete this.tunnelStates[id];
        });
    },
    /** 刷新所有开了常驻隧道的 agent 状态（设置页进入/保存后调用） */
    loadTunnelStatuses() {
      this.list.filter((a) => a.remote?.persistent).forEach((a) => this.refreshTunnel(a.id));
    },
  },
});
