/**
 * tag / category 子命令与标签/分类解析（供 task 等子命令共用；对齐 bin/pk/tag.rs）。
 */
import type { Conn } from "../host/storage/db";
import { listTagDimensions, listTags, createTagInternal } from "../host/domain/vocabulary-tags";
import { listCategories } from "../host/domain/vocabulary";
import { CliError, dbErr, flag, parseArgs, positional, usageErr } from "./cli";

/** 标签名 → id 列表（--tags a,b 按名解析；同名跨维度报错提示归一，未知报错） */
export function resolveTagIds(conn: Conn, spec: string): number[] {
  const names = spec
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (names.length === 0) return [];
  const all = listTags(conn);
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const hits = all.filter((t) => t.name === name);
    if (hits.length === 1) {
      ids.push(hits[0].id);
    } else if (hits.length === 0) {
      unknown.push(name);
    } else {
      const dims = hits.map((t) => t.dimension).join("/");
      throw new CliError(`标签名「${name}」同时存在于维度 ${dims}，请用 pk tag list 确认后在应用里归一`, 1);
    }
  }
  if (unknown.length > 0) {
    throw new CliError(`未知标签：${unknown.join("、")}。可用标签见 pk tag list，或用 pk tag create 新建`, 1);
  }
  return ids;
}

/** 分类名 → id（只认启用中的分类；未知报错） */
export function resolveCategory(conn: Conn, name: string): number {
  const row = conn.prepare("SELECT id FROM categories WHERE name=? AND enabled=1").get(name) as
    { id: number } | undefined;
  if (row === undefined) {
    throw new CliError(`未找到启用中的分类「${name}」。可用分类见 pk category list`, 1);
  }
  return row.id;
}

/** 三态时间值：空串 → null（清空），非空 → 字符串（设置） */
export function timeValue(v: string): string | null {
  return v === "" ? null : v;
}

/** category list（main.rs 的内联分支同构） */
export function runCategory(conn: Conn, rest: readonly string[]): unknown {
  if (rest.length > 0 && rest[0] !== "list") {
    throw usageErr("category 子命令目前只支持 list");
  }
  return { categories: listCategories(conn) };
}

/** tag 子命令：list（含维度）/ create（agent 自助扩词表，origin=agent） */
export function runTag(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0] ?? "list";
  if (sub === "list") {
    return { dimensions: listTagDimensions(conn), tags: listTags(conn) };
  }
  if (sub === "create") {
    const p = parseArgs(rest.slice(1));
    const name = positional(p, 0, "标签名");
    const description = flag(p, "description") ?? "";
    const dimension = flag(p, "dimension") ?? "topic";
    try {
      return { created: createTagInternal(conn, name, description, dimension, "agent") };
    } catch (e) {
      throw dbErr(e);
    }
  }
  throw usageErr(`未知 tag 子命令「${sub}」，可用：list / create`);
}
