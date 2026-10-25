/**
 * 三层脱敏管线（NFR-2 ⑥，单管线双消费：支持报告与 logQuery 共用）——行为基准 =
 * src-tauri/src/commands/diagnostics.rs（redact_line / redact_values / redact_names /
 * collect_sensitive_names；FR-X3 以代码为准），行为对齐 contracts/fixtures/redact/
 * （judge 链路的 redact 夹具组逐行回放断言）。
 *
 * 层序：① 键名层（secret/token/password/api_key/apikey/authorization/bearer/access_key
 * 命中即遮值，含 Bearer 凭证连遮）；② 值形态层（邮箱 → ***@***；sk-/ghp_/… 前缀 +
 * ≥8 位串）；③ 名词表层（feishu_users.name + feishu_chats.chat_name + settings 我的
 * 称呼，长名优先）。原始明文只存 host 内存，出 host 边界前必经本管线。
 */
import type { Conn } from "../storage/db";
import { parseNameList } from "../domain/anonymize";

/** 值脱敏后的敏感键名单（命中键名即遮蔽其后的值；Rust SENSITIVE_KEYS 逐字） */
const SENSITIVE_KEYS = ["secret", "token", "password", "api_key", "apikey", "authorization", "bearer", "access_key"];

/** 常见凭证前缀（Rust TOKEN_PREFIXES 逐字；后接 ≥8 位字母数字/_/- 才算凭证） */
const TOKEN_PREFIXES = [
  "sk-",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "github_pat_",
  "AKIA",
  "xoxb-",
  "xoxa-",
  "xoxp-",
  "xoxr-",
  "xapps-",
];

// ---- 第一层：键名遮蔽（redactLine） ----

/** ASCII 大小写不敏感前缀匹配（键名全是 ASCII，逐码比较避免整串 lower 后长度漂移） */
function keyHitsAt(line: string, i: number, key: string): boolean {
  if (i + key.length > line.length) {
    return false;
  }
  for (let j = 0; j < key.length; j++) {
    let c = line.charCodeAt(i + j);
    if (c >= 65 && c <= 90) {
      c += 32;
    }
    if (c !== key.charCodeAt(j)) {
      return false;
    }
  }
  return true;
}

function isSeparator(c: string): boolean {
  return c === " " || c === ":" || c === "=" || c === '"' || c === "'";
}

function isValueStop(c: string): boolean {
  return c === "," || c === "}" || c === "]" || c === ")" || c === ";";
}

function eqAsciiIgnoreCase(a: string, b: string): boolean {
  return a.length === b.length && keyHitsAt(a, 0, b);
}

/** 引用值（"key":"value"）：吞到闭引号并补回，保持对称 */
function maskQuoted(line: string, j: number, chunk: string): { chunk: string; next: number } {
  const quote = line[j - 1];
  while (j < line.length && line[j] !== quote) {
    j += 1;
  }
  if (j < line.length) {
    chunk += line[j];
    j += 1;
  }
  return { chunk, next: j };
}

function skipSpaces(line: string, j: number): number {
  while (j < line.length && /\s/.test(line[j])) {
    j += 1;
  }
  return j;
}

function skipBareValue(line: string, j: number): number {
  while (j < line.length && !/\s/.test(line[j]) && !isValueStop(line[j])) {
    j += 1;
  }
  return j;
}

/** 裸值：吞到空白/常见 JSON 分隔符为止（宁可多遮，不可漏遮）；值是 Bearer 时连遮随后的凭证 */
function maskBare(line: string, j: number, chunk: string): { chunk: string; next: number } {
  const start = j;
  const end = skipBareValue(line, j);
  // 「Bearer <凭证>」：Authorization 键会比 Bearer 先命中，不补这一刀凭证就漏了
  if (eqAsciiIgnoreCase(line.slice(start, end), "bearer")) {
    return { chunk, next: skipBareValue(line, skipSpaces(line, end)) };
  }
  return { chunk, next: end };
}

/** 从键名命中点遮到值尾：引用值吞到闭引号；裸值吞到空白/JSON 分隔符；Bearer 连遮凭证 */
function maskFromKey(line: string, i: number, key: string): { chunk: string; next: number } {
  const keyEnd = i + key.length;
  let chunk = line.slice(i, keyEnd);
  let j = keyEnd;
  while (j < line.length && isSeparator(line[j])) {
    chunk += line[j];
    j += 1;
  }
  if (j >= line.length) {
    return { chunk, next: j };
  }
  chunk += "***";
  const quoted = j > keyEnd && (line[j - 1] === '"' || line[j - 1] === "'");
  return quoted ? maskQuoted(line, j, chunk) : maskBare(line, j, chunk);
}

/** 单行脱敏第一层（redact_line 同构）：敏感键名命中即遮值，无命中原样保留（多字节安全） */
export function redactLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const key = SENSITIVE_KEYS.find((k) => keyHitsAt(line, i, k));
    if (key === undefined) {
      out += line[i];
      i += 1;
      continue;
    }
    const masked = maskFromKey(line, i, key);
    out += masked.chunk;
    i = masked.next;
  }
  return out;
}

// ---- 第二层：值形态遮蔽（redactValues） ----

function startsWithAt(s: string, i: number, prefix: string): boolean {
  return s.startsWith(prefix, i);
}

function isTokenChar(c: string): boolean {
  return /[A-Za-z0-9_-]/.test(c);
}

/** 邮箱遮蔽：回退已输出的 local 部分，整体替换 ***@***；不成邮箱返回 null */
function maskEmail(line: string, at: number, out: string): { out: string; next: number } | null {
  let s = at;
  while (s > 0 && (/[A-Za-z0-9]/.test(line[s - 1]) || "._%+-".includes(line[s - 1]))) {
    s -= 1;
  }
  let e = at + 1;
  while (e < line.length && (/[A-Za-z0-9]/.test(line[e]) || ".-".includes(line[e]))) {
    e += 1;
  }
  const hasDomain = e > at + 1 && line.slice(at + 1, e).includes(".");
  if (at - s < 1 || !hasDomain) {
    return null;
  }
  return { out: out.slice(0, out.length - (at - s)) + "***@***", next: e };
}

/** 单行脱敏第二层（redact_values 同构）：不带键名也能识别的敏感形态（邮箱/凭证前缀） */
export function redactValues(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const prefix = TOKEN_PREFIXES.find((p) => startsWithAt(line, i, p));
    if (prefix !== undefined) {
      let plen = 0;
      while (i + plen < line.length && isTokenChar(line[i + plen])) {
        plen += 1;
      }
      if (plen >= prefix.length + 8) {
        out += "***";
        i += plen;
        continue;
      }
    }
    if (line[i] === "@") {
      const masked = maskEmail(line, i, out);
      if (masked !== null) {
        out = masked.out;
        i = masked.next;
        continue;
      }
    }
    out += line[i];
    i += 1;
  }
  return out;
}

// ---- 第三层：名词表遮蔽（redactNames） ----

/** 单行脱敏第三层（redact_names 同构）：词表内名词出现即遮 *** */
export function redactNames(names: string[], line: string): string {
  let out = line;
  for (const n of names) {
    if (n !== "" && out.includes(n)) {
      out = out.split(n).join("***");
    }
  }
  return out;
}

function charLen(s: string): number {
  return Array.from(s).length;
}

/**
 * 汇集本库敏感名词表（collect_sensitive_names 同构）：成员真名（feishu_users）、
 * 群名（feishu_chats 快照——群名进 prompt 不脱敏，但报告贴到公开 issue 仍遮蔽）、
 * 我的称呼（settings 两键，parse_name_list 口径），长名优先 + 相邻去重。
 */
export function collectSensitiveNames(conn: Conn): string[] {
  const names: string[] = [];
  const push = (sql: string, col: string) => {
    for (const row of conn.prepare(sql).all() as Array<Record<string, unknown>>) {
      const v = String(row[col]);
      if (charLen(v) >= 2) {
        names.push(v);
      }
    }
  };
  push("SELECT name FROM feishu_users", "name");
  push("SELECT chat_name FROM feishu_chats", "chat_name");
  for (const key of ["feishu_my_name", "feishu_my_names"]) {
    const row = conn.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
    if (row !== undefined) {
      names.push(...parseNameList(row.value));
    }
  }
  names.sort((a, b) => charLen(b) - charLen(a));
  return names.filter((n, i) => i === 0 || names[i - 1] !== n);
}

/** 三层全管线（键名 → 值形态 → 名词表）：支持报告与健康错误回显共用入口 */
export function redactWithNames(names: string[], line: string): string {
  return redactNames(names, redactValues(redactLine(line)));
}
