import { defineStore } from "pinia";
import type { AgentConfig, AgentSkillStatus } from "../types";
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
  // DeepSeek Harness：无头走 headless profile（不带 {prompt}，提示词经 stdin——本地与
  // SSH 远程同构）；交互入口由 desktop/web profile 自带会话列表，历史参数留空直接启动
  dsh: { name: "DeepSeek Harness", command: "dsh", args: "--profile headless", historyArgs: "" },
  custom: { name: "", command: "", args: "{prompt}", historyArgs: "" },
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * AI agent CLI 域状态（从 SettingsTab 上移）：列表与设置键 ai_agents 的双向同步、
 * CRUD 与重名去重、pk 技能状态（跨分区切换不丢失）。远程执行经部署绑定
 * （ADR-0003）：隧道/部署状态归 deployments store。
 */
export const useAgentsStore = defineStore("agents", {
  state: () => ({
    list: [] as AgentConfig[],
    /** agent 的 pk 技能检查结果（id → 状态；检查/安装时更新） */
    skillStatus: {} as Record<string, AgentSkillStatus>,
  }),
  actions: {
    /** 从设置键解析 agent 列表（旧配置无 workdir 字段归一成空串、skillDir 归一成 null，输入框受控；残留的 mode 字段（对接方式已下线）忽略） */
    load() {
      const settings = useSettingsStore();
      try {
        const parsed = JSON.parse(settings.sget("ai_agents") || "[]");
        this.list = Array.isArray(parsed)
          ? parsed.map((a: AgentConfig): AgentConfig => ({
              ...a,
              workdir: a.workdir ?? "",
              skillDir: a.skillDir ?? null,
            }))
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
          // 技能目录空串归一成 null（后端空白视为未指定，落库前先清干净）；
          // 部署绑定空白归一 null（本机执行——ADR-0003 执行世界单源）
          skillDir: a.skillDir?.trim() || null,
          deployment: a.deployment?.trim() || null,
        })),
      );
      await settings.save(["ai_agents", "ai_agent_id"]);
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
  },
});
