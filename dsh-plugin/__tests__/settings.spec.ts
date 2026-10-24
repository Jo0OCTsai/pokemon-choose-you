/**
 * domain/settings：36 键集与主应用逐字一致断言、读写与校验、agent 列表整读-改-整写
 * （修订检测/force/空 command/删除联动清 ai_agent_id）、提示词覆盖 4 键全行为矩阵。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentDelete,
  agentUpsert,
  getSetting,
  loadAgents,
  primaryAgent,
  readSettings,
  SETTING_KEYS,
  setSetting,
  validateConfigWrite,
  writeSettings,
  type AgentConfig,
} from "../src/host/domain/settings";
import {
  PROMPT_KEY_PREFIX,
  PROMPT_MAX_CHARS,
  PROMPT_SPECS,
  promptGet,
  promptList,
  promptOverride,
  promptReset,
  resolveOverride,
  scanUnknownPlaceholders,
} from "../src/host/domain/prompt-overrides";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function agent(partial: Partial<AgentConfig>): AgentConfig {
  return {
    id: "a1",
    name: "Claude",
    command: "claude",
    args: "",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 120,
    enabled: true,
    ...partial,
  };
}

describe("36 共享设置键（配置 100% 对齐，§8⑨）", () => {
  it("键集与主应用 src/stores/settings.ts SETTING_KEYS 逐字一致（含顺序）", () => {
    const source = readFileSync(join(import.meta.dirname, "../../src/stores/settings.ts"), "utf8");
    const match = /export const SETTING_KEYS = \[([\s\S]*?)\];/.exec(source);
    expect(match).not.toBeNull();
    const mainAppKeys = (match as RegExpExecArray)[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((s) => s.replace(/^"|"$/g, ""));
    expect([...SETTING_KEYS]).toEqual(mainAppKeys);
    expect(SETTING_KEYS.length).toBe(36);
    expect(new Set(SETTING_KEYS).size).toBe(36);
  });

  it("readSettings / writeSettings 读写往返；缺键不出现", () => {
    writeSettings(db.conn, { language: "en", dispatch_max_concurrent: "2" });
    expect(readSettings(db.conn, ["language"])).toEqual({ language: "en" });
    expect(getSetting(db.conn, "dispatch_max_concurrent")).toBe("2");
    expect(readSettings(db.conn, ["feishu_enabled"])).toEqual({});
    expect(readSettings(db.conn).language).toBe("en");
  });
});

describe("36 共享设置键（配置 100% 对齐，§8⑨）·下", () => {
  it("写入校验：数值键必须正整数、时钟键 HH:MM、空键拒绝（CONFIG_VALIDATION_FAILED）", () => {
    const cases: Array<Record<string, string>> = [
      { feishu_poll_interval: "0" },
      { feishu_poll_interval: "abc" },
      { dispatch_max_concurrent: "-1" },
      { quiet_start: "8:00" },
      { quiet_end: "9点" },
      { "  ": "v" },
    ];
    for (const kv of cases) {
      expect(() => writeSettings(db.conn, kv)).toThrowError(PkyError);
      try {
        validateConfigWrite(kv);
      } catch (e) {
        expect((e as PkyError).code).toBe("CONFIG_VALIDATION_FAILED");
      }
    }
    // 整批原子：校验失败时前序键也不写
    expect(() => writeSettings(db.conn, { language: "zh-Hant", backup_keep: "x" })).toThrowError();
    expect(getSetting(db.conn, "language")).toBeNull();
  });

  it("dsh: 内部键与 ai_prompt_* 旁路键同路可写可读（主应用 get_setting/set_setting 同口径）", () => {
    setSetting(db.conn, "dsh:focus_settled", "[]");
    setSetting(db.conn, "ai_prompt_pet_chat", "x");
    expect(getSetting(db.conn, "dsh:focus_settled")).toBe("[]");
    expect(readSettings(db.conn, ["ai_prompt_pet_chat"])).toEqual({ ai_prompt_pet_chat: "x" });
  });
});

describe("agent 列表（ai_agents 整读-改-整写）", () => {
  it("loadAgents：坏数据按未配置、空 command 过滤", () => {
    setSetting(db.conn, "ai_agents", "not json");
    expect(loadAgents(db.conn)).toEqual([]);
    setSetting(db.conn, "ai_agents", JSON.stringify([agent({ id: "a1", command: "" }), agent({ id: "a2" })]));
    expect(loadAgents(db.conn).map((a) => a.id)).toEqual(["a2"]);
  });

  it("agentUpsert 新增/更新 + 返回完整列表；空 command 拒绝（AGENT_COMMAND_INVALID）", () => {
    const afterAdd = agentUpsert(db.conn, agent({ id: "a1", name: "Claude" }));
    expect(afterAdd.map((a) => a.id)).toEqual(["a1"]);
    const afterUpdate = agentUpsert(db.conn, agent({ id: "a1", name: "改名" }));
    expect(afterUpdate[0].name).toBe("改名");
    expect(afterUpdate.length).toBe(1);
    expect(() => agentUpsert(db.conn, agent({ id: "a2", command: "  " }))).toThrowError(PkyError);
    try {
      agentUpsert(db.conn, agent({ id: "a2", command: "" }));
    } catch (e) {
      expect((e as PkyError).code).toBe("AGENT_COMMAND_INVALID");
    }
  });

  it("修订检测：expectedAgentIds 失配 → SETTING_MODIFIED_ELSEWHERE；force 覆盖；匹配基线放行", () => {
    agentUpsert(db.conn, agent({ id: "a1" }));
    // 另一形态改写（直接整写 ai_agents）
    setSetting(db.conn, "ai_agents", JSON.stringify([agent({ id: "a1" }), agent({ id: "a2" })]));
    expect(() => agentUpsert(db.conn, agent({ id: "a3" }), { expectedAgentIds: ["a1"] })).toThrowError(
      /已在另一处被修改/,
    );
    const forced = agentUpsert(db.conn, agent({ id: "a3" }), { expectedAgentIds: ["a1"], force: true });
    expect(forced.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
    // 基线匹配时正常写入
    agentUpsert(db.conn, agent({ id: "a4" }), { expectedAgentIds: ["a1", "a2", "a3"] });
  });

  it("deployment 绑定字段透传存储（dsh 扩展字段——存在性校验归命令层跨域面）", () => {
    agentUpsert(db.conn, agent({ id: "a1", deployment: "gpu-1" }));
    expect(loadAgents(db.conn)[0].deployment).toBe("gpu-1");
  });
});

describe("agent 列表（ai_agents 整读-改-整写）·下", () => {
  it("agentDelete：删除联动清 ai_agent_id；失配同修订检测；不存在的 id 拒绝", () => {
    agentUpsert(db.conn, agent({ id: "a1" }));
    agentUpsert(db.conn, agent({ id: "a2" }));
    setSetting(db.conn, "ai_agent_id", "a1");
    const after = agentDelete(db.conn, "a1", { expectedAgentIds: ["a1", "a2"] });
    expect(after.map((a) => a.id)).toEqual(["a2"]);
    expect(getSetting(db.conn, "ai_agent_id")).toBe("");
    expect(() => agentDelete(db.conn, "ghost")).toThrowError(/不存在/);
    setSetting(db.conn, "ai_agents", JSON.stringify([agent({ id: "x" })]));
    expect(() => agentDelete(db.conn, "x", { expectedAgentIds: ["a2"] })).toThrowError(/已在另一处被修改/);
  });

  it("primaryAgent：优先 ai_agent_id 指定的启用项，否则第一个启用项", () => {
    agentUpsert(db.conn, agent({ id: "a1", enabled: false }));
    agentUpsert(db.conn, agent({ id: "a2" }));
    expect(primaryAgent(db.conn)?.id).toBe("a2");
    setSetting(db.conn, "ai_agent_id", "a1");
    expect(primaryAgent(db.conn)?.id).toBe("a2");
    setSetting(db.conn, "ai_agent_id", "a2");
    expect(primaryAgent(db.conn)?.id).toBe("a2");
  });
});

describe("提示词覆盖（4 键 + dispatch 只读项）", () => {
  it("目录自检：4 键唯一、默认文本含全部必要占位符、上限 20000", () => {
    expect(PROMPT_SPECS.length).toBe(4);
    expect(new Set(PROMPT_SPECS.map((s) => s.storageKey)).size).toBe(4);
    expect(PROMPT_MAX_CHARS).toBe(20000);
    expect(PROMPT_KEY_PREFIX).toBe("ai_prompt_");
    for (const spec of PROMPT_SPECS) {
      for (const p of spec.requiredPlaceholders) {
        expect(spec.defaultText.includes(p)).toBe(true);
      }
    }
  });

  it("promptList：固定 5 项（4 可编辑 + dispatch 只读示例）", () => {
    const items = promptList(db.conn);
    expect(items.map((i) => i.id)).toEqual(["im_classify", "capture", "pet_chat", "tag_health", "dispatch"]);
    const dispatch = items[4];
    expect(dispatch.editable).toBe(false);
    expect(dispatch.storageKey).toBeNull();
    expect(dispatch.defaultText).toContain("===== 待办数据开始 =====");
    expect(dispatch.defaultText).toContain("示例：整理周会纪要");
  });

  it("promptGet：未知键 / dispatch 键拒绝（该提示词不支持编辑）", () => {
    expect(() => promptGet(db.conn, "ai_prompt_dispatch")).toThrowError(/不支持编辑/);
    expect(() => promptGet(db.conn, "nope")).toThrowError(/不支持编辑/);
    expect(promptGet(db.conn, "ai_prompt_pet_chat").id).toBe("pet_chat");
  });
});

describe("提示词覆盖（4 键 + dispatch 只读项）·下", () => {
  it("resolveOverride 三态：无行 default / 合法 custom / 缺占位符或超长 default_warned 回落默认", () => {
    const spec = PROMPT_SPECS.find((s) => s.id === "pet_chat")!;
    expect(resolveOverride(db.conn, spec).source).toBe("default");
    setSetting(db.conn, "ai_prompt_pet_chat", "   \n\t ");
    expect(resolveOverride(db.conn, spec).source).toBe("default");
    setSetting(db.conn, "ai_prompt_pet_chat", spec.defaultText);
    expect(resolveOverride(db.conn, spec).source).toBe("default");
    const custom = `${spec.defaultText}\n补充规则`;
    setSetting(db.conn, "ai_prompt_pet_chat", custom);
    const resolvedCustom = resolveOverride(db.conn, spec);
    expect(resolvedCustom.source).toBe("custom");
    expect(resolvedCustom.text).toBe(custom);
    const missing = spec.defaultText.split("<CONTEXT>").join("");
    setSetting(db.conn, "ai_prompt_pet_chat", missing);
    const warned = resolveOverride(db.conn, spec);
    expect(warned.source).toBe("default_warned");
    expect(warned.text).toBe(spec.defaultText);
    expect(warned.missing).toEqual(["<CONTEXT>"]);
    const overlong = `${spec.defaultText}${"长".repeat(PROMPT_MAX_CHARS)}`;
    setSetting(db.conn, "ai_prompt_pet_chat", overlong);
    const overWarned = resolveOverride(db.conn, spec);
    expect(overWarned.source).toBe("default_warned");
    expect(overWarned.overlong).toBe(true);
    expect(overWarned.missing).toEqual([]);
  });

  it("promptOverride：空白 / 等于默认 = 删行；超长与缺占位符拒绝（文案含上限/占位符名）", () => {
    const key = "ai_prompt_pet_chat";
    const spec = PROMPT_SPECS.find((s) => s.storageKey === key)!;
    promptOverride(db.conn, key, `${spec.defaultText}\n自定义`);
    expect(getSetting(db.conn, key)).not.toBeNull();
    promptOverride(db.conn, key, "  \n ");
    expect(getSetting(db.conn, key)).toBeNull();
    promptOverride(db.conn, key, spec.defaultText);
    expect(getSetting(db.conn, key)).toBeNull();
    expect(() => promptOverride(db.conn, key, `${spec.defaultText}${"长".repeat(PROMPT_MAX_CHARS)}`)).toThrowError(
      /20000/,
    );
    const noPlaceholders = spec.defaultText.split("<CONTEXT>").join("X").split("<QUESTION>").join("Y");
    try {
      promptOverride(db.conn, key, noPlaceholders);
    } catch (e) {
      expect((e as PkyError).code).toBe("PROMPT_VALIDATION_FAILED");
      expect((e as Error).message).toContain("<CONTEXT>");
      expect((e as Error).message).toContain("<QUESTION>");
    }
  });
});

describe("提示词覆盖（4 键 + dispatch 只读项）·下", () => {
  it("promptOverride：合法保存返回 spec + 未知占位符警告（非阻断、去重、小写不告警）", () => {
    const key = "ai_prompt_pet_chat";
    const spec = PROMPT_SPECS.find((s) => s.storageKey === key)!;
    const value = `${spec.defaultText}\n额外 <FOO> 与 <FOO>，小写 <foo> 与已知 <CONTEXT> 不告警`;
    const { spec: saved, unknownPlaceholders } = promptOverride(db.conn, key, value);
    expect(unknownPlaceholders).toEqual(["<FOO>"]);
    expect(saved.source).toBe("custom");
  });

  it("修订检测：expectedValue 基线失配 → SETTING_MODIFIED_ELSEWHERE；force 覆盖", () => {
    const key = "ai_prompt_pet_chat";
    const spec = PROMPT_SPECS.find((s) => s.storageKey === key)!;
    // 读时基线 = 无覆盖（""）
    setSetting(db.conn, key, "别的形态已写入的覆盖");
    expect(() => promptOverride(db.conn, key, `${spec.defaultText}\nx`, { expectedValue: "" })).toThrowError(
      /已在另一处被修改/,
    );
    promptOverride(db.conn, key, `${spec.defaultText}\nx`, { expectedValue: "", force: true });
    // 基线匹配（读时 overrideText）时放行
    promptOverride(db.conn, key, `${spec.defaultText}\ny`, {
      expectedValue: `${spec.defaultText}\nx`,
    });
  });

  it("promptReset = 删行；修订检测同款", () => {
    const key = "ai_prompt_pet_chat";
    const spec = PROMPT_SPECS.find((s) => s.storageKey === key)!;
    promptOverride(db.conn, key, `${spec.defaultText}\nz`);
    expect(() => promptReset(db.conn, key, { expectedValue: "旧基线" })).toThrowError(/已在另一处被修改/);
    const reset = promptReset(db.conn, key, { expectedValue: `${spec.defaultText}\nz` });
    expect(reset.source).toBe("default");
    expect(getSetting(db.conn, key)).toBeNull();
  });

  it("scanUnknownPlaceholders：样式边界（数字开头/单字符/未闭合/前缀杂讯）", () => {
    expect(scanUnknownPlaceholders("a <FOO> b <FOO>", ["<CONTEXT>"])).toEqual(["<FOO>"]);
    expect(scanUnknownPlaceholders("<3D> <_X> <> <F oo <", ["<CONTEXT>"])).toEqual([]);
    expect(scanUnknownPlaceholders("<FOO", ["<CONTEXT>"])).toEqual([]);
    expect(scanUnknownPlaceholders("<<FOO>", ["<CONTEXT>"])).toEqual(["<FOO>"]);
  });
});
