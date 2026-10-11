/**
 * dispatch/interactive：交互派发——终端适配器注入 + 会话/执行标识落库
 * （agent_sessions kind=dispatch_interactive）+ claim 互斥（DISPATCH_ALREADY_ACTIVE）+
 * 注入失败迁移 failed + dispatchReport 回传收口（幂等）+ 手动收口兜底（重置/标记）+
 * deployment 免密预检（SSH_AUTH_REQUIRED）。不解析终端输出（A15）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeTerminal,
  dispatchInteractive,
  dispatchReport,
  dispatchReset,
  localDispatchDir,
} from "../src/host/dispatch/interactive";
import { sshCheck, sshProbeArgv, systemSshProbe } from "../src/host/dispatch/sshCheck";
import { agentLine, interactiveArgs, summarizeLine } from "../src/host/dispatch/cmdline";
import { createTestDb, seedTask, type TestDb } from "./helpers";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "Claude",
        command: "claude",
        args: "",
        historyArgs: "--resume",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
});
afterEach(() => {
  db.close();
});

function seedProjectTask(title: string, opts: { meta?: string | null } = {}): number {
  const taskId = seedTask(db.conn, title);
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, opts.meta ?? JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

function state(taskId: number): unknown {
  return (db.conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as { dispatch_state: unknown })
    .dispatch_state;
}

describe("命令行组装（cmdline.rs 同构）", () => {
  it("interactive_args 剔除会话恢复开关（带值旗标的值一并）", () => {
    expect(interactiveArgs("--session-id old-id --resume -p --verbose")).toEqual(["-p", "--verbose"]);
    expect(interactiveArgs("")).toEqual([]);
  });

  it("agent_line 整体引用 prompt（不可信正文不裸拼）；summarize 截断 prompt", () => {
    expect(agentLine("claude", ["-p"], "做点'事' && rm -rf /")).toBe("claude -p '做点'\\''事'\\'' && rm -rf /'");
    const long = "很长的提示词".repeat(20);
    expect(summarizeLine("claude", ["-p"], long)).not.toContain(long);
    expect(summarizeLine("claude", ["-p"], long)).toContain("…");
  });

  it("localDispatchDir：~ 展开 / 绝对路径原样 / 空返回 null（不自动创建）", () => {
    expect(localDispatchDir("")).toBeNull();
    expect(localDispatchDir("/abs/path")).toBe("/abs/path");
    const home = process.env["HOME"] ?? "";
    expect(localDispatchDir("~/x")).toBe(home === "" ? "~/x" : `${home}/x`);
  });
});

describe("交互派发主链路", () => {
  it("注入成功：prompt 定界 + 会话标识落库 + 状态 running 等回传", async () => {
    const terminal = createFakeTerminal();
    const taskId = seedProjectTask("修 bug");
    const outcome = await dispatchInteractive(db.conn, { terminal }, taskId);
    expect(outcome.state).toBe("running");
    expect(outcome.terminal).toBe("fake-terminal");
    expect(terminal.injections).toHaveLength(1);
    // 注入行：命令 + 清洗后的参数 + prompt 首条输入（定界在场，不解析输出——A15）
    expect(terminal.injections[0]?.line).toContain("claude");
    expect(terminal.injections[0]?.line).toContain("===== 待办数据开始 =====");
    expect(terminal.injections[0]?.line).not.toContain("--resume"); // 交互开新会话，恢复开关剔除
    // 落库：kind=dispatch_interactive + 会话/执行标识（fake 终端 pane id）
    const row = db.conn
      .prepare("SELECT kind, session_id, status, command FROM agent_sessions WHERE task_id=?")
      .get(taskId) as Record<string, unknown>;
    expect(row["kind"]).toBe("dispatch_interactive");
    expect(row["session_id"]).toBe(`pane-${taskId}`);
    expect(row["status"]).toBe("ok");
    expect(String(row["command"])).toContain("claude");
  });

  it("重复派发互斥：running 中 → DISPATCH_ALREADY_ACTIVE", async () => {
    const taskId = seedProjectTask("任务");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId);
    await expect(dispatchInteractive(db.conn, { terminal: createFakeTerminal() }, taskId)).rejects.toMatchObject({
      code: "DISPATCH_ALREADY_ACTIVE",
    });
  });

  it("注入失败：迁移 failed + 原因入审计 + DISPATCH_LAUNCH_FAILED", async () => {
    const terminal = createFakeTerminal();
    terminal.failNext("终端面板不存在");
    const taskId = seedProjectTask("任务");
    await expect(dispatchInteractive(db.conn, { terminal }, taskId)).rejects.toMatchObject({
      code: "DISPATCH_LAUNCH_FAILED",
    });
    expect(state(taskId)).toBe("failed");
    const log = db.conn
      .prepare("SELECT new_value, origin FROM task_logs WHERE task_id=? AND field='dispatch_state' ORDER BY id DESC")
      .get(taskId) as { new_value: string; origin: string };
    expect(log.new_value).toMatch(/终端面板不存在/);
    expect(log.origin).toBe("dsh:dispatch-interactive");
  });
});

describe("交互派发前置校验", () => {
  it("本地工作目录先验：不存在 → 参数错；存在放行（目录配错应报错）", async () => {
    const taskId = seedProjectTask("任务", {
      meta: JSON.stringify({ agentId: "ag-1", workdir: "/definitely/missing-pky" }),
    });
    await expect(dispatchInteractive(db.conn, { terminal: createFakeTerminal() }, taskId)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: /派发工作目录不存在/,
    });
    db.conn
      .prepare("UPDATE tags SET meta=? WHERE name='任务'")
      .run(JSON.stringify({ agentId: "ag-1", workdir: db.dir }));
    const outcome = await dispatchInteractive(db.conn, { terminal: createFakeTerminal() }, taskId);
    expect(outcome.state).toBe("running");
  });

  it("deployment 路由：免密预检失败 → SSH_AUTH_REQUIRED（claim 前拦截，不进终端）", async () => {
    const taskId = seedProjectTask("远端任务");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)").run(
      JSON.stringify({
        远端任务: { agentId: "ag-1", deployment: { ref: "dev-box", target: "vscode@localhost:1022" } },
      }),
    );
    const terminal = createFakeTerminal();
    await expect(
      dispatchInteractive(
        db.conn,
        {
          terminal,
          sshCheck: () =>
            Promise.resolve({ ok: false, error: { code: "SSH_AUTH_REQUIRED", message: "SSH 免密预检失败" } }),
        },
        taskId,
      ),
    ).rejects.toMatchObject({ code: "SSH_AUTH_REQUIRED" });
    expect(terminal.injections).toHaveLength(0);
    expect(state(taskId)).toBeNull(); // 预检失败在 claim 前，任务未领取
  });
});

describe("交互派发 deployment 预检", () => {
  it("deployment 路由：预检通过 → 正常注入（远端目录不本地预检）", async () => {
    const taskId = seedProjectTask("远端任务2");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)").run(
      JSON.stringify({
        远端任务2: { agentId: "ag-1", deployment: { ref: "dev-box", target: "vscode@localhost:1022" } },
      }),
    );
    const terminal = createFakeTerminal();
    const outcome = await dispatchInteractive(
      db.conn,
      { terminal, sshCheck: () => Promise.resolve({ ok: true }) },
      taskId,
    );
    expect(outcome.state).toBe("running");
    expect(terminal.injections).toHaveLength(1);
  });
});

describe("dispatchReport（todo_dispatch_done/fail 工具语义 + 手动收口）", () => {
  it("回传收口：running → done/failed + 账本行；已收口幂等（不重复落账）", () => {
    const taskId = seedProjectTask("任务");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId);
    const r1 = dispatchReport(db.conn, taskId, "done", "修复完成，含回归");
    expect(r1.settled).toBe(true);
    expect(r1.state).toBe("done");
    expect(state(taskId)).toBe("done");
    const row = db.conn
      .prepare("SELECT kind, status, exit_code, command FROM agent_sessions WHERE task_id=?")
      .get(taskId) as Record<string, unknown>;
    expect(row["kind"]).toBe("dispatch_interactive");
    expect(row["status"]).toBe("ok");
    expect(row["exit_code"]).toBe(0);
    expect(row["command"]).toBe("修复完成，含回归");
    // 重复回传：幂等成功反馈，不重复落账
    const r2 = dispatchReport(db.conn, taskId, "done", "再次回传");
    expect(r2.settled).toBe(false);
    expect(
      Number(
        (db.conn.prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE task_id=?").get(taskId) as { n: number }).n,
      ),
    ).toBe(1);
    // failed 回传
    const taskId2 = seedProjectTask("任务2");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId2);
    expect(dispatchReport(db.conn, taskId2, "failed", "处理不了").state).toBe("failed");
    expect(
      (db.conn.prepare("SELECT exit_code FROM agent_sessions WHERE task_id=?").get(taskId2) as { exit_code: number })
        .exit_code,
    ).toBe(1);
  });

  it("手动收口兜底——重置（救援卡死 running）", () => {
    const taskId = seedProjectTask("卡死");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId);
    dispatchReset(db.conn, taskId);
    expect(state(taskId)).toBeNull();
    const log = db.conn
      .prepare("SELECT new_value, old_value FROM task_logs WHERE task_id=? AND field='dispatch_state' ORDER BY id DESC")
      .get(taskId) as { new_value: string | null; old_value: string };
    expect(log.new_value).toBeNull(); // mark_dispatch idle 审计 new_value 硬编码 NULL（Rust 同款）
    expect(log.old_value).toBe("running");
  });
});

describe("sshCheck 系统探测器（fake ssh 探测脚本：成功/失败）", () => {
  /** 写一个 fake ssh 脚本（真实子进程路径，bin 注入） */
  function fakeSshScript(body: string): string {
    const path = join(db.dir, "fake-ssh.sh");
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  }

  it("exit 0（带 stderr 告警文本）→ ok", async () => {
    const probe = systemSshProbe(fakeSshScript("echo warning-to-stderr >&2; exit 0"));
    expect(await sshCheck("u@h", { probe })).toEqual({ ok: true });
  });

  it("exit 255 无输出 → ok:false，错误文案取 exec 错误信息", async () => {
    const probe = systemSshProbe(fakeSshScript("exit 255"));
    const outcome = await sshCheck("u@h", { probe });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("SSH_AUTH_REQUIRED");
      expect(outcome.error.message).toMatch(/Command failed|u@h/);
    }
  });

  it("不可达真实目标 → ok:false（SSH_AUTH_REQUIRED，不挂起）", async () => {
    const outcome = await sshCheck("u@nonexistent-host-pky.invalid", { connectTimeoutSecs: 1 });
    expect(outcome.ok).toBe(false);
  });

  it("sshProbeArgv：无端口目标不带 -p", () => {
    expect(sshProbeArgv("u@h")).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "u@h", "true"]);
  });
});

describe("sshCheck 集成（fake 探测器：成功/失败）", () => {
  it("exit 0 → ok；非 0 → SSH_AUTH_REQUIRED（argv 含 BatchMode/ConnectTimeout/端口解析）", async () => {
    const seen: string[][] = [];
    const okProbe = async (argv: string[], opts: { timeoutMs: number }) => {
      seen.push(argv);
      expect(opts.timeoutMs).toBe(15_000);
      return { code: 0, stderr: "" };
    };
    expect(await sshCheck("vscode@localhost:1022", { probe: okProbe })).toEqual({ ok: true });
    expect(seen[0]).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      "1022",
      "--",
      "vscode@localhost",
      "true",
    ]);
    const fail = await sshCheck("u@h", {
      probe: async () => ({ code: 255, stderr: "Permission denied (publickey)." }),
    });
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(fail.error.code).toBe("SSH_AUTH_REQUIRED");
      expect(fail.error.message).toContain("Permission denied");
      expect(fail.error.hint).toMatch(/免密/);
    }
  });
});
