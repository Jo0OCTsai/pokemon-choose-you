/**
 * 契约回放 harness · 归一化与终态：invariants 断言集、<ts:N> 时间戳归一（值等价类
 * → 出现序占位符）、<alias:N> 别名归一（A18：<alias:N> 按场景内出现序，有主别名按
 * open_id 记账、无主按别名串记账）。全部为 Rust oracle 同名逻辑的逐条镜像。
 */
import type { Conn } from "../../src/host/storage/db";
import { dumpFinal, type OpCtx } from "./harness";

/** concurrency 组不变式断言集（oracle 侧断言数字进夹具，TS 侧对齐同一组数字） */
export function invariants(conn: Conn, writeOps: number): Record<string, unknown> {
  const n = (sql: string): number => Number((conn.prepare(sql).get() as { n: number }).n);
  const active = n("SELECT COUNT(*) AS n FROM tasks WHERE status='active'");
  const msgsWithTask = n("SELECT COUNT(*) AS n FROM chat_messages WHERE task_id IS NOT NULL");
  const distinctTasks = n("SELECT COUNT(DISTINCT task_id) AS n FROM chat_messages WHERE task_id IS NOT NULL");
  const dupNotes = n(
    "SELECT COUNT(*) AS n FROM (SELECT task_id, content FROM task_notes WHERE source='ai' GROUP BY task_id, content HAVING COUNT(*) > 1)",
  );
  const slotsByHost: Record<string, number> = {};
  for (const r of conn.prepare("SELECT host_key, COUNT(*) AS n FROM dispatch_slots GROUP BY host_key").all() as Array<
    Record<string, unknown>
  >) {
    slotsByHost[String(r.host_key)] = Number(r.n);
  }
  return {
    activeCount: active,
    auditRows: n("SELECT COUNT(*) AS n FROM task_logs"),
    dupSuggestionTasks: msgsWithTask - distinctTasks,
    dupFollowupNotes: dupNotes,
    slotsByHost,
    successfulWriteOps: writeOps,
  };
}

// ---- 时间戳归一（完整 RFC3339 → <ts:N>；同值同占位符） ----

/** 完整 RFC3339（含秒与 Z/±HH:MM 偏移，可选小数位 ≥1；本地 datetime-local
 * （如 2026-09-13T10:00，无秒无偏移）不匹配——属业务数据不归一。与 Rust oracle
 * is_full_rfc3339 的逐位判定语义等价（正则承载，控复杂度棘轮口径）。 */
const FULL_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isFullRfc3339(s: string): boolean {
  return FULL_RFC3339.test(s);
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** 对象键按字典序遍历（Rust serde_json BTreeMap 同序；数组按下标序） */
function sortedEntries(v: { [k: string]: Json }): Array<[string, Json]> {
  return Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 第一遍：完整 RFC3339 → <ts:N>（出现序；同值同占位符） */
export function normalizeTimestamps(v: Json, seen = new Map<string, string>()): Json {
  let next = seen.size;
  const walk = (node: Json): Json => {
    if (typeof node === "string") {
      if (!isFullRfc3339(node)) {
        return node;
      }
      let ph = seen.get(node);
      if (ph === undefined) {
        ph = `<ts:${next++}>`;
        seen.set(node, ph);
      }
      return ph;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    const out: { [k: string]: Json } = {};
    for (const [k, x] of sortedEntries(node)) {
      out[k] = walk(x);
    }
    return out;
  };
  return walk(v);
}

// ---- 别名归一（A18：成员_[0-9a-f]+(\{[0-9a-f]+\})? → <alias:N>） ----

class AliasNormalizer {
  private readonly known: Array<[string, string]> = [];
  private readonly ids = new Map<string, string>();
  private next = 0;

  constructor(conn: Conn) {
    const rows = conn.prepare("SELECT alias, open_id FROM feishu_users WHERE alias != ''").all() as Array<{
      alias: string;
      open_id: string;
    }>;
    this.known = rows.map((r) => [r.alias, r.open_id] as [string, string]).sort((a, b) => b[0].length - a[0].length);
  }

  private placeholderFor(alias: string): string {
    const identity = this.known.find(([a]) => a === alias)?.[1] ?? alias;
    let ph = this.ids.get(identity);
    if (ph === undefined) {
      ph = `<alias:${this.next++}>`;
      this.ids.set(identity, ph);
    }
    return ph;
  }

  private scrubString(s: string): string {
    const HEAD = "成员_";
    let out = "";
    let rest = s;
    while (rest.includes(HEAD)) {
      const pos = rest.indexOf(HEAD);
      out += rest.slice(0, pos);
      const after = rest.slice(pos + HEAD.length);
      let end = 0;
      while (end < after.length && /[0-9a-f]/.test(after[end])) {
        end += 1;
      }
      const hexEnd = end;
      if (after[hexEnd] === "{") {
        let j = hexEnd + 1;
        while (j < after.length && /[0-9a-f]/.test(after[j])) {
          j += 1;
        }
        if (after[j] === "}" && j > hexEnd + 1) {
          end = j + 1;
        }
      }
      if (hexEnd === 0) {
        out += HEAD;
        rest = after;
        continue;
      }
      out += this.placeholderFor(after.slice(0, end));
      rest = after.slice(end);
    }
    return out + rest;
  }

  walk(v: Json): Json {
    if (typeof v === "string") {
      return v.includes(HEAD0) ? this.scrubString(v) : v;
    }
    if (Array.isArray(v)) {
      return v.map((x) => this.walk(x));
    }
    if (v === null || typeof v !== "object") {
      return v;
    }
    const out: { [k: string]: Json } = {};
    for (const [k, x] of sortedEntries(v)) {
      out[k] = this.walk(x);
    }
    return out;
  }
}

const HEAD0 = "成员_";

/** 第二遍：别名归一（归属表取自终态连接——与 Rust oracle 凭快照记账同构） */
export function normalizeAliases(conn: Conn, v: Json): Json {
  return new AliasNormalizer(conn).walk(v);
}

/** 终态选择：exact → 全量行集；invariants → { invariants: 断言集 }（oracle 同包裹形态） */
export function finalState(ctx: OpCtx, expect: string, writeOps: number): Record<string, unknown> {
  const conn = ctx.conn(0);
  return expect === "invariants" ? { invariants: invariants(conn, writeOps) } : dumpFinal(conn);
}
