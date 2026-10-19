import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import { useSettingsStore } from "../stores/settings";
import { AGENT_PRESETS, useAgentsStore } from "../stores/agents";
import type { AgentConfig } from "../types";

vi.mock("../api", () => ({
  api: {
    setSetting: vi.fn(async () => {}),
    syncTunnels: vi.fn(async () => {}),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

function agent(partial: Partial<AgentConfig> & Pick<AgentConfig, "id">): AgentConfig {
  return {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "--resume",
    timeoutSecs: 120,
    enabled: true,
    workdir: "",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

describe("agents store：与设置键 ai_agents 双向同步", () => {
  it("load 解析设置键，旧配置缺 workdir 归一成空串、缺 skillDir 归一成 null", () => {
    const settings = useSettingsStore();
    settings.values.ai_agents = JSON.stringify([agent({ id: "a1", workdir: undefined }), { legacy: true }]);
    const store = useAgentsStore();
    store.load();
    expect(store.list).toHaveLength(2);
    expect(store.list[0].workdir).toBe("");
    expect(store.list[0].skillDir).toBeNull();
  });

  it("load 容错：非法 JSON / 非数组归一成空列表", () => {
    const settings = useSettingsStore();
    const store = useAgentsStore();
    settings.values.ai_agents = "{oops";
    store.load();
    expect(store.list).toEqual([]);
    settings.values.ai_agents = '"just a string"';
    store.load();
    expect(store.list).toEqual([]);
  });

  it("save 序列化写回 values.ai_agents 并落库：deployment 空白归一 null（本机执行）、技能目录空白归一 null", async () => {
    const store = useAgentsStore();
    store.list = [
      agent({ id: "a1", deployment: "  gpu-1  " }),
      agent({ id: "a2" }),
      agent({ id: "a3", skillDir: "  " }),
      agent({ id: "a4", skillDir: "~/my-skills" }),
    ];
    await store.save();
    const settings = useSettingsStore();
    const saved = JSON.parse(settings.values.ai_agents);
    expect(saved[0].deployment).toBe("gpu-1");
    expect(saved[1].deployment).toBeNull();
    expect(saved[2].skillDir).toBeNull();
    expect(saved[3].skillDir).toBe("~/my-skills");
    expect(api.setSetting).toHaveBeenCalledWith("ai_agents", settings.values.ai_agents);
    expect(api.setSetting).toHaveBeenCalledWith("ai_agent_id", "");
  });

  it("save → load 往返：字段不丢、绑定归一结果稳定", async () => {
    const store = useAgentsStore();
    store.list = [agent({ id: "a1", deployment: " gpu-1 " })];
    await store.save();
    store.load();
    expect(store.list[0]).toMatchObject({
      id: "a1",
      command: "claude",
      workdir: "",
      deployment: "gpu-1",
    });
  });
});

describe("agents store：按预设新增", () => {
  it("add 按预设新增：command/args/historyArgs 就位，超时 120 秒且默认启用", () => {
    const store = useAgentsStore();
    store.add("claude");
    expect(store.list).toHaveLength(1);
    expect(store.list[0]).toMatchObject({
      name: "Claude Code",
      command: "claude",
      args: AGENT_PRESETS.claude.args,
      historyArgs: "--resume",
      timeoutSecs: 120,
      enabled: true,
      workdir: "",
    });
    expect(store.list[0].id).toBeTruthy();
  });

  it("add dsh 预设：DeepSeek Harness 无头走 headless profile，提示词经 stdin（无 {prompt} 占位符）", () => {
    const store = useAgentsStore();
    store.add("dsh");
    expect(store.list[0]).toMatchObject({
      name: "DeepSeek Harness",
      command: "dsh",
      args: "--profile headless",
      historyArgs: "",
    });
    expect(store.list[0].args).not.toContain("{prompt}");
  });

  it("add 未知预设键回落 custom；同名预设自动编号去重", () => {
    const store = useAgentsStore();
    store.add("nonexistent");
    store.add("claude");
    store.add("claude");
    store.add("claude");
    expect(store.list.map((a) => a.name)).toEqual(["", "Claude Code", "Claude Code 2", "Claude Code 3"]);
    expect(store.list[0]).toMatchObject({ command: "", args: "{prompt}" });
  });
});

describe("agents store：CRUD 与去重", () => {
  it("dedupeName：无冲突原样返回，冲突加序号后缀", () => {
    const store = useAgentsStore();
    expect(store.dedupeName("")).toBe("");
    expect(store.dedupeName("pi")).toBe("pi");
    store.list = [agent({ id: "a1", name: "pi" }), agent({ id: "a2", name: "pi 2" })];
    expect(store.dedupeName("pi")).toBe("pi 3");
  });

  it("remove 删除条目；「用于收音机分类」正指向它时清空，指向他人时保留", () => {
    const settings = useSettingsStore();
    const store = useAgentsStore();
    store.list = [agent({ id: "a1" }), agent({ id: "a2" })];
    settings.values.ai_agent_id = "a1";
    store.remove("a1");
    expect(store.list.map((a) => a.id)).toEqual(["a2"]);
    expect(settings.values.ai_agent_id).toBe("");
    settings.values.ai_agent_id = "a2";
    store.remove("a1"); // 已不存在，无副作用
    expect(settings.values.ai_agent_id).toBe("a2");
  });
});
