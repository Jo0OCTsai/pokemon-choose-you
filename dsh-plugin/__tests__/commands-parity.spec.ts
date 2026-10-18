/**
 * host 命令装配面 · full-parity 增量续（任务 2.9，从 commands-remote.spec 等量拆出以控
 * 文件行数棘轮）：会话分页回放 / 图鉴连胜 / lark 一键登录 / AX 授权 / 诊断
 * 三字段的信封 happy path（fake deps——domain 细节见各域单测）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachProjectTag, createCommandsFixture, seedTask, type CommandsFixture } from "./commandsSetup";
import { createHandoffTerminal } from "../src/host/dispatch/terminalAdapters";
import type { BridgeClient } from "../src/host/pet/bridge";

let f: CommandsFixture;

beforeEach(() => {
  f = createCommandsFixture();
});

afterEach(() => {
  f.close();
});

/** helper 桥面 fake（sys 发送面——AX 授权/诊断消费） */
function fakeBridge(sysOk: boolean): BridgeClient {
  return {
    hello: { type: "hello", version: "0.9.9", caps: ["sys-open", "mac-auth"] },
    sys: { sendOpenPath: () => sysOk, queryMacAuth: async () => ({ granted: sysOk }) },
  } as unknown as BridgeClient;
}

describe("full-parity 命令面 · 会话/图鉴", () => {
  it("sessionsPage：分组计数与翻页（domain 细节见 sessions-page.spec）", async () => {
    seedTask(f.conn, "x");
    f.conn
      .prepare(
        "INSERT INTO agent_sessions (agent_id, agent_name, kind, status, created_at) VALUES ('a', 'A', 'dispatch_headless', 'ok', '2026-01-01T00:00:00+00:00')",
      )
      .run();
    const out = (await f.call("sessionsPage", { group: "dispatch", limit: 10 })) as {
      data: { rows: unknown[]; counts: { dispatch: number; all: number }; total: number };
    };
    expect(out.data.rows).toHaveLength(1);
    expect(out.data.counts).toMatchObject({ dispatch: 1, all: 1 });
    expect(out.data.total).toBe(1);
  });

  it("streakInfo：连胜直读 + nextMilestone", async () => {
    const out = (await f.call("streakInfo")) as { data: { days: number; todayCount: number } };
    expect(out.data).toMatchObject({ days: 0, todayCount: 0 });
    f.conn
      .prepare(
        "INSERT INTO tasks (title, status, completed_at, created_at) VALUES ('a', 'done', ?, '2026-01-01T00:00:00+00:00')",
      )
      .run(new Date().toISOString());
    const after = (await f.call("streakInfo")) as { data: { days: number; nextMilestone?: number } };
    expect(after.data.days).toBe(1);
    expect(after.data.nextMilestone).toBe(10);
  });
});

/** 插一行会话（列按需覆盖；kind/status 缺省 dispatch_interactive/ok）并返回行 id——
 *  同步种子回放 agent（agent_id=a → claude，回放命令行组装数据面） */
function insertSession(cols: Record<string, string | number | null>): number {
  f.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "a",
        name: "A",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
  const merged: Record<string, string | number | null> = {
    agent_id: "a",
    agent_name: "A",
    kind: "dispatch_interactive",
    status: "ok",
    ...cols,
  };
  const names = Object.keys(merged);
  const placeholders = names.map(() => "?").join(",");
  return Number(
    f.conn
      .prepare(`INSERT INTO agent_sessions (${names.join(",")}, created_at) VALUES (${placeholders}, ?)`)
      .run(...names.map((n) => merged[n]), "2026-01-01T00:00:00+00:00").lastInsertRowid,
  );
}

describe("full-parity 命令面 · 会话回放（handoff / 注入两态）", () => {
  it("sessionReplay：本机 tmux 行无终端注入面 → handoff 命令行回传（opened=false 零静默）", async () => {
    const id = insertSession({ session_id: null, tmux_session: "t1", workdir: "/ws" });
    // 默认 deps（terminalLine 缺席 = 真实 dsh 宿主形态）：不假装注入——命令行回传客户端复制执行
    const out = (await f.call("sessionReplay", { rowId: id })) as {
      data: { routed: { world: string; line?: string; workdir?: string; opened?: boolean } };
    };
    expect(out.data.routed.world).toBe("local");
    expect(out.data.routed.opened).toBe(false);
    expect(out.data.routed.line).toContain("tmux attach-session -t t1");
    expect(out.data.routed.workdir).toBe("/ws");
  });

  it("sessionReplay：本机 headless 行（无 tmux）→ resume 分支命令行（--resume 会话 id）", async () => {
    const id = insertSession({
      kind: "dispatch_headless",
      session_id: "s9",
      tmux_session: "",
      command: "claude",
      workdir: "/local/ws",
    });
    const out = (await f.call("sessionReplay", { rowId: id })) as {
      data: { routed: { line?: string } };
    };
    // desktop local_history_line 同款：工作目录非空 → cd 前缀
    expect(out.data.routed.line).toBe("cd /local/ws && claude --resume s9");
  });

  it("sessionReplay：终端注入面在场 → 真实注入（opened 缺省 = 契约兼容）；无句柄 → INVALID_ARGUMENT", async () => {
    const id = insertSession({ session_id: null, tmux_session: "t1" });
    const injections: string[] = [];
    f.deps.terminalLine = {
      injectLine: async (line) => {
        injections.push(line);
      },
    };
    const out = (await f.call("sessionReplay", { rowId: id })) as { data: { routed: unknown } };
    expect(out.data.routed).toEqual({ world: "local" });
    expect(injections[0]).toContain("tmux attach-session -t t1");
    const bare = insertSession({ kind: "classify", session_id: null, tmux_session: "" });
    const no = (await f.call("sessionReplay", { rowId: bare })) as { error: { code: string } };
    expect(no.error.code).toBe("INVALID_ARGUMENT");
  });
});

describe("full-parity 命令面 · 任务/登录", () => {
  it("larkLoginStart：终端注入 fake 记录 + ok/note；注入失败 → DISPATCH_LAUNCH_FAILED", async () => {
    const injections: string[] = [];
    f.deps.terminalLine = {
      injectLine: async (line) => {
        injections.push(line);
      },
    };
    const out = (await f.call("larkLoginStart")) as { data: { ok: boolean; note: string } };
    expect(out.data.ok).toBe(true);
    expect(injections[0]).toContain("lark-cli");
    f.deps.terminalLine = {
      injectLine: async () => {
        throw new Error("panel gone");
      },
    };
    const fail = (await f.call("larkLoginStart")) as { error: { code: string } };
    expect(fail.error.code).toBe("DISPATCH_LAUNCH_FAILED");
  });
});

describe("full-parity 命令面 · AX 授权与诊断", () => {
  it("macAuthorizationStatus/macAuthPaneOpen：桥在位往返 + 缺席 HELPER_CAPABILITY_MISSING", async () => {
    const missing = (await f.call("macAuthorizationStatus", { kind: "accessibility" })) as {
      error: { code: string };
    };
    expect(missing.error.code).toBe("HELPER_CAPABILITY_MISSING");
    f.deps.petBridge = () => fakeBridge(true);
    f.deps.helperPath = () => "/opt/helper/dist/main.js";
    const status = (await f.call("macAuthorizationStatus", { kind: "accessibility" })) as {
      data: { granted: boolean; helperPath: string };
    };
    expect(status.data).toEqual({ granted: true, helperPath: "/opt/helper/dist/main.js" });
    const pane = (await f.call("macAuthPaneOpen")) as { data: { ok: boolean } };
    expect(pane.data.ok).toBe(true);
    const badKind = (await f.call("macAuthorizationStatus", { kind: "screen" as never })) as {
      error: { code: string };
    };
    expect(badKind.error.code).toBe("INVALID_ARGUMENT");
  });

  it("diagnosticsSnapshot：三字段缺省 null（未装配）+ 装配后投影", async () => {
    const plain = (await f.call("diagnosticsSnapshot")) as {
      data: { helperCaps: unknown; shortcutRegistered: unknown; sshFamily: unknown; links: unknown[] };
    };
    expect(plain.data.helperCaps).toBeNull();
    expect(plain.data.shortcutRegistered).toBeNull();
    expect(plain.data.sshFamily).toBeNull();
    expect(plain.data.links).toHaveLength(2);
    f.deps.petBridge = () => fakeBridge(false);
    f.deps.shortcutRegistered = () => false;
    f.deps.sshFamily = () => ({ ok: false, detail: "family missing", missing: true });
    const rich = (await f.call("diagnosticsSnapshot")) as {
      data: {
        helperCaps: Record<string, boolean>;
        shortcutRegistered: boolean;
        sshFamily: { missing: boolean };
        helperVersion: string | null;
      };
    };
    expect(rich.data.helperCaps["sys-open"]).toBe(true);
    expect(rich.data.helperCaps["sys-tray"]).toBe(false);
    expect(Object.keys(rich.data.helperCaps)).toHaveLength(8);
    expect(rich.data.shortcutRegistered).toBe(false);
    expect(rich.data.sshFamily.missing).toBe(true);
    expect(rich.data.helperVersion).toBe("0.9.9");
  });
});

/** 种子 agent（command "true" + workdir=f.dir——派发行组装数据面） */
function seedAgentEntry() {
  f.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "A",
        command: "true",
        args: "",
        historyArgs: "",
        workdir: f.dir,
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
}

describe("host 命令装配面 · 外部终端三态（desktop/web 载体）", () => {
  it("外部终端唤起成功 → 非 handoff（真窗口）", async () => {
    seedAgentEntry();
    const okTask = seedTask(f.conn, "外部终端成功");
    attachProjectTag(f.conn, f.dir, okTask);
    f.deps.terminal = {
      inject: async () => ({ terminal: "external-Ghostty" }),
    };
    const ok = (await f.call("dispatchInteractive", { taskId: okTask })) as {
      data: { handedOff?: boolean };
    };
    expect(ok.data.handedOff).toBeUndefined();
  });

  it("外部终端唤起失败 → handoff + reason=spawn-failed（命令行仍回传）", async () => {
    seedAgentEntry();
    const failTask = seedTask(f.conn, "外部终端失败");
    attachProjectTag(f.conn, f.dir, failTask);
    f.deps.terminal = {
      inject: async () => ({
        terminal: "copy-line",
        reason: "spawn-failed",
        note: "唤起失败——请复制完整命令行到终端手动执行：claude x",
      }),
    };
    const fail = (await f.call("dispatchInteractive", { taskId: failTask })) as {
      data: { handedOff?: boolean; handoffReason?: string; line?: string };
    };
    expect(fail.data.handedOff).toBe(true);
    expect(fail.data.handoffReason).toBe("spawn-failed");
    expect(fail.data.line).toContain("true"); // seedAgentEntry 的 command + 完整 prompt
  });

  it("web 载体 handoff 终端 → handoffReason=web-carrier（客户端 web 提示数据面）", async () => {
    seedAgentEntry();
    const task = seedTask(f.conn, "web 载体");
    attachProjectTag(f.conn, f.dir, task);
    f.deps.terminal = createHandoffTerminal("dsh web 载体：窗口会开在宿主屏幕上", "web-carrier");
    const out = (await f.call("dispatchInteractive", { taskId: task })) as {
      data: { handedOff?: boolean; handoffReason?: string };
    };
    expect(out.data.handedOff).toBe(true);
    expect(out.data.handoffReason).toBe("web-carrier");
  });
});

describe("host 命令装配面 · ssh 别名回放（agent-remote 快照行）", () => {
  it("desktop 载体（terminalLine 在场）：注入 ssh 行——快照端口 + --resume + 远端整体引用", async () => {
    insertSession({});
    const id = insertSession({
      kind: "dispatch_headless",
      session_id: "s-ssh",
      tmux_session: "",
      workdir: "/workspaces/devcontainer",
      remote_host: "vscode@localhost",
      remote_port: 1022,
    });
    const injections: string[] = [];
    f.deps.terminalLine = {
      injectLine: async (line) => {
        injections.push(line);
      },
    };
    const out = (await f.call("sessionReplay", { rowId: id })) as {
      data: { routed: { world: { sshTarget?: string } } };
    };
    expect(out.data.routed.world).toEqual({ sshTarget: "vscode@localhost" });
    expect(injections[0]).toContain("-p 1022");
    expect(injections[0]).toContain("-- vscode@localhost");
    expect(injections[0]).toContain("--resume s-ssh");
    expect(injections[0]).toContain("/workspaces/devcontainer");
    // 载荷双层引用契约：本地 sh -c 剥一层后，ssh argv 中的载荷仍须自携单引号
    // （ssh 重组远端命令只做空格拼接——单层引用会被本地 shell 剥光，远端命令碎成裸词）
    expect(injections[0]).toMatch(/-c ''\\''cd /);
  });
});
