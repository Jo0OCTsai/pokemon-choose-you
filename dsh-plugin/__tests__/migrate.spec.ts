/**
 * storage/migrate + seed：guarded 迁移（D29 封顶 = 打包契约版、超窗只读）、schema 字节
 * 同源断言（AD §4.4）、D29 同版发版断言（发布检查单机器面）、冷启动种子幂等（D15）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import schemaRaw from "../src/host/storage/schema-raw";
import { open, getUserVersion } from "../src/host/storage/db";
import {
  loadSchemaSql,
  MAX_SCHEMA,
  migrate,
  MIN_SCHEMA,
  registerEmbeddedSchemas,
  SCHEMA_FILES,
} from "../src/host/storage/migrate";
import { initConn, openAndInit } from "../src/host/storage/init";
import { DEFAULT_CATEGORIES, DEFAULT_TAG_DIMENSIONS, seedDefaults } from "../src/host/storage/seed";
import { createTestDb } from "./helpers";

const REPO_CONTRACTS = join(import.meta.dirname, "../../contracts/schema");

describe("schema 字节同源（AD §4.4：内嵌与磁盘文件比对断言）", () => {
  it("内嵌（vite ?raw）与磁盘 contracts/schema 逐字节相等", () => {
    for (const file of SCHEMA_FILES) {
      expect(schemaRaw[file]).toBe(readFileSync(join(REPO_CONTRACTS, file), "utf8"));
    }
  });

  it("loadSchemaSql 默认 fs 路径可达且与内嵌同源（双 loader 汇合点）", () => {
    for (const file of SCHEMA_FILES) {
      const { sql, source } = loadSchemaSql(file);
      expect(source).toBe("fs");
      expect(sql).toBe(schemaRaw[file]);
    }
  });

  it("注册内嵌后优先走 embedded 来源", () => {
    registerEmbeddedSchemas({ ...schemaRaw });
    const { source } = loadSchemaSql(SCHEMA_FILES[0]);
    expect(source).toBe("embedded");
  });

  it("两种来源都缺失时报装配错误（不静默降级）", () => {
    registerEmbeddedSchemas({});
    expect(() => loadSchemaSql("999_missing.sql")).toThrowError(/找不到契约 schema/);
    registerEmbeddedSchemas({ ...schemaRaw });
  });
});

describe("guarded 迁移（AD §5.3 / A19）", () => {
  it("空库 → 迁移至 minSchema=1 + 种子（D15 冷启动）", () => {
    const db = createTestDb();
    try {
      expect(getUserVersion(db.conn)).toBe(1);
      const cats = db.conn.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
      expect(cats.n).toBe(5);
    } finally {
      db.close();
    }
  });

  it("重复 init 幂等：版本不变、种子不重复", () => {
    const db = createTestDb();
    try {
      initConn(db.conn);
      initConn(db.conn);
      expect(getUserVersion(db.conn)).toBe(1);
      const cats = db.conn.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
      const dims = db.conn.prepare("SELECT COUNT(*) AS n FROM tag_dimensions").get() as { n: number };
      expect(cats.n).toBe(5);
      expect(dims.n).toBe(4);
    } finally {
      db.close();
    }
  });

  it("迁移封顶 = 打包契约版（D29）：当前打包 1 份 SQL，冷启动迁满到 1", () => {
    expect(MIN_SCHEMA).toBe(1);
    expect(MAX_SCHEMA).toBe(1);
    expect(MAX_SCHEMA).toBe(SCHEMA_FILES.length);
  });
});

describe("D29 同版发版断言（FR-X9-2 发布检查单机器面）", () => {
  it("窗口上限与打包 SQL 数量同版：MAX_SCHEMA === SCHEMA_FILES.length", () => {
    expect(MAX_SCHEMA).toBe(SCHEMA_FILES.length);
  });

  it("内嵌键集 === SCHEMA_FILES 文件集 === contracts/schema 磁盘文件集（三方同版）", () => {
    const disk = readdirSync(REPO_CONTRACTS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect([...SCHEMA_FILES].sort()).toEqual(disk);
    expect(Object.keys(schemaRaw).sort()).toEqual(disk);
  });
});

describe("guarded 迁移（AD §5.3 / A19）·下", () => {
  it("库版本 > maxSchema → 只读模式标记（DB_SCHEMA_TOO_NEW 语义），不迁移不动库", () => {
    const db = createTestDb();
    const fresh = open(join(db.dir, "future.db"));
    try {
      fresh.exec("CREATE TABLE marker (x)");
      fresh.exec("PRAGMA user_version = 2;");
      const result = migrate(fresh);
      expect(result.mode).toBe("readonly");
      expect(result.userVersion).toBe(2);
      expect(result.pluginWindow).toEqual({ min: 1, max: 1 });
      // 只读：initConn 不写种子、不迁移（FR-X2 浏览不损坏）
      const afterInit = initConn(fresh);
      expect(afterInit.mode).toBe("readonly");
      const tables = fresh.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get();
      expect(tables).toEqual({ n: 1 }); // 只有 marker，没有业务表
    } finally {
      fresh.close();
      db.close();
    }
  });

  it("老库（表已建但 user_version=0）前滚到 1：数据保留、幂等建表不报错", () => {
    const db = createTestDb();
    const legacy = open(join(db.dir, "legacy.db"));
    try {
      // 模拟迁移机制引入前的老路径建表（未写 user_version）
      legacy.exec(loadSchemaSql(SCHEMA_FILES[0]).sql);
      legacy.exec("PRAGMA user_version = 0;");
      legacy.prepare("INSERT INTO tasks (title, status, created_at) VALUES ('老任务', 'inbox', 't')").run();
      const result = migrate(legacy);
      expect(result.mode).toBe("ok");
      expect(result.userVersion).toBe(1);
      const title = legacy.prepare("SELECT title FROM tasks LIMIT 1").get();
      expect(title).toEqual({ title: "老任务" });
      // 派发协调表/列在位
      const slots = legacy.prepare("SELECT name FROM sqlite_master WHERE name='dispatch_slots'").get();
      expect(slots).toEqual({ name: "dispatch_slots" });
      const cols = legacy.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toContain("judge_claimed_at");
    } finally {
      legacy.close();
      db.close();
    }
  });
});

describe("guarded 迁移（AD §5.3 / A19）·下", () => {
  it("openAndInit 冷启动建目录建库（库文件不存在 → data/ 目录自动创建）", () => {
    const db = createTestDb();
    const nested = join(db.dir, "deep", "nested", "cold.db");
    const { conn, migration } = openAndInit(nested);
    try {
      expect(migration.mode).toBe("ok");
      expect(getUserVersion(conn)).toBe(1);
      expect(conn.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 5 });
    } finally {
      conn.close();
      db.close();
    }
  });
});

describe("冷启动种子（D15：与 db.rs 常量逐字段一致 + 幂等跳过）", () => {
  it("默认分类 5 项：id/名称/宝可梦/sprite/描述逐字段一致（第一个分类固定 id=1）", () => {
    const db = createTestDb();
    try {
      const rows = db.conn
        .prepare("SELECT id, name, pokemon, sprite, description FROM categories ORDER BY id")
        .all() as Array<{ id: number; name: string; pokemon: string; sprite: string; description: string }>;
      expect(rows).toEqual(DEFAULT_CATEGORIES.map((c) => ({ ...c })));
      expect(rows[0]).toEqual({
        id: 1,
        name: "工作",
        pokemon: "皮卡丘",
        sprite: "pikachu",
        description: "职业与产出相关的任务，如写代码、修 bug、写文档",
      });
      expect(rows.map((r) => r.name)).toEqual(["工作", "学习", "生活", "健康", "兴趣"]);
      expect(rows.every((r) => r.description !== "")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("默认维度 4 项：固定 id 1~4、project 单选、sort=id、topic 兜底位", () => {
    const db = createTestDb();
    try {
      const rows = db.conn
        .prepare("SELECT id, key, name, cardinality, max_tags, sort FROM tag_dimensions ORDER BY id")
        .all() as Array<{ id: number; key: string; name: string; cardinality: string; max_tags: number; sort: number }>;
      expect(rows).toEqual(
        DEFAULT_TAG_DIMENSIONS.map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          cardinality: d.cardinality,
          max_tags: d.maxTags,
          sort: d.id,
        })),
      );
      expect(rows).toEqual([
        { id: 1, key: "project", name: "项目", cardinality: "single", max_tags: 20, sort: 1 },
        { id: 2, key: "context", name: "场景", cardinality: "multi", max_tags: 10, sort: 2 },
        { id: 3, key: "person", name: "人物", cardinality: "multi", max_tags: 30, sort: 3 },
        { id: 4, key: "topic", name: "主题", cardinality: "multi", max_tags: 30, sort: 4 },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("冷启动种子（D15：与 db.rs 常量逐字段一致 + 幂等跳过）·下", () => {
  it("幂等跳过：id 或名字（key）已存在都不插（改名后的默认分类保留不改）", () => {
    const db = createTestDb();
    try {
      // 改名 id=1 的分类
      db.conn.prepare("UPDATE categories SET name='我自己的' WHERE id=1").run();
      seedDefaults(db.conn);
      const rows = db.conn.prepare("SELECT id, name FROM categories ORDER BY id").all() as Array<{
        id: number;
        name: string;
      }>;
      // id=1 被「id 已存在」跳过（名字不再是「工作」也不会重复插入默认工作分类）
      expect(rows.find((r) => r.id === 1)?.name).toBe("我自己的");
      expect(rows.some((r) => r.name === "工作")).toBe(false);
      expect(rows.length).toBe(5);
      // 维度：改 key 前提下 id 已存在也跳过
      db.conn.prepare("UPDATE tag_dimensions SET key='renamed' WHERE id=2").run();
      seedDefaults(db.conn);
      const dims = db.conn.prepare("SELECT COUNT(*) AS n FROM tag_dimensions").get();
      expect(dims).toEqual({ n: 4 });
    } finally {
      db.close();
    }
  });
});
