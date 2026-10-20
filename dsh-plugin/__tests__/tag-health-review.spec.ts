/**
 * 标签体检 LLM 复核（domain/tag-health 纯函数半边 + judge/tagHealthReview I/O 半边，
 * 行为基准 = src-tauri tag_health.rs judge_with_agent / parse_verdict / same_pair）：
 * prompt 逐字格式 / verdict 宽容解析 / 防幻觉过滤与方向采纳 / 新维度门槛 /
 * 复核编排四路（无 agent · 复核成功 · 执行失败回落 · 远端绑定无 provider 不冒充）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedAgents, seedTask, type TestDb } from "./helpers";
import type { Conn } from "../src/host/storage/db";
import {
  applyTagHealthVerdict,
  buildTagHealthPrompt,
  localReport,
  parseTagHealthVerdict,
  type MergeCandidate,
} from "../src/host/domain/tag-health";
import { TAG_HEALTH_SYSTEM_PROMPT } from "../src/host/domain/prompts";
import { listTags, type Tag } from "../src/host/domain/vocabulary-tags";
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

const tag = (id: number, name: string, dimension: string, usage: number): Tag => ({
  id,
  name,
  description: "",
  dimension,
  origin: "manual",
  createdAt: "2026-01-01T00:00:00Z",
  usage,
});

const candidate = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  fromId: 2,
  fromName: "工作周报",
  intoId: 1,
  intoName: "周报",
  dimension: "topic",
  similarity: 0.9,
  judged: false,
  reason: null,
  ...over,
});

describe("buildTagHealthPrompt（judge_with_agent prompt 逐字格式）", () => {
  it("系统词 + 按维度分组词表（分组间无换行——原样）+ 候选对编号清单", () => {
    const tags = [tag(1, "周报", "topic", 3), tag(2, "工作周报", "topic", 0), tag(3, "家", "place", 1)];
    const prompt = buildTagHealthPrompt("SYS\n词表：\n", tags, [candidate()]);
    expect(prompt).toBe(
      "SYS\n词表：\n- 维度 topic：周报（3 次）、工作周报（0 次）- 维度 place：家（1 次）\n\n候选对：\n" +
        "1. 「工作周报」vs「周报」（相似度 0.90，维度 topic）\n",
    );
  });

  it("无候选对不追加候选段；默认系统词尾部自带「词表：」框架", () => {
    const prompt = buildTagHealthPrompt(TAG_HEALTH_SYSTEM_PROMPT, [tag(1, "周报", "topic", 3)], []);
    expect(prompt.endsWith("词表：\n- 维度 topic：周报（3 次）")).toBe(true);
    expect(prompt).not.toContain("\n\n候选对：\n");
  });
});

describe("parseTagHealthVerdict（parse_verdict 宽容解析）", () => {
  it("剥 ```json 围栏 + 截首尾花括号 + 字段缺省", () => {
    const out = '前言 ```json\n{"merges":[{"from":"a","into":"b","merge":true}],"extra":1}\n``` 后记';
    expect(parseTagHealthVerdict(out)).toEqual({
      merges: [{ from: "a", into: "b", merge: true, reason: null }],
      newDimensions: [],
    });
    expect(parseTagHealthVerdict("{}")).toEqual({ merges: [], newDimensions: [] });
    expect(
      parseTagHealthVerdict('{"merges":[{"merge":"yes"}],"newDimensions":[{"name":"精力","tags":["a",1]}]}'),
    ).toEqual({
      merges: [{ from: "", into: "", merge: false, reason: null }],
      newDimensions: [{ name: "精力", tags: ["a"], reason: null }],
    });
  });

  it("非 JSON / 无花括号 → 抛错（调用方回落本地预筛）", () => {
    expect(() => parseTagHealthVerdict("我觉得都该合并")).toThrow(/不是合法 JSON/);
    expect(() => parseTagHealthVerdict("{broken")).toThrow(/不是合法 JSON/);
  });
});

describe("applyTagHealthVerdict（防幻觉过滤 + 方向采纳 + 新维度门槛）", () => {
  const tags = [
    tag(1, "周报", "topic", 3),
    tag(2, "工作周报", "topic", 0),
    tag(3, "月报", "topic", 1),
    tag(4, "家", "place", 1),
  ];
  const report = { merges: [candidate()], zombies: [], newDimensions: [], judged: false };

  it("只留 merge=true 且对得上候选对的；LLM 方向（into 在词表）覆盖预筛方向；理由回落预筛", () => {
    const flipped = applyTagHealthVerdict(
      report,
      { merges: [{ from: "周报", into: "工作周报", merge: true, reason: "统一叫法" }], newDimensions: [] },
      tags,
    );
    expect(flipped.judged).toBe(true);
    expect(flipped.merges).toEqual([
      {
        ...candidate(),
        fromId: 1,
        fromName: "周报",
        intoId: 2,
        intoName: "工作周报",
        judged: true,
        reason: "统一叫法",
      },
    ]);
    const denied = applyTagHealthVerdict(
      report,
      {
        merges: [
          { from: "工作周报", into: "周报", merge: false, reason: "含义不同" },
          { from: "月报", into: "周报", merge: true, reason: "幻觉对" },
        ],
        newDimensions: [],
      },
      tags,
    );
    expect(denied.merges).toEqual([]);
    const unknownInto = applyTagHealthVerdict(
      report,
      { merges: [{ from: "工作周报", into: "不存在", merge: true, reason: null }], newDimensions: [] },
      tags,
    );
    expect(unknownInto.merges).toEqual([]); // into 对不上候选对（same_pair 不命中）
    const sameDir = applyTagHealthVerdict(
      report,
      { merges: [{ from: "工作周报", into: "周报", merge: true, reason: null }], newDimensions: [] },
      tags,
    );
    expect(sameDir.merges[0]).toMatchObject({ fromId: 2, intoId: 1, judged: true, reason: null });
  });

  it("新维度：名 ≥2 字 + 归入标签 ≥2 且都在词表（幻觉名剔除）；最多 2 条；僵尸段原样透传", () => {
    const zombies = [{ id: 9, name: "z", dimension: "topic", origin: "ai", createdAt: "2025-01-01T00:00:00Z" }];
    const out = applyTagHealthVerdict(
      { ...report, zombies },
      {
        merges: [],
        newDimensions: [
          { name: "周期", tags: ["周报", "月报", "幻觉"], reason: "按周期分" },
          { name: "x", tags: ["周报", "月报"], reason: null },
          { name: "场所", tags: ["家", "幻觉"], reason: null },
          { name: "第三", tags: ["周报", "家"], reason: null },
          { name: "第四", tags: ["周报", "家"], reason: null },
        ],
      },
      tags,
    );
    expect(out.newDimensions).toEqual([{ name: "周期", tags: ["周报", "月报"], reason: "按周期分" }]);
    expect(out.zombies).toBe(zombies);
    expect(out.judged).toBe(true);
  });
});

describe("tagCheckupReviewed（复核编排四路）", () => {
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
