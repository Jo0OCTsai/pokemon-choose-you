/**
 * 标签体检 domain（复盘向导「标签体检」步的后端，行为基准 = src-tauri/src/commands/
 * tag_health.rs 的 local_report / merge_tag / move_tags_to_dimension / judge_with_agent）：
 * 本地相似度预筛近义合并候选 + 僵尸标签识别；LLM 复核的 prompt 组装 / verdict 解析 /
 * 防幻觉过滤为纯函数（执行 agent 的 I/O 面在 judge/tagHealthReview.ts）；治理动作
 * （合并/迁维度）由向导逐条触发。
 */
import type { Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";
import { dimensionRemaining, listTags, type Tag } from "./vocabulary-tags";

/** 近义候选门槛：归一化编辑距离 1 - dist/max_len */
const SIMILARITY_THRESHOLD = 0.7;
/** 预筛候选对上限（送 LLM 的 prompt 体积保护） */
const MAX_CANDIDATE_PAIRS = 20;
/** 僵尸标签：创建超过 N 天、从未挂上任务、且非用户手建（AI/捕捉/agent 建的才可能是造词失误） */
const ZOMBIE_MIN_AGE_DAYS = 90;
/** LLM 新维度建议上限（prompt 承诺「最多 2 个」） */
const MAX_NEW_DIMENSIONS = 2;

export interface MergeCandidate {
  fromId: number;
  fromName: string;
  intoId: number;
  intoName: string;
  /** 归属维度 key */
  dimension: string;
  /** 本地预筛相似度 0~1 */
  similarity: number;
  /** LLM 是否已复核确认（false = 仅相似度预筛） */
  judged: boolean;
  reason: string | null;
}

export interface ZombieTag {
  id: number;
  name: string;
  dimension: string;
  origin: string;
  createdAt: string;
}

export interface NewDimensionSuggestion {
  name: string;
  /** 建议归入该维度的既有标签名（LLM 建议，已按词表过滤） */
  tags: string[];
  reason: string | null;
}

export interface TagCheckupReport {
  merges: MergeCandidate[];
  zombies: ZombieTag[];
  newDimensions: NewDimensionSuggestion[];
  /** LLM 是否参与了本次判定（无 agent / 复核失败 = false，按本地预筛展示） */
  judged: boolean;
}

/** 体检入口：词表快照 → 本地报告（只读，不触发 onWrites；LLM 复核见 judge/tagHealthReview） */
export function tagCheckup(conn: Conn): TagCheckupReport {
  return localReport(listTags(conn));
}

/** 本地体检：僵尸标签 + 相似度候选（不判真伪，交给用户或 LLM） */
export function localReport(tags: Tag[]): TagCheckupReport {
  const now = Date.now();
  const zombies = tags
    .filter((t) => {
      if (t.usage !== 0 || (t.origin !== "ai" && t.origin !== "nl" && t.origin !== "agent")) {
        return false; // manual 永不僵尸；挂上任务的也不算
      }
      // created_at 解析失败 = 未知日期，不判僵尸（Rust unwrap_or(false) 口径）
      const ageDays = Math.trunc((now - Date.parse(t.createdAt)) / 86_400_000);
      return Number.isNaN(ageDays) ? false : ageDays > ZOMBIE_MIN_AGE_DAYS;
    })
    .map((t) => ({ id: t.id, name: t.name, dimension: t.dimension, origin: t.origin, createdAt: t.createdAt }));

  const merges: MergeCandidate[] = [];
  outer: for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i];
      const b = tags[j];
      if (a.dimension !== b.dimension) {
        continue;
      }
      const sim = pairSimilarity(a.name, b.name);
      if (sim < SIMILARITY_THRESHOLD) {
        continue;
      }
      // 保留使用多的一侧（次多/零使用的并入）；同使用次数保留 id 靠前的
      const [from, into] = b.usage > a.usage || (b.usage === a.usage && a.id > b.id) ? [a, b] : [b, a];
      merges.push({
        fromId: from.id,
        fromName: from.name,
        intoId: into.id,
        intoName: into.name,
        dimension: a.dimension,
        similarity: sim,
        judged: false,
        reason: null,
      });
      if (merges.length >= MAX_CANDIDATE_PAIRS) {
        break outer;
      }
    }
  }

  return { merges, zombies, newDimensions: [], judged: false };
}

/**
 * 归一化相似度：1 - 编辑距离 / 较长串字符数；互为包含（短侧 >= 2 字）直接视为高度相似。
 * 中文安全（按字符比较），本地词表量级下两两 DP 足够
 */
export function pairSimilarity(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (long.length === 0) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (short.length >= 2) {
    const contains = Array.from({ length: long.length - short.length + 1 }, (_, i) => i).some((i) =>
      short.every((ch, k) => long[i + k] === ch),
    );
    if (contains) {
      return 0.9;
    }
  }
  let prev: number[] = Array.from({ length: short.length + 1 }, (_, i) => i);
  let cur = new Array<number>(short.length + 1).fill(0);
  for (let li = 1; li <= long.length; li++) {
    cur[0] = li;
    for (let si = 1; si <= short.length; si++) {
      const cost = long[li - 1] === short[si - 1] ? 0 : 1;
      cur[si] = Math.min(prev[si] + 1, cur[si - 1] + 1, prev[si - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[short.length] / long.length;
}

// ---- LLM 复核（judge_with_agent 同构的纯函数半边：prompt 组装 / verdict 解析 / 防幻觉过滤） ----

/** agent 输出契约（JudgeVerdict 同构；字段缺省宽容） */
export interface TagHealthVerdict {
  merges: Array<{ from: string; into: string; merge: boolean; reason: string | null }>;
  newDimensions: Array<{ name: string; tags: string[]; reason: string | null }>;
}

/**
 * 复核 prompt：生效系统提示词（尾部已含「词表：\n」框架）+ 按维度分组的词表（含使用次数）
 * + 候选对编号清单。分组间无换行是 judge_with_agent 的原样格式（逐字同构，不做修饰）。
 */
export function buildTagHealthPrompt(system: string, tags: Tag[], merges: MergeCandidate[]): string {
  let prompt = system;
  let dim = "";
  for (const t of tags) {
    if (t.dimension !== dim) {
      dim = t.dimension;
      prompt += `- 维度 ${dim}：`;
    } else {
      prompt += "、";
    }
    prompt += `${t.name}（${t.usage} 次）`;
  }
  if (merges.length > 0) {
    prompt += "\n\n候选对：\n";
    merges.forEach((m, i) => {
      prompt += `${i + 1}. 「${m.fromName}」vs「${m.intoName}」（相似度 ${m.similarity.toFixed(2)}，维度 ${m.dimension}）\n`;
    });
  }
  return prompt;
}

/** 解析 agent 输出：剥 ```json 围栏、截首尾花括号（parse_verdict 同构的宽容解析）；非法 JSON 抛错 */
export function parseTagHealthVerdict(out: string): TagHealthVerdict {
  let s = out.trim();
  if (s.startsWith("```json")) {
    s = s.slice("```json".length);
  }
  while (s.startsWith("```")) {
    s = s.slice(3);
  }
  while (s.endsWith("```")) {
    s = s.slice(0, -3);
  }
  s = s.trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  const slice = a >= 0 && b > a ? s.slice(a, b + 1) : "";
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch (error) {
    throw new Error(`标签体检判定输出不是合法 JSON: ${String(error instanceof Error ? error.message : error)}`);
  }
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const rows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
  return {
    merges: rows(obj.merges).map((m) => ({
      from: str(m.from),
      into: str(m.into),
      merge: m.merge === true,
      reason: optStr(m.reason),
    })),
    newDimensions: rows(obj.newDimensions).map((d) => ({
      name: str(d.name),
      tags: strList(d.tags),
      reason: optStr(d.reason),
    })),
  };
}

/** 判定的 from/into 与候选对是否指同一对标签（方向不敏感） */
function samePair(a: string, b: string, m: MergeCandidate): boolean {
  return (a === m.fromName && b === m.intoName) || (a === m.intoName && b === m.fromName);
}

/**
 * 把 verdict 套回报告：只保留 LLM 确认（merge=true）且能对上预筛候选的对，from/into 都在
 * 词表（同维度）才采用 LLM 给的方向，否则沿用预筛方向；新维度建议只留名≥2 字、归入标签
 * ≥2 个且都真实存在的，最多 2 条。返回 judged=true 的新报告（不改入参）。
 */
export function applyTagHealthVerdict(
  report: TagCheckupReport,
  verdict: TagHealthVerdict,
  tags: Tag[],
): TagCheckupReport {
  const find = (name: string, dimension: string): Tag | undefined =>
    tags.find((t) => t.name === name && t.dimension === dimension);
  const merges: MergeCandidate[] = [];
  for (const v of verdict.merges) {
    if (!v.merge) {
      continue;
    }
    const m = report.merges.find((c) => samePair(v.from, v.into, c));
    if (m === undefined) {
      continue;
    }
    const kept: MergeCandidate = { ...m, judged: true, reason: v.reason ?? m.reason };
    const into = find(v.into, m.dimension);
    const from = find(v.from, m.dimension);
    if (into !== undefined && from !== undefined) {
      kept.fromId = from.id;
      kept.fromName = from.name;
      kept.intoId = into.id;
      kept.intoName = into.name;
    }
    merges.push(kept);
  }
  const names = new Set(tags.map((t) => t.name));
  const newDimensions = verdict.newDimensions
    .filter((d) => Array.from(d.name.trim()).length >= 2 && d.tags.length >= 2)
    .slice(0, MAX_NEW_DIMENSIONS)
    .map((d) => ({ name: d.name.trim(), tags: d.tags.filter((n) => names.has(n)), reason: d.reason }))
    .filter((d) => d.tags.length >= 2);
  return { merges, zombies: report.zombies, newDimensions, judged: true };
}

// ---- 治理动作（向导里逐条触发） ----

/**
 * 合并标签：from 上的任务关联全部改挂 into，随后删除 from。
 * 用户确认过的方向，不必再走确认门（merge_tag_conn 同构）
 */
export function mergeTag(conn: Conn, fromId: number, intoId: number): void {
  if (fromId === intoId) {
    throw paramError("不能合并到自身");
  }
  for (const id of [fromId, intoId]) {
    const row = conn.prepare("SELECT COUNT(*) AS n FROM tags WHERE id=?").get(id) as { n: number };
    if (Number(row.n) === 0) {
      throw notFound(`标签 ${id} 不存在`);
    }
  }
  conn
    .prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT task_id, ? FROM task_tags WHERE tag_id = ?")
    .run(intoId, fromId);
  conn.prepare("DELETE FROM task_tags WHERE tag_id=?").run(fromId);
  conn.prepare("DELETE FROM tags WHERE id=?").run(fromId);
}

/**
 * 采纳新维度建议：建维度并把既有标签迁过去（维度已存在则复用，幂等支持重试）；
 * 配额不足时报错，已迁移的不回滚（move_tags_to_dimension_conn 同构）
 */
export function moveTagsToDimension(conn: Conn, tagIds: number[], key: string, name: string): void {
  const trimmedName = name.trim();
  if (trimmedName === "" || tagIds.length === 0) {
    throw paramError("维度名与标签列表不能为空");
  }
  const exists = conn.prepare("SELECT id FROM tag_dimensions WHERE key=?").get(key) as { id: number } | undefined;
  let dimId: number;
  if (exists !== undefined) {
    dimId = Number(exists.id);
  } else {
    const normalized = key.trim().toLowerCase();
    if (normalized === "" || !/^[a-z0-9_-]+$/.test(normalized)) {
      throw paramError("维度 key 只能包含小写字母、数字、-、_");
    }
    const sort = (conn.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM tag_dimensions").get() as { s: number }).s;
    const result = conn
      .prepare("INSERT INTO tag_dimensions (key, name, cardinality, max_tags, sort) VALUES (?, ?, 'multi', 30, ?)")
      .run(normalized, trimmedName, sort);
    dimId = Number(result.lastInsertRowid);
  }
  // 配额：目标维度剩余名额须覆盖「尚未在该维度的标签」数
  const placeholders = tagIds.map(() => "?").join(",");
  const incoming = (
    conn
      .prepare(`SELECT COUNT(*) AS n FROM tags WHERE id IN (${placeholders}) AND dimension_id != ?`)
      .get(...tagIds, dimId) as { n: number }
  ).n;
  if (dimensionRemaining(conn, dimId) < incoming) {
    throw paramError("目标维度剩余名额不足，先清理或调高上限");
  }
  conn.prepare(`UPDATE tags SET dimension_id=? WHERE id IN (${placeholders})`).run(dimId, ...tagIds);
}
