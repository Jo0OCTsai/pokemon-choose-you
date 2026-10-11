/**
 * 冷启动种子（D15 / AD §5.3 步骤 4）：内容与主应用 src-tauri/src/db.rs 的
 * DEFAULT_CATEGORIES / DEFAULT_TAG_DIMENSIONS 常量逐字段一致（id/名称/宝可梦/sprite/
 * 描述、维度 key/名称/cardinality/max_tags），按「id 或名字（key）已存在都跳过」幂等。
 */
import type { Conn } from "./db";

/** (id, name, pokemon, sprite, description)：描述喂给 AI 判定（pk context），空串 = 无提示 */
export const DEFAULT_CATEGORIES: ReadonlyArray<{
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  description: string;
}> = [
  {
    id: 1,
    name: "工作",
    pokemon: "皮卡丘",
    sprite: "pikachu",
    description: "职业与产出相关的任务，如写代码、修 bug、写文档",
  },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck", description: "学习、调研与技能提升，如读文档、看课程" },
  { id: 3, name: "生活", pokemon: "妙蛙种子", sprite: "bulbasaur", description: "日常生活事务，如购物、家务、缴费" },
  { id: 4, name: "健康", pokemon: "吉利蛋", sprite: "chansey", description: "健康、运动与就医相关" },
  { id: 5, name: "兴趣", pokemon: "伊布", sprite: "eevee", description: "兴趣与娱乐活动" },
];

/** 内置标签维度（固定 id 1~4）：项目单选，其余多选；topic 收纳无明确归属的标签 */
export const DEFAULT_TAG_DIMENSIONS: ReadonlyArray<{
  id: number;
  key: string;
  name: string;
  cardinality: string;
  maxTags: number;
}> = [
  { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 20 },
  { id: 2, key: "context", name: "场景", cardinality: "multi", maxTags: 10 },
  { id: 3, key: "person", name: "人物", cardinality: "multi", maxTags: 30 },
  { id: 4, key: "topic", name: "主题", cardinality: "multi", maxTags: 30 },
];

/**
 * 写入默认分类与维度种子（幂等，与 db.rs init_conn 同策略）：
 * 「id 或名字（key）已存在都跳过」——改过名的默认分类保留不改，
 * 迁移已补过的分类（id 不在默认位）也不会重复插入。重复执行不报错不产生重复行。
 */
export function seedDefaults(conn: Conn): void {
  const insertCategory = conn.prepare(
    "INSERT INTO categories (id, name, pokemon, sprite, description) " +
      "SELECT ?, ?, ?, ?, ? " +
      "WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id=? OR name=?)",
  );
  for (const c of DEFAULT_CATEGORIES) {
    insertCategory.run(c.id, c.name, c.pokemon, c.sprite, c.description, c.id, c.name);
  }
  // 维度种子同策略：id 或 key 已存在都跳过；sort 跟 id（db.rs params 里 sort=?1）
  const insertDimension = conn.prepare(
    "INSERT INTO tag_dimensions (id, key, name, cardinality, max_tags, sort) " +
      "SELECT ?, ?, ?, ?, ?, ? " +
      "WHERE NOT EXISTS (SELECT 1 FROM tag_dimensions WHERE id=? OR key=?)",
  );
  for (const d of DEFAULT_TAG_DIMENSIONS) {
    insertDimension.run(d.id, d.key, d.name, d.cardinality, d.maxTags, d.id, d.id, d.key);
  }
}
