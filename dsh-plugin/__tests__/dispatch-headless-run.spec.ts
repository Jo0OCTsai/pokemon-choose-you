/**
 * dispatch/headlessRun + worktree：远端执行世界（deployment 路由：provider 未装配 /
 * 免密预检拦截）、执行异常封闭（claim 后不泄漏槽/running）、localShellRunner 真实
 * sh 子进程、git worktree 策略（幂等脚本 / 失败降级）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchHeadless } from "../src/host/dispatch/headless";
import { gitWorktree, localShellRunner, noOpWorktree } from "../src/host/dispatch/worktree";
import { createFakeExecutor, type FakeExecutor } from "../src/host/dispatch/executor";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let db: TestDb;
let fake: FakeExecutor;
beforeEach(() => {
  db = createTestDb();
  fake = createFakeExecutor();
});
afterEach(() => {
  db.close();
});

function seedAgent(agentId: string): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: agentId,
        name: `Agent ${agentId}`,
        command: "claude",
        args: "-p {prompt}",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
}

function seedProjectTask(title: string, opts: { meta?: string | null } = {}): number {
  const taskId = seedTask(db.conn, title, { status: "scheduled" });
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

function slotCount(): number {
  return Number((db.conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots").get() as { n: number }).n);
}

function sessionRow(taskId: number): Record<string, unknown> {
  return db.conn.prepare("SELECT * FROM agent_sessions WHERE task_id=? ORDER BY id DESC LIMIT 1").get(taskId) as Record<
    string,
    unknown
  >;
}

describe("远端执行世界（deployment 路由）", () => {
  function seedDeploymentTask(title: string): number {
    const taskId = seedProjectTask(title);
    db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)")
      .run(JSON.stringify({ [title]: { agentId: "ag-1", deployment: { ref: "dev-box", target: "u@h:22" } } }));
    return taskId;
  }

  it("provider 未装配（executorFor 返回 null）→ failed + 未装配 note + 删槽（不抛）", async () => {
    seedAgent("ag-1");
    const taskId = seedDeploymentTask("远端任务");
    const outcome = await dispatchHeadless(db.conn, {}, taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.code).toBe("DISPATCH_LAUNCH_FAILED");
    expect(outcome.note).toMatch(/未装配/);
    expect(state(taskId)).toBe("failed");
    expect(slotCount()).toBe(0);
    expect(fake.jobs).toHaveLength(0); // 未进执行器
  });

  it("免密预检失败 → SSH_AUTH_REQUIRED（claim 前拦截）", async () => {
    seedAgent("ag-1");
    const taskId = seedDeploymentTask("远端任务2");
    await expect(
      dispatchHeadless(
        db.conn,
        { sshCheck: () => Promise.resolve({ ok: false, error: { code: "SSH_AUTH_REQUIRED", message: "免密失败" } }) },
        taskId,
      ),
    ).rejects.toMatchObject({ code: "SSH_AUTH_REQUIRED" });
    expect(state(taskId)).toBeNull();
  });
});

describe("执行异常封闭（claim 后不泄漏槽/running）", () => {
  it("worktree 策略抛错 → failed 收口 + 删槽 + error 账本行", async () => {
    seedAgent("ag-1");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_worktree', 'true')").run();
    const taskId = seedProjectTask("任务", { meta: JSON.stringify({ agentId: "ag-1", workdir: "/tmp/repo" }) });
    const boomWorktree = {
      ensure: () => {
        throw new Error("worktree runner 崩了");
      },
    };
    const outcome = await dispatchHeadless(db.conn, { executorFor: () => fake, worktree: boomWorktree }, taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.note).toMatch(/worktree runner 崩了/);
    expect(outcome.code).toBe("DISPATCH_LAUNCH_FAILED");
    expect(slotCount()).toBe(0);
    expect(state(taskId)).toBe("failed");
    expect(sessionRow(taskId)["status"]).toBe("error");
  });
});

describe("localShellRunner（真实 sh 子进程）", () => {
  it("成功/失败两态", async () => {
    const ok = await localShellRunner("echo pk-wt-ok");
    expect(ok.ok).toBe(true);
    expect(ok.stdout).toContain("pk-wt-ok");
    const bad = await localShellRunner("exit 7");
    expect(bad.ok).toBe(false);
  });
});

describe("worktree 策略", () => {
  it("noOp 直跑原目录；git 策略经注入 runner 执行幂等脚本并换目录", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务");
    const outcome = await dispatchHeadless(db.conn, { executorFor: () => fake, worktree: noOpWorktree() }, taskId);
    expect(outcome.state).toBe("done");
    expect(fake.jobs[0]?.workdir).toBe("");

    // 配置驱动开 git worktree（route 层读 dispatch_worktree=true；meta.workdir 提供仓库目录）
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_worktree', 'true')").run();
    const scripts: string[] = [];
    const gitFake = gitWorktree(async (script) => {
      scripts.push(script);
      return { ok: true, stdout: "PK_WT /tmp/repo-pk-N\n", stderr: "" };
    });
    const taskId2 = seedProjectTask("任务2", { meta: JSON.stringify({ agentId: "ag-1", workdir: "/tmp/repo" }) });
    const out2 = await dispatchHeadless(db.conn, { executorFor: () => fake, worktree: gitFake }, taskId2);
    expect(out2.state).toBe("done");
    expect(out2.note).toContain("worktree 隔离");
    expect(fake.jobs[1]?.workdir).toBe("/tmp/repo-pk-N");
    expect(scripts[0]).toContain("pk-");
    expect(scripts[0]).toContain("git rev-parse --show-toplevel");
    expect(scripts[0]).toContain("/tmp/repo");
  });

  it("runner 成功但无哨兵行 → 输出异常降级原目录", async () => {
    seedAgent("ag-1");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_worktree', 'true')").run();
    const taskId = seedProjectTask("任务", { meta: JSON.stringify({ agentId: "ag-1", workdir: "/tmp/repo" }) });
    const noSentinel = gitWorktree(async () => ({ ok: true, stdout: "some noise", stderr: "" }));
    const outcome = await dispatchHeadless(db.conn, { executorFor: () => fake, worktree: noSentinel }, taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.note).toMatch(/输出异常/);
    expect(fake.jobs[0]?.workdir).toBe("/tmp/repo");
  });

  it("git 失败 → 降级原目录 + note（不阻断执行）", async () => {
    seedAgent("ag-1");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_worktree', 'true')").run();
    const taskId = seedProjectTask("任务", { meta: JSON.stringify({ agentId: "ag-1", workdir: "/tmp/repo" }) });
    const gitFail = gitWorktree(async () => ({ ok: false, stdout: "", stderr: "not a git repo" }));
    const outcome = await dispatchHeadless(db.conn, { executorFor: () => fake, worktree: gitFail }, taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.note).toMatch(/worktree 建立失败/);
    expect(fake.jobs[0]?.workdir).toBe("/tmp/repo"); // 降级用原工作目录
  });
});
