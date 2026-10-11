/**
 * domain/vocabulary：分类 CRUD（放生级联/最后分类守卫/换装）、标签 CRUD（维度内
 * 重名/配额/停用）、维度更新（key/cardinality 不可改）、会话过滤三态（p2p 拒写）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoryDelete, categoryUpsert, listCategories } from "../src/host/domain/vocabulary";
import {
  createTagInternal,
  dimensionIdByKey,
  dimensionRemaining,
  dimensionUpdate,
  listTags,
  tagDelete,
  tagUpsert,
} from "../src/host/domain/vocabulary-tags";
import { filterList, filterUpsert } from "../src/host/domain/vocabulary-filters";
import { createTestDb, scalar, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("分类", () => {
  it("新增 + 换装（pokemon/sprite 字段）+ 改名去空格 + 启停", () => {
    const created = categoryUpsert(db.conn, {
      name: "新分类",
      pokemon: "伊布",
      sprite: "eevee",
      description: " 兜底 ",
    });
    expect(created.id).toBeGreaterThan(5);
    expect(created.enabled).toBe(true);
    const updated = categoryUpsert(db.conn, { id: created.id, name: "改名", pokemon: "卡比兽", sprite: "snorlax" });
    expect(updated.name).toBe("改名");
    expect(updated.pokemon).toBe("卡比兽");
    expect(listCategories(db.conn).find((c) => c.id === created.id)?.description).toBe("兜底");
    const disabled = categoryUpsert(db.conn, { id: created.id, enabled: false });
    expect(disabled.enabled).toBe(false);
  });

  it("空名 / 重名拒绝；不存在的分类 NOT_FOUND", () => {
    expect(() => categoryUpsert(db.conn, { name: "  " })).toThrowError(/分类名不能为空/);
    expect(() => categoryUpsert(db.conn, { name: "工作" })).toThrowError(/已存在/);
    expect(() => categoryUpsert(db.conn, { id: 999, name: "x" })).toThrowError(/不存在/);
  });

  it("停用最后一个启用分类拒绝（至少保留一个启用）", () => {
    for (const id of [2, 3, 4, 5]) {
      expect(() => categoryUpsert(db.conn, { id, enabled: false })).not.toThrow();
    }
    expect(() => categoryUpsert(db.conn, { id: 1, enabled: false })).toThrowError(/至少保留一个启用中的分类/);
  });

  it("放生级联：任务归第一个启用分类（跳过停用低 id）；返回迁移计数", () => {
    db.conn.prepare("UPDATE categories SET enabled=0 WHERE id=1").run();
    const task = seedTask(db.conn, "迁移任务", {});
    db.conn.prepare("UPDATE tasks SET category_id=2 WHERE id=?").run(task);
    const { movedTaskCount } = categoryDelete(db.conn, 2);
    expect(movedTaskCount).toBe(1);
    expect(scalar(db.conn, "SELECT category_id FROM tasks WHERE id=?", task)).toBe(3);
  });

  it("最后一个分类不可删", () => {
    for (const c of listCategories(db.conn)) {
      if (listCategories(db.conn).length > 1) {
        categoryDelete(db.conn, c.id);
      }
    }
    expect(() => categoryDelete(db.conn, 1)).toThrowError(/至少保留一个分类/);
  });
});

describe("维度", () => {
  it("dimensionIdByKey：空 key 回落 topic；未知拒绝", () => {
    expect(dimensionIdByKey(db.conn, "  ")).toBe(4);
    expect(dimensionIdByKey(db.conn, "project")).toBe(1);
    expect(() => dimensionIdByKey(db.conn, "nope")).toThrowError(/未知标签维度/);
  });

  it("改名 / 调上限（clamp 1..200）/ 停用；key 与 cardinality 不在更新面（传入无通道）", () => {
    const updated = dimensionUpdate(db.conn, { key: "project", name: "项目（改）", maxTags: 99, enabled: false });
    expect(updated.name).toBe("项目（改）");
    expect(updated.maxTags).toBe(99);
    expect(updated.enabled).toBe(false);
    expect(updated.key).toBe("project");
    expect(updated.cardinality).toBe("single");
    expect(() => dimensionUpdate(db.conn, { key: "nope", name: "x" })).toThrowError(/未知标签维度/);
    expect(() => dimensionUpdate(db.conn, { key: "topic", name: " " })).toThrowError(/维度名称不能为空/);
    const clamped = dimensionUpdate(db.conn, { key: "topic", name: "主题", maxTags: 999 });
    expect(clamped.maxTags).toBe(200);
  });

  it("dimensionRemaining：max - used", () => {
    expect(dimensionRemaining(db.conn, 2)).toBe(10);
    createTagInternal(db.conn, "场景1", "", "context", "manual");
    expect(dimensionRemaining(db.conn, 2)).toBe(9);
  });
});

describe("标签", () => {
  it("新建挂维度；同维度重名拒（背包面强校验）；跨维度同名允许", () => {
    const tag = tagUpsert(db.conn, { name: "PokemonApp", dimension: "project", description: "应用开发" });
    expect(tag.dimension).toBe("project");
    expect(tag.origin).toBe("manual");
    expect(() => tagUpsert(db.conn, { name: "PokemonApp", dimension: "project" })).toThrowError(/同名标签/);
    const other = tagUpsert(db.conn, { name: "PokemonApp", dimension: "topic" });
    expect(other.id).not.toBe(tag.id);
  });

  it("空名 / 未知维度 / 配额满 / 维度停用 拒绝", () => {
    expect(() => tagUpsert(db.conn, { name: "  ", dimension: "topic" })).toThrowError(/标签名不能为空/);
    expect(() => tagUpsert(db.conn, { name: "x", dimension: "nope" })).toThrowError(/未知标签维度/);
    for (let i = 0; i < 10; i++) {
      tagUpsert(db.conn, { name: `场景${i}`, dimension: "context" });
    }
    expect(() => tagUpsert(db.conn, { name: "挤不进", dimension: "context" })).toThrowError(/已满/);
    dimensionUpdate(db.conn, { key: "person", name: "人物", enabled: false });
    expect(() => tagUpsert(db.conn, { name: "停用维度", dimension: "person" })).toThrowError(/已停用/);
  });

  it("更新走 id（改名/改描述）；不存在 NOT_FOUND", () => {
    const tag = tagUpsert(db.conn, { name: "原", dimension: "topic" });
    const updated = tagUpsert(db.conn, { id: tag.id, name: "新", dimension: "topic", description: "描述" });
    expect(updated.name).toBe("新");
    expect(updated.description).toBe("描述");
    expect(() => tagUpsert(db.conn, { id: 999, name: "x", dimension: "topic" })).toThrowError(/不存在/);
  });
});

describe("标签·下", () => {
  it("删除级联清 task_tags 关联", () => {
    const tag = tagUpsert(db.conn, { name: "需汇报", dimension: "topic" });
    const task = seedTask(db.conn, "任务A");
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(task, tag.id);
    tagDelete(db.conn, tag.id);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM task_tags")).toBe(0);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tags")).toBe(0);
    expect(() => tagDelete(db.conn, tag.id)).toThrowError(/不存在/);
  });

  it("listTags 带维度/usage（按维度序 + id 序）", () => {
    tagUpsert(db.conn, { name: "重要", dimension: "topic" });
    tagUpsert(db.conn, { name: "P1", dimension: "project" });
    const task = seedTask(db.conn, "任务");
    const important = listTags(db.conn).find((t) => t.name === "重要") as { id: number };
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(task, important.id);
    const tags = listTags(db.conn);
    expect(tags.map((t) => t.dimension)).toEqual(["project", "topic"]);
    expect(tags.find((t) => t.name === "重要")?.usage).toBe(1);
    expect(tags.find((t) => t.name === "P1")?.usage).toBe(0);
  });
});

describe("会话过滤（三态）", () => {
  function seedChat(chatId: string, chatType: string): void {
    db.conn
      .prepare("INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES (?, ?, ?, 'unknown')")
      .run(chatId, `名称 ${chatId}`, chatType);
  }

  it("清单排除私聊；无偏好行 = follow；counts 汇总三态", () => {
    seedChat("oc_g1", "group");
    seedChat("oc_g2", "group");
    seedChat("oc_p1", "p2p");
    filterUpsert(db.conn, "oc_g1", "always_filter");
    filterUpsert(db.conn, "oc_g2", "always_pull");
    const { chats, counts } = filterList(db.conn);
    expect(chats.map((c) => c.chatId)).toEqual(["oc_g1", "oc_g2"]);
    expect(counts).toEqual({ follow: 0, always_filter: 1, always_pull: 1 });
    filterUpsert(db.conn, "oc_g1", "follow");
    expect(filterList(db.conn).counts).toEqual({ follow: 1, always_filter: 0, always_pull: 1 });
  });

  it("follow = 删偏好行；重复 upsert 覆盖（updated_at 刷新）", () => {
    seedChat("oc_g", "group");
    filterUpsert(db.conn, "oc_g", "always_filter", "2026-01-01T00:00:00+00:00");
    filterUpsert(db.conn, "oc_g", "always_pull", "2026-01-02T00:00:00+00:00");
    expect(scalar(db.conn, "SELECT preference FROM chat_filter_prefs WHERE chat_id='oc_g'")).toBe("always_pull");
    filterUpsert(db.conn, "oc_g", "follow");
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_filter_prefs WHERE chat_id='oc_g'")).toBe(0);
  });

  it("p2p 私聊拒写（固定跟随，API 层拦截）", () => {
    seedChat("oc_p2p", "p2p");
    expect(() => filterUpsert(db.conn, "oc_p2p", "always_filter")).toThrowError(/私聊固定跟随/);
    // 快照无行的会话（群聊未知）不阻断
    expect(() => filterUpsert(db.conn, "oc_unknown", "always_filter")).not.toThrow();
  });

  it("机器人单聊（bot）可设（手动偏好对群聊/机器人开放）", () => {
    seedChat("oc_bot", "bot");
    expect(() => filterUpsert(db.conn, "oc_bot", "always_filter")).not.toThrow();
  });
});
