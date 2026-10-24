/**
 * dispatch/sessions · sessionReplay 本机半边（从 sessions-page.spec 拆出——棘轮
 * max-lines，等量迁移）：本机三分支 / agent 解析 / 可回放判定与 NOT_FOUND。
 * 远端路由/错误转发/部署契约/PTY 见 sessions-replay-remote.spec.ts。
 * 夹具（seedRow/db 生命周期）与原文件同构复制。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logAgentSession, replayBranchOf, sessionReplay, type ReplayLauncher } from "../src/host/dispatch/sessions";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, seedAgents, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  seedAgents(db.conn, [{ id: "ag-1" }]); // 回放 agent 解析数据面（缺省 claude/historyArgs 空）
});
afterEach(() => {
  db.close();
});

/** 插一行会话并返回行 id（快照字段按需覆盖） */
function seedRow(kind: string, extra: Partial<Parameters<typeof logAgentSession>[1]> = {}): number {
  return logAgentSession(db.conn, { agentId: "ag-1", kind, status: "ok", ...extra });
}

// ---- sessionReplay 回放路由 ----

interface Recorded {
  local: Array<Record<string, unknown>>;
  remote: Array<Record<string, unknown>>;
  alias: Array<Record<string, unknown>>;
}

/** fake 注入执行体：记录唤起参数；可编程部署解析与唤起失败 */
function makeLauncher(
  opts: {
    deployment?: (target: string) => { alias: string; ready: boolean } | null;
    localError?: () => void;
    remoteError?: () => void;
  } = {},
): { launcher: ReplayLauncher; rec: Recorded } {
  const rec: Recorded = { local: [], remote: [], alias: [] };
  return {
    rec,
    launcher: {
      resolveDeployment: opts.deployment ?? (() => null),
      launchLocal: (l) => {
        rec.local.push({ ...l });
        opts.localError?.();
      },
      launchRemote: (l) => {
        rec.remote.push({ ...l });
        opts.remoteError?.();
      },
      launchAlias: (l) => {
        rec.alias.push({ ...l });
        opts.remoteError?.();
      },
    },
  };
}

describe("sessionReplay：路由三分支与可回放判定", () => {
  it("branch 判定三分支完备（桌面 resume_route 同构）：tmux 优先 → resume → picker", () => {
    expect(replayBranchOf({ tmuxSession: "t1", sessionId: "s1" })).toBe("tmux");
    expect(replayBranchOf({ tmuxSession: "", sessionId: "s1" })).toBe("resume");
    expect(replayBranchOf({ tmuxSession: "", sessionId: null })).toBe("picker");
  });

  it("本机行有 tmux 会话名 → tmux 分支唤起（优先级最高）", () => {
    const rowId = seedRow("dispatch_interactive", { tmuxSession: "t1", sessionId: "s1", workdir: "/ws" });
    const { launcher, rec } = makeLauncher();
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: "local", branch: "tmux" });
    expect(rec.local).toHaveLength(1);
    expect(rec.local[0]).toMatchObject({ branch: "tmux", tmuxSession: "t1", sessionId: "s1", workdir: "/ws" });
    expect(rec.remote).toHaveLength(0);
  });

  it("本机行无 tmux 有 session_id → --resume 分支唤起", () => {
    const rowId = seedRow("dispatch_headless", {
      sessionId: "s9",
      command: "claude",
      workdir: "/local/ws",
      agentId: "ag-2",
    });
    const { launcher, rec } = makeLauncher();
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: "local", branch: "resume" });
    expect(rec.local[0]).toMatchObject({
      branch: "resume",
      sessionId: "s9",
      tmuxSession: null,
      agentId: "ag-2",
      agentCommand: "claude",
      workdir: "/local/ws",
    });
  });

  it("无 session_id 且无 tmux 的行 → picker 分支兜底唤起（交互行恒可回放——desktop resume_route 同构）", () => {
    const rowId = seedRow("classify");
    const { launcher, rec } = makeLauncher();
    expect(sessionReplay(db.conn, rowId, launcher)).toEqual({ kind: "routed", world: "local", branch: "picker" });
    expect(rec.local).toHaveLength(1);
    expect(rec.local[0]).toMatchObject({ branch: "picker", sessionId: null, tmuxSession: null });
  });
});

describe("sessionReplay：agent 解析（agent_id → ai_agents 配置，删除回落主 agent）", () => {
  it("radio 判定行（command 空）→ 照常回放：agent 按 agent_id 解析配置，行 command 非来源（desktop 同构）", () => {
    const rowId = seedRow("classify", { sessionId: "judge-run-1" });
    const { launcher, rec } = makeLauncher();
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: "local", branch: "resume" });
    // agentCommand = ai_agents 配置命令（seedAgents 缺省 claude），行内空 command 不参与
    expect(rec.local[0]).toMatchObject({ agentCommand: "claude", sessionId: "judge-run-1" });
  });

  it("行所属 agent 已删除 → 回落主 agent（primary——desktop agent_by_id or_else 语义）", () => {
    seedAgents(db.conn, [{ id: "ag-x", command: "pi" }]);
    const rowId = seedRow("classify", { agentId: "ag-gone", sessionId: "judge-run-2" });
    const { launcher, rec } = makeLauncher();
    expect(sessionReplay(db.conn, rowId, launcher)).toEqual({ kind: "routed", world: "local", branch: "resume" });
    expect(rec.local[0]).toMatchObject({ agentCommand: "pi" });
  });

  it("无任何可用 agent 配置 → 明确报错（desktop 同款语义）", () => {
    db.conn.prepare("DELETE FROM settings WHERE key='ai_agents'").run();
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude" });
    const { launcher } = makeLauncher();
    expect(() => sessionReplay(db.conn, rowId, launcher)).toThrowError(/无可用 agent/);
  });
});

describe("sessionReplay：NOT_FOUND", () => {
  it("rowId 不存在 → NOT_FOUND", () => {
    const { launcher } = makeLauncher();
    expect(() => sessionReplay(db.conn, 999, launcher)).toThrowError(PkyError);
  });
});
