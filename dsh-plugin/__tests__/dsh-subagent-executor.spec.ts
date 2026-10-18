/**
 * dsh 内置判定通道执行器（dsh/subagentExecutor.ts——A7 无头 subagent 落型）：
 * fake agents/subagents 面注入（结构化收窄契约），断言——
 * - 成功路径：spawn/caller/outputSchema 请求形态、结构化建议解析（未知 messageId 过滤）、
 *   sessionId = childId、selfLanding=false（orchestrator 提交期校验落库）
 * - prompt 形态：禁用工具 + 结构化返回指令追加、A21 feedback 透传
 * - 失败路径：stopReason 非 completed 判失败且 dispose 归还、结构缺失报错
 * - 父 agent 懒建复用（agents.create 仅一次，sessionId 前缀 pky-judge-）
 */
import { describe, expect, it } from "vitest";
import { dshSubagentExecutor, type AgentsFace, type SubagentsFace } from "../src/host/dsh/subagentExecutor";

/** 捕获的 startActivation 请求（fake 面记录形态） */
interface CapturedActivation {
  provider: string;
  label: string;
  delivery: string;
  promptText: string;
  hasOutputSchema: boolean;
  childId: string;
}

/** fake 服务面：agents.create 计数 + subagents.startActivation 受控结果 */
function fakePlatform(behavior: { stopReason?: string; structured?: unknown; resultRejects?: Error }) {
  const createdSessions: string[] = [];
  const activations: CapturedActivation[] = [];
  const disposed: string[] = [];
  let seq = 0;
  const agents: AgentsFace = {
    async create(options) {
      createdSessions.push(options.sessionId);
      return { agent: { marker: "parent-agent" } };
    },
  };
  const subagents: SubagentsFace = {
    async startActivation(spec) {
      const childId = `child-${++seq}`;
      activations.push({
        provider: spec.provider,
        label: spec.label,
        delivery: spec.delivery,
        promptText: spec.request.prompt.map((b) => b.text).join("\n"),
        hasOutputSchema: spec.request.outputSchema !== undefined,
        childId,
      });
      return {
        childId,
        result:
          behavior.resultRejects !== undefined
            ? Promise.reject(behavior.resultRejects)
            : Promise.resolve({
                structured: behavior.structured,
                stopReason: behavior.stopReason ?? "completed",
              }),
        async dispose() {
          disposed.push(childId);
        },
      };
    },
  };
  return { agents, subagents, createdSessions, activations, disposed };
}

describe("dshSubagentExecutor · 成功路径", () => {
  it("spawn/caller/outputSchema 请求形态；结构化建议解析（未知 messageId 过滤）；sessionId=childId；selfLanding=false", async () => {
    const fake = fakePlatform({
      structured: {
        suggestions: [
          { messageId: "om_1", action: "todo", title: "回周报", tags: ["工作"] },
          { messageId: "om_9", action: "todo", title: "未知消息的判定" },
          { messageId: "om_2", action: "none" },
        ],
      },
    });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    const out = await exec.run({ prompt: "系统提示词\n\n消息：…", messageIds: ["om_1", "om_2"] });
    expect(exec.id).toBe("subagent");
    expect(exec.selfLanding).toBe(false);
    expect(out.sessionId).toBe("child-1");
    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo", title: "回周报" });
    expect(out.suggestions[1]).toMatchObject({ messageId: "om_2", action: "none" });
    // 请求形态：进程内全新子级 + 调用方投递 + 结构化输出 schema
    const act = fake.activations[0];
    expect(act.provider).toBe("spawn");
    expect(act.delivery).toBe("caller");
    expect(act.hasOutputSchema).toBe(true);
    // prompt 追加了禁用工具 + 结构化返回指令
    expect(act.promptText).toContain("不使用任何工具");
    expect(act.promptText).toContain("结构化");
  });

  it("A21 feedback 透传进 prompt（校验失败修正重试）", async () => {
    const fake = fakePlatform({ structured: { suggestions: [] } });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await exec.run({ prompt: "p", messageIds: ["om_1"], feedback: "title 不能为空" });
    expect(fake.activations[0].promptText).toContain("上次提交校验失败");
    expect(fake.activations[0].promptText).toContain("title 不能为空");
  });

  it("父 agent 懒建复用：agents.create 仅一次（多批复用），sessionId 前缀 pky-judge-", async () => {
    const fake = fakePlatform({ structured: { suggestions: [] } });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await exec.run({ prompt: "p", messageIds: ["om_1"] });
    await exec.run({ prompt: "p", messageIds: ["om_2"] });
    expect(fake.createdSessions).toHaveLength(1);
    expect(fake.createdSessions[0].startsWith("pky-judge-")).toBe(true);
  });
});

describe("dshSubagentExecutor · 失败路径", () => {
  it("stopReason 非 completed 判失败且 dispose 归还（子级资源与容量）", async () => {
    const fake = fakePlatform({ stopReason: "max-tokens", structured: { suggestions: [] } });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/stopReason=max-tokens/);
    expect(fake.disposed).toEqual(["child-1"]);
  });

  it("结构缺失（无 suggestions 数组）报可读错且 dispose 归还", async () => {
    const fake = fakePlatform({ structured: { rows: [] } });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/缺失 suggestions/);
    expect(fake.disposed).toEqual(["child-1"]);
  });

  it("result promise 拒绝（传输/清理失败）原样抛出且 dispose 归还", async () => {
    const fake = fakePlatform({ resultRejects: new Error("transport down") });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/transport down/);
    expect(fake.disposed).toEqual(["child-1"]);
  });

  it("dispose 自身失败不遮蔽主错误", async () => {
    const fake = fakePlatform({ stopReason: "error" });
    fake.subagents.startActivation = async () => ({
      childId: "child-x",
      result: Promise.resolve({ structured: { suggestions: [] }, stopReason: "error" }),
      async dispose() {
        throw new Error("dispose boom");
      },
    });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/stopReason=error/);
  });

  it("agents.create 失败：不吞错（父 agent 建不起来即失败，不静默）", async () => {
    const agents: AgentsFace = {
      create: () => Promise.reject(new Error("agents service unavailable")),
    };
    const fake = fakePlatform({ structured: { suggestions: [] } });
    const exec = dshSubagentExecutor({ agents, subagents: fake.subagents });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/agents service unavailable/);
    expect(fake.activations).toHaveLength(0);
  });
});

describe("dshSubagentExecutor · 调用形态契约", () => {
  it("label 稳定 todo-judge（宿主子智能体目录辨识）", async () => {
    const fake = fakePlatform({ structured: { suggestions: [] } });
    const exec = dshSubagentExecutor({ agents: fake.agents, subagents: fake.subagents });
    await exec.run({ prompt: "p", messageIds: ["om_1"] });
    expect(fake.activations[0].label).toBe("todo-judge");
  });
});
