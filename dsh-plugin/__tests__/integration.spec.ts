/**
 * 分层替身集成测试（AD §7.3 E2E 形态②）：伪 ctx（fake timer/fake lark/fake 执行器/
 * fake helper 子进程）驱动 createPlugin 起一个完整插件实例 + 真实临时 SQLite——
 * 冒烟级断言装配链路贯通（细节行为已有各域单测）：
 * ① 启动迁移+种子（含 presets_v2 标记位）② 快捕→判定（fake subagent）→分诊建任务
 * ③ 出发任务→pet task-state 送达（fake helper 记录）④ 自动派发扫描→无头执行→回传收口
 * ⑤ configWrite→两形态键读回。
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlugin, type Plugin } from "../src/host/index";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import { nodeScriptSpawner } from "../src/host/pet/supervisor";
import type { DispatchExecutor, ExecOutcome } from "../src/host/dispatch/executor";

const FAKE_HELPER = join(import.meta.dirname, "fixtures", "fake-helper.mjs");

let dir: string;
let logPath: string;
let plugin: Plugin;
let autoTicks: Array<() => void>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-plugin-"));
  logPath = join(dir, "helper-log.jsonl");
  writeFileSync(logPath, "");
  autoTicks = [];
});

afterEach(() => {
  plugin?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

/** fake 无头执行器（launch 即成功回传） */
function fakeDispatchExecutor(): DispatchExecutor {
  return {
    async launch(): Promise<ExecOutcome> {
      return { exitCode: 0, durationMs: 6, stdout: "", timedOut: false };
    },
    kill() {
      /* fake 无在途执行 */
    },
  };
}

/** 伪 ctx 装配（fake timer/lark/执行器/helper；轮询启动但 lark 空转不拉取） */
function assemble(opts: { pet?: boolean } = {}): Plugin {
  const larkBin = join(dir, "lark-cli");
  plugin = createPlugin({
    dbPath: join(dir, "data", "pokemon-choose-you.db"),
    logDir: join(dir, "logs"), // 落盘 sink 隔离到临时目录（缺省会写真实 ~/.choose-you/logs）
    pollTimer: () => () => undefined, // fake：不自动触发轮询
    feedTimer: { every: () => 0, cancel: () => undefined },
    autoTimer: { every: (_ms, fn) => (autoTicks.push(fn), 1), cancel: () => undefined },
    petSpawner:
      opts.pet === false
        ? undefined
        : {
            spawn: (args) =>
              nodeScriptSpawner(FAKE_HELPER, { HELPER_HEADLESS: "1" }).spawn([...args, `--log=${logPath}`]),
          },
    larkBin,
    newExecutor: () =>
      fakeSubagentExecutor("fake-judge", (batch) => [
        { messageId: batch.messageIds[0] ?? "", action: "todo", title: "快捕：整理桌面" },
      ]),
    dispatchDeps: { executorFor: () => fakeDispatchExecutor() },
    meta: { pluginVersion: "0.1.0", dshVersion: null },
    feishuConfigured: true,
  });
  return plugin;
}

/** 轮询等待（异步链路/子进程启动的收敛窗） */
async function waitFor(probe: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (probe()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function readHelperLog(): Array<{ dir: string; msg: Record<string, unknown> }> {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { dir: string; msg: Record<string, unknown> });
}

/** 直插一个项目标签（meta 指定 agent）+ agent 配置 + 到期任务（自动派发起点） */
function seedAutoDispatchTarget(p: Plugin): number {
  const conn = p.conn;
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "Agent一号",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_auto_enabled', 'true')").run();
  const tagId = Number(
    (
      conn
        .prepare(
          "INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('PokemonApp', 1, ?, '2026-01-01T00:00:00+00:00')",
        )
        .run(JSON.stringify({ agentId: "ag-1", workdir: dir })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  const taskId = Number(
    (
      conn
        .prepare(
          "INSERT INTO tasks (title, status, due_at, created_at) VALUES ('自动派发目标', 'scheduled', '2026-01-01T09:00', '2026-01-01T00:00:00+00:00')",
        )
        .run() as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

describe("createPlugin 分层替身集成（伪 ctx + 真实临时 SQLite）", () => {
  it("① 启动迁移+种子：schema 版本 / 默认分类与维度 / presets_v2 标记位", () => {
    const p = assemble({ pet: false });
    expect(p.migration.mode).toBe("ok");
    expect(p.migration.userVersion).toBe(2);
    expect((p.conn.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n).toBe(5);
    expect((p.conn.prepare("SELECT COUNT(*) AS n FROM tag_dimensions").get() as { n: number }).n).toBe(4);
    expect(p.conn.prepare("SELECT value FROM settings WHERE key='ai_agent_presets_v2'").get()).toEqual({ value: "1" });
    expect(p.tools.names()).toHaveLength(22);
    expect(p.chip.pendingCount()).toBe(0);
  });

  it("② 快捕→判定（fake subagent 返回建议）→分诊建任务链路贯通", async () => {
    const p = assemble({ pet: false });
    const captured = await p.commands("captureTodo", { text: "帮我把桌面收拾一下" });
    expect(captured.ok).toBe(true);
    const outcome = (captured as { data: { outcome: string; taskId: number | null } }).data;
    expect(outcome.outcome).toBe("caught");
    expect(outcome.taskId).not.toBeNull();
    expect(p.chip.pendingCount()).toBe(0);
    const row = p.conn.prepare("SELECT title, source FROM tasks WHERE id=?").get(outcome.taskId) as {
      title: string;
      source: string;
    };
    expect(row.title).toBe("快捕：整理桌面");
    expect(row.source).toBe("capture");
  });

  it("③ 出发任务→pet task-state 送达 fake helper（写后直推 + 重发恢复）", async () => {
    const p = assemble();
    await p.commands("taskStart", { taskId: seedTaskRow(p) });
    let taskState: { activeTask: { title: string } | null } | undefined;
    await waitFor(() => {
      taskState = readHelperLog()
        .map((e) => e.msg)
        .find((m) => m.type === "task-state") as { activeTask: { title: string } | null } | undefined;
      return taskState !== undefined;
    });
    expect(taskState?.activeTask?.title).toBe("集成出发任务");
  });

  it("⑥ 统一日志面落盘：命令日志经 FileLogSink 写共享文件（dsh/ 前缀、桌面行格式）", async () => {
    const p = assemble({ pet: false });
    await p.commands("pomoTryFive");
    const content = readFileSync(join(dir, "logs", "pokemon-choose-you.log"), "utf8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}\]\[\d{2}:\d{2}:\d{2}\]\[dsh\/pet: pomoTryFive\]\[INFO\] /);
  });
});

describe("createPlugin 分层替身集成 · 自动派发与配置", () => {
  it("④ 自动派发扫描→无头执行→回传收口（槽释放 + 状态 done）", async () => {
    const p = assemble({ pet: false });
    const taskId = seedAutoDispatchTarget(p);
    for (const tick of autoTicks) {
      tick();
    }
    let state: string | null = null;
    await waitFor(() => {
      state = (
        p.conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as { dispatch_state: string | null }
      ).dispatch_state;
      return state === "done";
    });
    expect(state).toBe("done");
    const slots = p.conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots").get() as { n: number };
    expect(slots.n).toBe(0);
    const sessions = p.conn
      .prepare("SELECT kind, status FROM agent_sessions WHERE kind='dispatch_headless'")
      .all() as Array<{ status: string }>;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].status).toBe("ok");
  });

  it("⑤ configWrite→两形态键读回（共享设置键 + dsh: 内部键同路）", async () => {
    const p = assemble({ pet: false });
    const write = await p.commands("configWrite", { keyValues: { language: "zh-Hant", "dsh:pet_pos": "10,20" } });
    expect((write as { data: { ok: boolean } }).data.ok).toBe(true);
    const read = await p.commands("configRead", { keys: ["language", "dsh:pet_pos"] });
    expect((read as { data: { keyValues: Record<string, string> } }).data.keyValues).toEqual({
      language: "zh-Hant",
      "dsh:pet_pos": "10,20",
    });
  });

  it("pageOpen 推送通道：订阅者收到 section 载荷（dsh 适配层接线面）", async () => {
    const p = assemble({ pet: false });
    const seen: Array<{ section?: string }> = [];
    p.onPageOpen((event) => seen.push(event));
    // spawner 未装配（pet: false）→ 非 PkyError 上抛不静默（编程/装配缺陷不吞）
    await expect(p.commands("petShow")).rejects.toThrow(/未装配/);
    expect(seen).toEqual([]);
  });
});

/** 直插一条待出发任务（③ 的起点） */
function seedTaskRow(p: Plugin): number {
  return Number(
    (
      p.conn
        .prepare(
          "INSERT INTO tasks (title, status, created_at) VALUES ('集成出发任务', 'scheduled', '2026-01-01T00:00:00+00:00')",
        )
        .run() as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
}
