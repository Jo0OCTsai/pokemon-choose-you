/**
 * 标签体检 LLM 复核编排（judge/tagHealthReview 的 I/O 半边）：无 agent · 复核成功 ·
 * 执行失败回落 · 远端绑定无 provider 不冒充 四路；纯函数半边见 tag-health-verdict.spec。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedAgents, seedTask, type TestDb } from "./helpers";
import type { Conn } from "../src/host/storage/db";
import { localReport } from "../src/host/domain/tag-health";
import { TAG_HEALTH_SYSTEM_PROMPT } from "../src/host/domain/prompts";
import { listTags } from "../src/host/domain/vocabulary-tags";
import { tagCheckupReviewed, type TagHealthReviewDeps } from "../src/host/judge/tagHealthReview";
import type { DispatchJob, ExecOutcome } from "../src/host/dispatch/executor";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seed(conn: Conn, name: string, dimensionKey: string, usage = 0): number {
  const dimId = (conn.prepare("SELECT id FROM tag_dimensions WHERE key=?").get(dimensionKey) as { id: number }).id;
  const id = Number(
    conn
      .prepare("INSERT INTO tags (name, description, dimension_id, origin, created_at) VALUES (?, '', ?, 'manual', ?)")
      .run(name, dimId, new Date().toISOString()).lastInsertRowid,
  );
  for (let i = 0; i < usage; i += 1) {
    conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(seedTask(conn, `t-${name}-${i}`), id);
  }
  return id;
}

/** 复核编排用 deps 装配：注入执行器（记录 job / 回放 outcome 或抛错）+ warn 收集 */
function depsWith(
  outcome: Partial<ExecOutcome> | Error | null,
  opts: { provider?: boolean } = {},
): { deps: TagHealthReviewDeps; jobs: DispatchJob[]; warns: string[] } {
  const jobs: DispatchJob[] = [];
  const warns: string[] = [];
  const deps: TagHealthReviewDeps = {
    conn: db.conn,
    dispatchDeps: {
      executorFor:
        opts.provider === false
          ? () => null
          : () => ({
              async launch(job) {
                jobs.push(job);
                if (outcome instanceof Error) {
                  throw outcome;
                }
                return { exitCode: 0, durationMs: 1, stdout: "", timedOut: false, ...(outcome ?? {}) };
              },
              kill: () => undefined,
            }),
    },
    log: (level, _target, message) => {
      if (level === "warn") warns.push(message);
    },
  };
  return { deps, jobs, warns };
}

describe("tagCheckupReviewed（复核编排：无 agent / 有 agent / 信封解包）", () => {
  it("无 agent → 本地预筛（judged=false），不唤起执行器", async () => {
    seed(db.conn, "周报", "topic", 3);
    seed(db.conn, "工作周报", "topic");
    const { deps, jobs } = depsWith(null);
    const report = await tagCheckupReviewed(deps);
    expect(report).toMatchObject({
      judged: false,
      merges: [{ fromName: "工作周报", intoName: "周报", judged: false }],
    });
    expect(jobs).toHaveLength(0);
  });

  it("有 agent → prompt 带词表与候选对（凭据环境同链）；verdict 套回 judged=true", async () => {
    seed(db.conn, "周报", "topic", 3);
    seed(db.conn, "工作周报", "topic");
    seedAgents(db.conn, [{ id: "ag-1", command: "claude" }]);
    const verdict = {
      merges: [{ from: "工作周报", into: "周报", merge: true, reason: "同义" }],
      newDimensions: [],
    };
    const { deps, jobs } = depsWith({ stdout: `\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\`` });
    const report = await tagCheckupReviewed(deps);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ command: "claude", timeoutSecs: 120 });
    expect(jobs[0]!.prompt.startsWith(TAG_HEALTH_SYSTEM_PROMPT)).toBe(true);
    expect(jobs[0]!.prompt).toContain("- 维度 topic：周报（3 次）、工作周报（0 次）");
    expect(jobs[0]!.prompt).toContain("1. 「工作周报」vs「周报」（相似度 0.90，维度 topic）");
    expect(report.judged).toBe(true);
    expect(report.merges).toEqual([
      expect.objectContaining({ fromName: "工作周报", intoName: "周报", judged: true, reason: "同义" }),
    ]);
  });

  it("claude JSON 信封（result 字段）先解包再解析 verdict", async () => {
    seed(db.conn, "周报", "topic", 3);
    seed(db.conn, "工作周报", "topic");
    seedAgents(db.conn, [{ id: "ag-1" }]);
    const inner = JSON.stringify({ merges: [{ from: "工作周报", into: "周报", merge: true }] });
    const { deps } = depsWith({ stdout: JSON.stringify({ result: inner, session_id: "s" }) });
    const report = await tagCheckupReviewed(deps);
    expect(report.judged).toBe(true);
    expect(report.merges).toHaveLength(1);
  });
});

describe("tagCheckupReviewed（失败回落与远端不冒充）", () => {
  it("执行失败（启动错 / 超时 / 非零退出 / 非 JSON 输出）→ warn + 本地预筛回落（judged=false）", async () => {
    seed(db.conn, "周报", "topic", 3);
    seed(db.conn, "工作周报", "topic");
    seedAgents(db.conn, [{ id: "ag-1" }]);
    for (const outcome of [
      { error: "ENOENT" },
      { timedOut: true },
      { exitCode: 2 },
      { stdout: "我觉得都该合并" },
      new Error("spawn boom"),
    ]) {
      const { deps, warns } = depsWith(outcome);
      const report = await tagCheckupReviewed(deps);
      expect(report.judged).toBe(false);
      expect(report.merges).toHaveLength(1);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("LLM 判定失败");
    }
  });

  it("主 agent 绑定远端部署且 provider 未装配 → 不以本机 CLI 冒充：warn + 本地预筛", async () => {
    seed(db.conn, "周报", "topic", 3);
    seedAgents(db.conn, [{ id: "ag-1", deployment: "gpu-1" }]);
    const { deps, jobs, warns } = depsWith(null, { provider: false });
    const report = await tagCheckupReviewed(deps);
    expect(report.judged).toBe(false);
    expect(jobs).toHaveLength(0);
    expect(warns[0]).toContain("provider 未装配");
  });

  it("本地预筛结果与 localReport(listTags) 一致（复核只在其上套 verdict）", async () => {
    seed(db.conn, "周报", "topic", 3);
    seed(db.conn, "工作周报", "topic");
    const { deps } = depsWith(null);
    expect(await tagCheckupReviewed(deps)).toEqual(localReport(listTags(db.conn)));
  });
});
