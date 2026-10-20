/**
 * dsh 内置判定通道执行器（dsh/sessionExecutor.ts——root 会话形态，一批一会话）：
 * fake agents/sessions 面注入（结构化收窄契约，装配见 dshSessionExecutorFakes.ts），
 * 断言——
 * - 成功路径：root create 形态（无 origin 分类、meta.cwd、显式模型组合）、prompt 头行
 *   标记 + 裸 JSON 返回指令（围栏容忍解析）、未知 messageId 过滤、sessionId = 会话 id
 *   （pky-judge- 前缀）、selfLanding=false、flush 先于 dispose
 * - 一批一会话：两次 run 两次 agents.create（不复用常驻 agent）
 * - 失败路径：turn/end reason 非 completed 判失败、JSON 解析失败、agents.create 拒绝、
 *   120s 超时（dispose 归还）、dispose 失败不遮蔽主错误
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dshSessionExecutor } from "../src/host/dsh/sessionExecutor";
import {
  assistantEvent,
  boomDisposeAgents,
  lastWinsScript,
  capturingAgents,
  defaultModel,
  fakePlatform,
  hangingAgents,
  noopSessions,
  okScript,
  turnEnd,
} from "./dshSessionExecutorFakes";

describe("dshSessionExecutor · root create 形态与解析", () => {
  it("root create 形态（无 origin/cwd/显式模型组合）；裸 JSON 解析（未知 messageId 过滤）；sessionId=会话 id；flush 先于 dispose", async () => {
    const fake = fakePlatform();
    fake.script(
      lastWinsScript(
        '{"suggestions":[{"messageId":"om_1","action":"todo","title":"回周报","tags":["工作"]},' +
          '{"messageId":"om_9","action":"todo"},{"messageId":"om_2","action":"none"}]}',
      ),
    );
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions, agentDefaultModel: defaultModel });
    const out = await exec.run({ prompt: "系统提示词\n\n消息：…", messageIds: ["om_1", "om_2"] });
    expect(exec.id).toBe("session");
    expect(exec.name).toBe("dsh 内置通道");
    expect(exec.selfLanding).toBe(false);
    expect(out.sessionId).toBe(fake.created[0].sessionId);
    expect(out.sessionId?.startsWith("pky-judge-")).toBe(true);
    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo", title: "回周报" });
    expect(out.suggestions[1]).toMatchObject({ messageId: "om_2", action: "none" });
    // root create：meta 恰为 cwd 归组（无 origin 分类即进主会话列表）、模型组合显式
    expect(fake.created[0].meta).toEqual({ cwd: process.cwd() });
    expect(fake.created[0].agentOptions).toEqual({ provider: "deepseek", model: "r1" });
    // flush 先于 dispose（durability 先于运行时归还）
    expect(fake.flushed).toHaveLength(1);
    expect(fake.disposed).toEqual([fake.created[0].sessionId]);
  });
});

describe("dshSessionExecutor · 成功路径", () => {
  it("prompt 头行 pk 待办判定标记 + 禁工具与裸 JSON 指令 + A21 feedback 透传", async () => {
    const fake = fakePlatform();
    fake.script(okScript('{"suggestions":[]}'));
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions, agentDefaultModel: defaultModel });
    await exec.run({ prompt: "p", messageIds: ["om_1"], feedback: "title 不能为空" });
    const text = fake.prompts[0];
    expect(text.startsWith("【pk 待办判定】")).toBe(true);
    expect(text).toContain("不使用任何工具");
    expect(text).toContain("JSON");
    expect(text).toContain("上次提交校验失败");
    expect(text).toContain("title 不能为空");
  });

  it("一批一会话：两次 run 两次 agents.create（会话 id 不同，无复用）", async () => {
    const fake = fakePlatform();
    fake.script(okScript('{"suggestions":[]}'));
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions, agentDefaultModel: defaultModel });
    await exec.run({ prompt: "p", messageIds: ["om_1"] });
    fake.script(okScript('{"suggestions":[]}'));
    await exec.run({ prompt: "p", messageIds: ["om_2"] });
    expect(fake.created).toHaveLength(2);
    expect(fake.created[0].sessionId).not.toBe(fake.created[1].sessionId);
  });

  it("turn/end reason 为 {kind} 对象形态（dsh 0.2.1-rc.2 起）→ completed 判成功（回归：对象恒不等字符串，内置判定曾必败）", async () => {
    const fake = fakePlatform();
    fake.script([assistantEvent('{"suggestions":[]}'), turnEnd({ kind: "completed" })]);
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions, agentDefaultModel: defaultModel });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).resolves.toMatchObject({
      suggestions: [],
      sessionId: expect.any(String),
    });
    expect(fake.flushed).toHaveLength(1);
  });
});

describe("dshSessionExecutor · 失败路径", () => {
  it("turn/end reason 非 completed 判失败（部分转录仍 flush 留档）", async () => {
    const fake = fakePlatform();
    fake.script([assistantEvent('{"suggestions":[]}'), turnEnd("max-tokens")]);
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/reason=max-tokens/);
    expect(fake.flushed).toHaveLength(1);
    expect(fake.disposed).toHaveLength(1);
  });

  it("turn/end reason 对象形态非 completed → 失败且错误信息带 kind（不输出 [object Object]）", async () => {
    const fake = fakePlatform();
    fake.script([assistantEvent('{"suggestions":[]}'), turnEnd({ kind: "error" })]);
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/reason=error/);
    expect(fake.disposed).toHaveLength(1);
  });

  it("assistant 文本非 JSON（无围栏无对象）报可读错", async () => {
    const fake = fakePlatform();
    fake.script(okScript("好的，已判定完毕"));
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/JSON/);
    expect(fake.disposed).toHaveLength(1);
  });

  it("agents.create 拒绝：不吞错（通道建不起来即失败，不静默）", async () => {
    const fake = fakePlatform({ createRejects: new Error("agents service unavailable") });
    const exec = dshSessionExecutor({ agents: fake.agents, sessions: fake.sessions });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/agents service unavailable/);
    expect(fake.flushed).toHaveLength(0);
  });

  it("dispose 自身失败不遮蔽主错误", async () => {
    const exec = dshSessionExecutor({
      agents: boomDisposeAgents([turnEnd("error")]),
      sessions: noopSessions,
    });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/reason=error/);
  });
});

describe("dshSessionExecutor · 超时路径", () => {
  it("120s 超时：dispose 归还后抛超时错", async () => {
    vi.useFakeTimers();
    try {
      const disposed: string[] = [];
      const exec = dshSessionExecutor({ agents: hangingAgents(disposed), sessions: noopSessions });
      const pending = exec.run({ prompt: "p", messageIds: ["om_1"] });
      pending.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(119_999);
      expect(disposed).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).rejects.toThrow(/超时/);
      expect(disposed).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dshSessionExecutor · 用户消息形态", () => {
  let uuidSpy: ReturnType<typeof vi.spyOn>;
  let uuidSeq = 0;

  beforeEach(() => {
    uuidSeq = 0;
    uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(() => `00000000-0000-0000-0000-0000000000${String(++uuidSeq).padStart(2, "0")}`);
  });

  afterEach(() => {
    uuidSpy.mockRestore();
  });

  it("followup 收到结构化 UserMessage（id/role/content text 块/source.kind=user）", async () => {
    const messages: unknown[] = [];
    const exec = dshSessionExecutor({ agents: capturingAgents(messages), sessions: noopSessions });
    await exec.run({ prompt: "p", messageIds: ["om_1"] });
    expect(messages).toHaveLength(1);
    // randomUUID 首调用是会话 id（pky-judge- 前缀内）、次调用才是消息 id
    expect(messages[0]).toEqual({
      id: "00000000-0000-0000-0000-000000000002",
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("【pk 待办判定】") }],
      source: { kind: "user" },
    });
  });
});
