/**
 * dispatch/interactive：交互派发——终端适配器注入 + 会话/执行标识落库
 * （agent_sessions kind=dispatch_interactive）+ claim 互斥（DISPATCH_ALREADY_ACTIVE）+
 * 注入失败迁移 failed + dispatchReport 回传收口（幂等）+ 手动收口兜底（重置/标记）+
 * 终端偏好随注入传递 + deployment 免密预检（SSH_AUTH_REQUIRED——sshCheck 探测器
 * 细节见 dispatch-ssh-check.spec）。不解析终端输出（A15）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchInteractive, dispatchReport, dispatchReset, localDispatchDir } from "../src/host/dispatch/interactive";
import { createFakeTerminal } from "../src/host/dispatch/terminalAdapters";
import { agentLine, cdSegment, interactiveArgs, summarizeLine } from "../src/host/dispatch/cmdline";
import { createTestDb, seedAgents, seedTask, type TestDb } from "./helpers";

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

  it("cdSegment：~ 前缀波浪号裸拼（引号会阻断远端 $HOME 展开），余部与普通路径整体引用", () => {
    expect(cdSegment("~/.choose-you/workspace")).toBe("cd ~/.choose-you/workspace");
    expect(cdSegment("~/my dir/app")).toBe("cd ~'/my dir/app'");
    expect(cdSegment("~")).toBe("cd ~");
    expect(cdSegment("/srv/app")).toBe("cd /srv/app");
    expect(cdSegment("workspaces/foo")).toBe("cd workspaces/foo");
    expect(cdSegment("my app")).toBe("cd 'my app'");
  });
});

describe("交互派发主链路", () => {
  it("注入成功：注入行含预生成会话旗标（claude）+ prompt 定界，恢复开关剔除", async () => {
    const terminal = createFakeTerminal();
    const taskId = seedProjectTask("修 bug");
    const outcome = await dispatchInteractive(db.conn, { terminal }, taskId);
    expect(outcome.state).toBe("running");
    expect(outcome.terminal).toBe("fake-terminal");
    expect(terminal.injections).toHaveLength(1);
    // 注入行：命令 + 清洗后的参数 + 预生成会话旗标（claude 回放精确 --resume 的句柄源）
    // + prompt 首条输入（定界在场，不解析输出——A15）
    const line = terminal.injections[0]?.line ?? "";
    expect(line).toContain("claude");
    expect(line).toMatch(/--session-id [0-9a-f-]{36}/);
    expect(line).toContain("===== 待办数据开始 =====");
    expect(line).not.toContain("--resume"); // 交互开新会话，恢复开关剔除
  });

  it("注入成功落库：fake 终端 pane 句柄优先落 session_id + 预生成 id 回写 dispatched_session", async () => {
    const terminal = createFakeTerminal();
    const taskId = seedProjectTask("修 bug·落账");
    await dispatchInteractive(db.conn, { terminal }, taskId);
    const preId = terminal.injections[0]?.line.match(/--session-id ([0-9a-f-]{36})/)?.[1] ?? "";
    expect(preId).not.toBe("");
    // 落库：kind=dispatch_interactive + 会话/执行标识（fake 终端 pane id 优先于预生成 id）
    const row = db.conn
      .prepare("SELECT kind, session_id, status, command FROM agent_sessions WHERE task_id=?")
      .get(taskId) as Record<string, unknown>;
    expect(row["kind"]).toBe("dispatch_interactive");
    expect(row["session_id"]).toBe(`pane-${taskId}`);
    expect(row["status"]).toBe("ok");
    expect(String(row["command"])).toContain("claude");
    // 预生成 id 回写 tasks.dispatched_session（后续无头轮次续接不断层——planHeadlessRun 同款）
    const task = db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId) as {
      dispatched_session: string | null;
    };
    expect(task.dispatched_session).toBe(preId);
  });
});

describe("派发互斥与失败收口", () => {
  it("重复派发互斥：running 中 → DISPATCH_ALREADY_ACTIVE", async () => {
    const taskId = seedProjectTask("任务");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId);
    await expect(dispatchInteractive(db.conn, { terminal: createFakeTerminal() }, taskId)).rejects.toMatchObject({
      code: "DISPATCH_ALREADY_ACTIVE",
    });
  });

  it("注入失败：迁移 failed + 原因入审计 + DISPATCH_LAUNCH_FAILED；预生成 id 不回写（会话未起）", async () => {
    const terminal = createFakeTerminal();
    terminal.failNext("终端面板不存在");
    const taskId = seedProjectTask("任务");
    await expect(dispatchInteractive(db.conn, { terminal }, taskId)).rejects.toMatchObject({
      code: "DISPATCH_LAUNCH_FAILED",
    });
    expect(state(taskId)).toBe("failed");
    const task = db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId) as {
      dispatched_session: string | null;
    };
    expect(task.dispatched_session).toBeNull();
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

  it("agent 绑定部署：免密预检失败 → SSH_AUTH_REQUIRED（claim 前拦截，不进终端）", async () => {
    const taskId = seedProjectTask("远端任务");
    seedAgents(db.conn, [{ id: "ag-1", deployment: "dev-box" }]); // 执行世界单源：显式绑定
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
  it("agent 绑定部署：预检通过 → 正常注入（远端目录不本地预检）", async () => {
    const taskId = seedProjectTask("远端任务2");
    seedAgents(db.conn, [{ id: "ag-1", deployment: "dev-box" }]); // 执行世界单源：显式绑定
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

describe("终端偏好随注入传递", () => {
  it("terminal_preference 落库值 → inject 入参（未设 = null）", async () => {
    const terminal = createFakeTerminal();
    await dispatchInteractive(db.conn, { terminal }, seedProjectTask("偏好终端·未设"));
    expect(terminal.injections[0]?.terminalPreference).toBeNull(); // 未设置
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('terminal_preference', 'iterm2')").run();
    await dispatchInteractive(db.conn, { terminal }, seedProjectTask("偏好终端·iterm2"));
    expect(terminal.injections[1]?.terminalPreference).toBe("iterm2");
  });
});
