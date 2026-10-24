/**
 * 标签体检 domain（tag-health.ts，行为基准 = src-tauri tag_health.rs 本地部分）：
 * 僵尸判定（manual 不僵尸 / 90 天阈值 / usage>0 排除）+ 近义候选（同维度 0.7 阈 /
 * 跨维度不配 / 方向 usage 高者为 into / 20 对封顶）+ pair_similarity 边界 +
 * 治理动作（tagMerge 迁移关联删源 / tagMoveDimension 建维度与配额）。
 * 真库直插夹具（createTestDb + tags/task_tags）——usage 由 task_tags 计数而来。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, scalar, seedTask, type TestDb } from "./helpers";
import type { Conn } from "../src/host/storage/db";
import { localReport, mergeTag, moveTagsToDimension, pairSimilarity, tagCheckup } from "../src/host/domain/tag-health";
import { listTags } from "../src/host/domain/vocabulary-tags";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

/** 直插标签（含 origin / 创建年龄 / 是否挂任务——usage 由 task_tags 计数而来） */
function seed(
  conn: Conn,
  name: string,
  dimensionKey: string,
  origin: string,
  ageDays: number,
  attach: boolean,
): number {
  const dimId = (conn.prepare("SELECT id FROM tag_dimensions WHERE key=?").get(dimensionKey) as { id: number }).id;
  const createdAt = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const result = conn
    .prepare("INSERT INTO tags (name, description, dimension_id, origin, created_at) VALUES (?, '', ?, ?, ?)")
    .run(name, dimId, origin, createdAt);
  const id = Number(result.lastInsertRowid);
  if (attach) {
    const task = seedTask(conn, `t-${name}`);
    conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(task, id);
  }
  return id;
}

describe("pair_similarity（tag_health.rs 逐字移植）", () => {
  it("相等 1.0 / 双空 0.0 / 单空 0.0", () => {
    expect(pairSimilarity("周报", "周报")).toBe(1);
    expect(pairSimilarity("", "")).toBe(0);
    expect(pairSimilarity("", "周报")).toBe(0);
  });

  it("包含关系（短侧 ≥2 字）直接 0.9", () => {
    expect(pairSimilarity("周报", "工作周报")).toBeGreaterThanOrEqual(0.89);
    expect(pairSimilarity("ab", "ab")).toBe(1);
  });

  it("编辑距离归一：不同义词不达阈 / 一字之差达阈 / 大小写敏感按字符比", () => {
    expect(pairSimilarity("重要", "紧急")).toBeLessThan(0.7);
    expect(pairSimilarity("PokemonApp", "PokemonAPP")).toBeGreaterThanOrEqual(0.7);
  });
});

describe("本地体检 localReport · 僵尸标签", () => {
  it("manual 永不僵尸 / 90 天阈值 / usage>0 排除 / 坏日期不判", () => {
    seed(db.conn, "手建老词", "topic", "manual", 200, false); // 手建：不是僵尸
    seed(db.conn, "幻觉标签", "topic", "ai", 100, false); // AI 建、90+ 天没挂上：僵尸
    seed(db.conn, "新鲜词", "topic", "ai", 3, false); // 太新：观察期未过
    seed(db.conn, "老词", "topic", "agent", 200, false); // agent 建、从未用：僵尸
    seed(db.conn, "在用词", "topic", "ai", 100, true); // 挂上任务：不是僵尸
    seed(db.conn, "边界内", "topic", "nl", 89, false); // 89 天：未过阈值
    seed(db.conn, "边界外", "topic", "nl", 91, false); // 91 天：过阈值
    db.conn
      .prepare(
        "INSERT INTO tags (name, description, dimension_id, origin, created_at) VALUES ('坏日期', '', 4, 'ai', 'x')",
      )
      .run();
    const report = localReport(listTags(db.conn));
    expect(report.zombies.map((z) => z.name)).toEqual(["幻觉标签", "老词", "边界外"]);
    expect(report.zombies[0]).toMatchObject({ dimension: "topic", origin: "ai" });
    expect(report.judged).toBe(false);
    expect(report.newDimensions).toEqual([]);
  });
});

describe("本地体检 localReport · 近义候选", () => {
  it("同维度 0.7 阈内成对；同使用次数保留 id 靠前的（into=id 小侧）", () => {
    seed(db.conn, "周报", "topic", "manual", 200, true);
    seed(db.conn, "工作周报", "topic", "manual", 10, true);
    const report = localReport(listTags(db.conn));
    expect(report.merges).toHaveLength(1);
    expect(report.merges[0].fromName).toBe("工作周报");
    expect(report.merges[0].intoName).toBe("周报");
    expect(report.merges[0].judged).toBe(false);
    expect(report.merges[0].reason).toBeNull();
  });

  it("方向：使用多的一侧为 into", () => {
    seed(db.conn, "周报", "topic", "manual", 1, false); // usage 0
    const popular = seed(db.conn, "工作周报", "topic", "manual", 1, false);
    for (let i = 0; i < 2; i++) {
      const task = seedTask(db.conn, `挂靠${i}`);
      db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(task, popular);
    }
    const report = localReport(listTags(db.conn));
    expect(report.merges).toHaveLength(1);
    expect(report.merges[0].fromName).toBe("周报");
    expect(report.merges[0].intoId).toBe(popular);
  });

  it("维度隔离：跨维度相似不进候选", () => {
    seed(db.conn, "周报", "topic", "manual", 1, false);
    seed(db.conn, "工作周报", "project", "manual", 1, false);
    expect(localReport(listTags(db.conn)).merges).toHaveLength(0);
  });

  it("不同义词不进候选（< 0.7）", () => {
    seed(db.conn, "重要", "topic", "manual", 1, false);
    seed(db.conn, "紧急", "topic", "manual", 1, false);
    expect(localReport(listTags(db.conn)).merges).toHaveLength(0);
  });

  it("候选对封顶 20（公共前缀串两两互含）", () => {
    for (let i = 0; i <= 20; i++) {
      seed(db.conn, `周报${"-".repeat(i)}`, "topic", "manual", 1, false);
    }
    const report = localReport(listTags(db.conn));
    expect(report.merges).toHaveLength(20);
  });
});

describe("tagCheckup（conn 入口）", () => {
  it("词表快照 → 本地报告（judged 恒 false——dsh 无 LLM 复核管线）", () => {
    seed(db.conn, "幻觉标签", "topic", "ai", 100, false);
    seed(db.conn, "周报", "topic", "manual", 1, true);
    seed(db.conn, "工作周报", "topic", "manual", 1, true);
    const report = tagCheckup(db.conn);
    expect(report.zombies.map((z) => z.name)).toEqual(["幻觉标签"]);
    expect(report.merges.map((m) => m.fromName)).toEqual(["工作周报"]);
    expect(report.judged).toBe(false);
  });
});

describe("tagMerge（merge_tag_conn 同构）", () => {
  it("迁移任务关联 + 删除源标签 + 自并拒 + 不存在 NotFound", () => {
    const keep = seed(db.conn, "规范名", "topic", "manual", 1, true);
    const gone = seed(db.conn, "重复名", "topic", "ai", 1, true);
    // gone 再挂一个任务（两条任务都该并到 keep）
    const extra = seedTask(db.conn, "t2");
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(extra, gone);

    mergeTag(db.conn, gone, keep);

    const linked = scalar(
      db.conn,
      "SELECT COUNT(*) FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.id = ?",
      keep,
    );
    expect(linked).toBe(3); // 保留标签原有 1 处 + 被并标签的 2 处全部归位
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tags WHERE id=?", gone)).toBe(0);
    expect(() => mergeTag(db.conn, gone, gone)).toThrowError(/不能合并到自身/);
    expect(() => mergeTag(db.conn, 999, keep)).toThrowError(/不存在/);
    expect(() => mergeTag(db.conn, keep, 999)).toThrowError(/不存在/);
  });
});

describe("tagMoveDimension（move_tags_to_dimension_conn 同构）", () => {
  it("新建维度（multi/30/sort 接尾）+ 幂等重试复用既有", () => {
    const a = seed(db.conn, "深度工作", "topic", "manual", 1, false);
    const b = seed(db.conn, "碎片处理", "topic", "manual", 1, false);
    moveTagsToDimension(db.conn, [a, b], "energy", "精力");
    const dim = db.conn
      .prepare("SELECT key, name, cardinality, max_tags, sort FROM tag_dimensions WHERE key='energy'")
      .get() as { key: string; name: string; cardinality: string; max_tags: number; sort: number };
    expect(dim).toEqual({ key: "energy", name: "精力", cardinality: "multi", max_tags: 30, sort: 5 });
    expect(
      scalar(
        db.conn,
        "SELECT COUNT(*) FROM tags WHERE dimension_id = (SELECT id FROM tag_dimensions WHERE key='energy')",
      ),
    ).toBe(2);
    // 幂等重试：维度已存在，标签已在其中
    expect(() => moveTagsToDimension(db.conn, [a], "energy", "精力")).not.toThrow();
    const tags = listTags(db.conn).filter((t) => t.dimension === "energy");
    expect(tags.map((t) => t.name).sort()).toEqual(["深度工作", "碎片处理"]);
  });

  it("空名 / 空 ids / 非法 key 拒绝", () => {
    const a = seed(db.conn, "深度工作", "topic", "manual", 1, false);
    expect(() => moveTagsToDimension(db.conn, [a], "energy", "  ")).toThrowError(/不能为空/);
    expect(() => moveTagsToDimension(db.conn, [], "energy", "精力")).toThrowError(/不能为空/);
    expect(() => moveTagsToDimension(db.conn, [a], "非法!", "名")).toThrowError(/维度 key/);
    expect(() => moveTagsToDimension(db.conn, [a], "has space", "名")).toThrowError(/维度 key/);
  });

  it("配额：目标维度剩余名额不足报错（context 上限 10）", () => {
    for (let i = 0; i < 10; i++) {
      seed(db.conn, `场景${i}`, "context", "manual", 1, false);
    }
    const extra = seed(db.conn, "挤不进", "topic", "manual", 1, false);
    expect(() => moveTagsToDimension(db.conn, [extra], "context", "场景")).toThrowError(/名额不足/);
  });
});
