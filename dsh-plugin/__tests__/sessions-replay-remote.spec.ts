/**
 * dispatch/sessions · sessionReplay 远端半边（从 sessions-replay.spec 拆出——棘轮
 * max-lines，等量迁移）：远端路由与快照压配置 / 唤起失败 tag 转发 / 远端双形态
 * （部署 PTY / ssh 别名）与部署契约 / 远端 PTY 句柄行。夹具（seedRow/db 生命周期）
 * 与原文件同构复制。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPtySessionRef,
  logAgentSession,
  ptyHandleOf,
  ptySessionRef,
  replayBranchOf,
  sessionReplay,
  type ReplayLauncher,
} from "../src/host/dispatch/sessions";
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

describe("sessionReplay：远端路由与快照压配置", () => {
  it("快照 remote_host 非空 → 对应部署唤起（routed.world = 部署别名），带快照三元组", () => {
    const rowId = seedRow("dispatch_headless", {
      sessionId: "s-r",
      command: "claude",
      workdir: "/remote/ws",
      remoteHost: "gpu-1",
      remotePort: 2222,
      remoteKey: "/keys/id",
    });
    const { launcher, rec } = makeLauncher({ deployment: () => ({ alias: "gpu-1", ready: true }) });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: { deploymentAlias: "gpu-1" }, branch: "resume" });
    expect(rec.remote).toHaveLength(1);
    expect(rec.remote[0]).toMatchObject({
      target: "gpu-1",
      deploymentAlias: "gpu-1",
      sessionId: "s-r",
      workdir: "/remote/ws",
      port: 2222,
      keyPath: "/keys/id",
    });
    expect(rec.local).toHaveLength(0);
  });

  it("快照压过当前配置（正向）：agent 现已改绑本机，行快照仍指向远端 → 远端唤起", () => {
    seedAgents(db.conn, [{ id: "ag-1" }]); // 当前配置无 remote（本机）
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude", remoteHost: "gpu-1" });
    const { launcher, rec } = makeLauncher({ deployment: () => ({ alias: "gpu-1", ready: true }) });
    expect(sessionReplay(db.conn, rowId, launcher)).toMatchObject({
      kind: "routed",
      world: { deploymentAlias: "gpu-1" },
    });
    expect(rec.remote).toHaveLength(1);
  });

  it("快照压过当前配置（反向）：agent 现已绑远端，行快照为本机 → 本机唤起", () => {
    seedAgents(db.conn, [{ id: "ag-1", host: "other-host" }]); // 当前配置绑远端
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude", remoteHost: "" });
    const { launcher, rec } = makeLauncher({ deployment: () => ({ alias: "other-host", ready: true }) });
    expect(sessionReplay(db.conn, rowId, launcher)).toEqual({ kind: "routed", world: "local", branch: "resume" });
    expect(rec.local).toHaveLength(1);
  });
});

describe("sessionReplay：唤起失败的 tag 转发", () => {
  it("本机唤起终端能力缺失（launcher 抛 DISPATCH_LAUNCH_FAILED）→ tag 转发", () => {
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude" });
    const { launcher } = makeLauncher({
      localError: () => {
        throw new PkyError("DISPATCH_LAUNCH_FAILED", "dsh 终端面板不可用", "确认 dsh 终端面板可用");
      },
    });
    expect(sessionReplay(db.conn, rowId, launcher)).toEqual({
      kind: "error",
      tag: "DISPATCH_LAUNCH_FAILED",
      message: "dsh 终端面板不可用",
      hint: "确认 dsh 终端面板可用",
    });
  });

  it("远端唤起免密/连接失败（launcher 抛 SSH_AUTH_REQUIRED）→ tag 转发", () => {
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude", remoteHost: "gpu-1" });
    const { launcher } = makeLauncher({
      deployment: () => ({ alias: "gpu-1", ready: true }),
      remoteError: () => {
        throw new PkyError("SSH_AUTH_REQUIRED", "免密连接失败");
      },
    });
    expect(sessionReplay(db.conn, rowId, launcher)).toEqual({
      kind: "error",
      tag: "SSH_AUTH_REQUIRED",
      message: "免密连接失败",
    });
  });

  it("launcher 抛预期之外的错误 → 原样上抛（不吞）", () => {
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude" });
    const { launcher } = makeLauncher({
      localError: () => {
        throw new Error("boom");
      },
    });
    expect(() => sessionReplay(db.conn, rowId, launcher)).toThrowError("boom");
  });
});

describe("sessionReplay：远端双形态（部署 PTY / ssh 别名）与部署契约", () => {
  it("快照带真实端口（agent-remote 来源）且解析不到部署 → ssh 别名回放（desktop 同构）", () => {
    const rowId = seedRow("dispatch_interactive", {
      sessionId: "s-r",
      remoteHost: "vscode@localhost",
      remotePort: 1022,
      remoteKey: "",
    });
    const { launcher, rec } = makeLauncher({ deployment: () => null });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: { sshTarget: "vscode@localhost" }, branch: "resume" });
    expect(rec.alias).toHaveLength(1);
    expect(rec.alias[0]).toMatchObject({
      target: "vscode@localhost",
      port: 1022,
      keyPath: "",
      agentCommand: "claude",
    });
    expect(rec.remote).toHaveLength(0); // 不走部署 PTY
  });
});

describe("sessionReplay：部署契约（部署路由来源行——port=0 无密钥）", () => {
  it("快照指向的部署已删除 → DEPLOYMENT_NOT_READY + hint 替代", () => {
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude", remoteHost: "gone-1" });
    const { launcher, rec } = makeLauncher({ deployment: () => null });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.tag).toBe("DEPLOYMENT_NOT_READY");
      expect(out.message).toContain("gone-1");
      expect(out.hint).toBeTruthy();
    }
    expect(rec.remote).toHaveLength(0);
  });

  it("快照无端口无密钥（部署路由来源）且部署缺失 → 维持 DEPLOYMENT_NOT_READY 契约", () => {
    const rowId = seedRow("dispatch_headless", {
      sessionId: "s",
      remoteHost: "gone-dep",
      remotePort: 0,
      remoteKey: "",
    });
    const { launcher, rec } = makeLauncher({ deployment: () => null });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toMatchObject({ kind: "error", tag: "DEPLOYMENT_NOT_READY" });
    expect(rec.alias).toHaveLength(0);
  });

  it("快照指向的部署未就绪 → DEPLOYMENT_NOT_READY", () => {
    const rowId = seedRow("dispatch_headless", { sessionId: "s", command: "claude", remoteHost: "gpu-1" });
    const { launcher } = makeLauncher({ deployment: () => ({ alias: "gpu-1", ready: false }) });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toMatchObject({ kind: "error", tag: "DEPLOYMENT_NOT_READY" });
  });
});

describe("sessionReplay：远端 PTY 句柄行（pty: 标记——句柄非 agent 会话 id）", () => {
  it("标记辅助：封装/判别/剥离，未标记句柄原样返回（存量兼容）", () => {
    expect(ptySessionRef("abc")).toBe("pty:abc");
    expect(isPtySessionRef("pty:abc")).toBe(true);
    expect(isPtySessionRef("abc")).toBe(false);
    expect(isPtySessionRef(null)).toBe(false);
    expect(ptyHandleOf("pty:abc")).toBe("abc");
    expect(ptyHandleOf("abc")).toBe("abc");
  });

  it("PTY 句柄行走 picker 分支（不组 --resume <句柄>），sessionId 收敛 null", () => {
    expect(replayBranchOf({ tmuxSession: "", sessionId: "pty:pty-7" })).toBe("picker");
    const rowId = seedRow("dispatch_interactive", {
      sessionId: "pty:pty-7",
      command: "claude",
      workdir: "/remote/ws",
      remoteHost: "gpu-1",
    });
    const { launcher, rec } = makeLauncher({ deployment: () => ({ alias: "gpu-1", ready: true }) });
    const out = sessionReplay(db.conn, rowId, launcher);
    expect(out).toEqual({ kind: "routed", world: { deploymentAlias: "gpu-1" }, branch: "picker" });
    expect(rec.remote[0]).toMatchObject({
      branch: "picker",
      sessionId: null,
      tmuxSession: null,
      workdir: "/remote/ws",
    });
  });

  it("tmux 会话名仍优先于 PTY 句柄", () => {
    expect(replayBranchOf({ tmuxSession: "pky-1", sessionId: "pty:pty-7" })).toBe("tmux");
  });
});
