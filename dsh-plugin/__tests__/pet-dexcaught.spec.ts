/**
 * pet.dexCaught 图鉴已捕捉池（P2 缺口 5，从 pet-statefeed.spec 拆出——棘轮 max-lines）：
 * sys-config.pet.dexCaught = 已完成任务的去重分类精灵集（mate 候选池）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSysConfig } from "../src/host/pet/stateFeed";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("pet.dexCaught", () => {
  it("pet.dexCaught（P2 缺口5）：已完成任务的分类精灵去重集；未完成不入池；空集缺省", () => {
    expect(buildSysConfig(db.conn).pet?.dexCaught).toBeUndefined();
    db.conn
      .prepare(
        "INSERT INTO categories (name, pokemon, sprite) VALUES ('图鉴池甲', 'snorlax', 'snorlax'), ('图鉴池乙', 'eevee', 'eevee')",
      )
      .run();
    const catId = (name: string) =>
      Number((db.conn.prepare("SELECT id FROM categories WHERE name=?").get(name) as { id: number }).id);
    db.conn
      .prepare(
        "INSERT INTO tasks (title, status, category_id, created_at) VALUES ('完工', 'done', ?, '2026-01-01T00:00:00+00:00')",
      )
      .run(catId("图鉴池甲"));
    db.conn
      .prepare(
        "INSERT INTO tasks (title, status, category_id, created_at) VALUES ('进行', 'active', ?, '2026-01-01T00:00:00+00:00')",
      )
      .run(catId("图鉴池乙"));
    expect(buildSysConfig(db.conn).pet?.dexCaught).toEqual(["snorlax"]); // 仅 done 分类精灵
  });
});
