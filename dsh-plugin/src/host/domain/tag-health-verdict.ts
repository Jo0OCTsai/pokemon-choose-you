/**
 * 标签体检 LLM 复核的纯函数半边（行为基准 = tag_health.rs judge_with_agent 同构）：
 * 复核 prompt 组装 / verdict 宽容解析 / 防幻觉过滤套回报告。本地预筛与治理动作在
 * tag-health.ts；执行 agent 的 I/O 面在 judge/tagHealthReview.ts。
 */
import type { Tag } from "./vocabulary-tags";
import type { MergeCandidate, TagCheckupReport } from "./tag-health";

/** LLM 新维度建议上限（prompt 承诺「最多 2 个」） */
const MAX_NEW_DIMENSIONS = 2;

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
