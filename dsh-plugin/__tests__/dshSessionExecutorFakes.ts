/**
 * dsh-session-executor 系列受测装配（从 dsh-session-executor.spec.ts 拆出——棘轮
 * max-lines，等量迁移）：可脚本 turn 的 agent fake + fake 平台（agents.create /
 * sessions.flush 记账）+ 三类定制 agents（悬挂/捕获/dispose 恒拒）+ 事件脚本助手；
 * 消费面 = dsh-session-executor.spec.ts。
 */
import type { AgentDefaultModelFace, AgentFace, AgentsFace, SessionsFace } from "../src/host/dsh/sessionExecutor";

/** 会话事件脚本（assistant 文本 + turn 终态） */
export type ScriptEvent = { type: string; data?: unknown };

/** assistant/message 事件（单文本块） */
export function assistantEvent(text: string): ScriptEvent {
  return { type: "assistant/message", data: { message: { content: [{ type: "text", text }] } } };
}

/** turn/end 事件（终态 reason：dsh 0.2.1-rc.2 起为 {kind} 对象，更早宿主为字符串——两态都要覆盖） */
export function turnEnd(reason: string | { kind: string }): ScriptEvent {
  return { type: "turn/end", data: { reason } };
}

/** 标准成功脚本：单条 assistant 文本 + turn/end completed */
export function okScript(text: string): ScriptEvent[] {
  return [assistantEvent(text), turnEnd("completed")];
}

/** 整段 ```json 围栏包裹（围栏容忍解析的脚本素材） */
export function fencedJson(payload: string): string {
  return `\`\`\`json\n${payload}\n\`\`\``;
}

/**
 * 可脚本 turn 的 agent：create 时会话为空、followup 投递、whenIdle 放行前的微任务里
 * 追加脚本事件（模拟 turn 进行中落事件、静默后可读——summarize 自 firstSeq 扫描）。
 */
export function scriptedAgentFace(options?: { onFollowup?: (message: unknown) => void }): {
  agent: AgentFace;
  script(events: ScriptEvent[]): void;
} {
  let pending: ScriptEvent[] = [];
  const events: ScriptEvent[] = [];
  const agent: AgentFace = {
    followup(message) {
      options?.onFollowup?.(message);
    },
    whenIdle() {
      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          events.push(...pending);
          resolve();
        });
      });
    },
    session: {
      get seq() {
        return events.length;
      },
      eventAt(i: number) {
        return events[i];
      },
    },
  };
  return {
    agent,
    script(next) {
      pending = next;
    },
  };
}

/** fake 平台捕获的 agents.create 请求形态 */
export interface CapturedCreate {
  sessionId: string;
  meta: Readonly<Record<string, unknown>> | undefined;
  agentOptions: { provider: string; model: string } | undefined;
}

/** fake 平台（agents.create + sessions.flush 记账；script 喂给下一次 create 的 agent） */
export interface FakePlatform {
  agents: AgentsFace;
  sessions: SessionsFace;
  created: CapturedCreate[];
  flushed: number[];
  disposed: string[];
  prompts: string[];
  script(events: ScriptEvent[]): void;
}

export function fakePlatform(behavior: { createRejects?: Error } = {}): FakePlatform {
  const created: CapturedCreate[] = [];
  const flushed: number[] = [];
  const disposed: string[] = [];
  const prompts: string[] = [];
  let nextScript: ScriptEvent[] = [];
  const platform: FakePlatform = {
    created,
    flushed,
    disposed,
    prompts,
    script(events) {
      nextScript = events;
    },
    agents: {
      async create(options) {
        if (behavior.createRejects !== undefined) {
          throw behavior.createRejects;
        }
        created.push({
          sessionId: options.sessionId,
          meta: options.meta === undefined ? undefined : { ...options.meta },
          agentOptions: options.agentOptions,
        });
        const current = scriptedAgentFace({
          onFollowup: (msg) =>
            prompts.push((msg as { content: Array<{ text: string }> }).content.map((b) => b.text).join("\n")),
        });
        current.script(nextScript);
        return {
          agent: current.agent,
          async dispose() {
            disposed.push(options.sessionId);
          },
        };
      },
    },
    sessions: {
      async flush(session) {
        flushed.push((session as { seq?: number }).seq ?? -1);
      },
    },
  };
  return platform;
}

/** 双段文本脚本（先非 JSON 再围栏 JSON——末段非空胜出，summarize 取最后非空） */
export function lastWinsScript(fenced: string): ScriptEvent[] {
  return [assistantEvent("not json first"), assistantEvent(fencedJson(fenced)), turnEnd("completed")];
}

/** 悬挂型 agents（超时路径专用——whenIdle 永不放行，事件面恒空） */
export function hangingAgents(disposed: string[]): AgentsFace {
  return {
    async create(options) {
      return {
        agent: {
          followup: () => undefined,
          whenIdle: () => new Promise<void>(() => undefined),
          session: { seq: 0, eventAt: () => undefined },
        },
        async dispose() {
          disposed.push(options.sessionId);
        },
      };
    },
  };
}

/** 捕获型 agents（followup 消息形态契约专用）+ 预置成功脚本 */
export function capturingAgents(messages: unknown[]): AgentsFace {
  const scripted = scriptedAgentFace({ onFollowup: (msg) => messages.push(msg) });
  scripted.script(okScript('{"suggestions":[]}'));
  return {
    async create() {
      return { agent: scripted.agent, dispose: () => Promise.resolve() };
    },
  };
}

/** dispose 恒拒型 agents（失败不遮蔽主错误专用） */
export function boomDisposeAgents(script: ScriptEvent[]): AgentsFace {
  const scripted = scriptedAgentFace();
  scripted.script(script);
  return {
    async create() {
      return { agent: scripted.agent, dispose: () => Promise.reject(new Error("dispose boom")) };
    },
  };
}

/** 平台面兜底：agentDefaultModel 恒给组合（真机踩坑——缺组合 prompt 装配报 {{model}}） */
export const defaultModel: AgentDefaultModelFace = {
  currentSelection: () => ({ provider: "deepseek", model: "r1" }),
};

/** 透传 sessions 面（不需要记账的用例） */
export const noopSessions: SessionsFace = {
  flush: () => Promise.resolve(),
};
