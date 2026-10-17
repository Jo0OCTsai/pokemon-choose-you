/**
 * host 命令装配面 · full-parity 增量续（任务 2.9，从 commands-remote.spec 等量拆出以控
 * 文件行数棘轮）：会话分页回放 / 图鉴连胜 / lark 一键登录 / AX 授权 / 诊断
 * 三字段的信封 happy path（fake deps——domain 细节见各域单测）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandsFixture, seedTask, type CommandsFixture } from "./commandsSetup";
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
    sys: {
      sendOpenPath: () => sysOk,
      queryMacAuth: async () => ({ granted: sysOk }),
    },
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

  it("sessionReplay：本机 tmux 行 → routed local；无句柄 → INVALID_ARGUMENT", async () => {
    const id = Number(
      f.conn
        .prepare(
          "INSERT INTO agent_sessions (agent_id, agent_name, kind, session_id, tmux_session, status, created_at) VALUES ('a', 'A', 'dispatch_interactive', NULL, 't1', 'ok', '2026-01-01T00:00:00+00:00')",
        )
        .run().lastInsertRowid,
    );
    const out = (await f.call("sessionReplay", { rowId: id })) as { data: { routed: { world: string } } };
    expect(out.data.routed.world).toBe("local");
    const bare = Number(
      f.conn
        .prepare(
          "INSERT INTO agent_sessions (agent_id, agent_name, kind, status, created_at) VALUES ('a', 'A', 'classify', 'ok', '2026-01-01T00:00:00+00:00')",
        )
        .run().lastInsertRowid,
    );
    const no = (await f.call("sessionReplay", { rowId: bare })) as { error: { code: string } };
    expect(no.error.code).toBe("INVALID_ARGUMENT");
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
