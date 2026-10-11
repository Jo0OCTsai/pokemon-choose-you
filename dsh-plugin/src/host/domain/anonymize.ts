/**
 * 假名化 / 还原（PROTOCOL.md §4，D17 口径：代码逆向）——行为基准 =
 * src-tauri/src/anonymize.rs（FR-X3：冲突以 Rust 为准）。
 *
 * 代号锚定 open_id（feishu_users.alias，部分唯一索引）：懒分配、`成员_xxxx`（4 hex）、
 * 碰撞探测 probe 0..64（probe>0 后缀十六进制）、条件更新 `WHERE open_id=? AND
 * (alias='' OR alias IS NULL)` 并发收敛、64 次未收敛退 open_id 前 11 字符（code points）。
 * **跨实现不承诺哈希算法稳定**（Rust DefaultHasher 自述不稳定）——稳定性由 alias 落库
 * 承载（NFR-2 的 100% 稳定经存储而非算法达成）；TS 侧用 FNV-1a 32 位（仅形态对齐，
 * fixtures 断言稳定/唯一/形态而非具体值，A18）。群名不脱敏（A12/D17）。
 */
import { nowRfc3339, type Conn } from "../storage/db";

/** 「我」的统一代称：@到我 与 我的称呼（pk context 的待办标题里）都渲染成它 */
export const ME = "我";

/** 手打文本命中称呼列表时的正文标记——区别于显式 @，模型按「疑似提及」处理 */
export const ME_HINT = "（疑似@我）";

/** 参与文本替换的最短词长：单字称呼（如单姓）误伤率过高，不进文本匹配 */
export const MIN_NAME_LEN = 2;

// ---- 懒分配 ----

function existingAlias(conn: Conn, openId: string): string | null {
  const row = conn.prepare("SELECT alias FROM feishu_users WHERE open_id=?").get(openId) as
    { alias: string } | undefined;
  const alias = row?.alias;
  return alias && alias !== "" ? alias : null;
}

/** open_id → 「成员_xxxx」候选（FNV-1a 32 位取低 16 位；形态与 Rust 一致，值不承诺相同） */
function aliasHash(openId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < openId.length; i++) {
    hash ^= openId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `成员_${(hash & 0xffff).toString(16).padStart(4, "0")}`;
}

/**
 * 懒分配并返回 open_id 的代号（ensure_alias 同构）：已分配则原样复用；未分配则按哈希
 * 生成、唯一索引冲突向后探测（probe 0..64）。行不存在（@ 了群外成员）时先补行再分配。
 * 64 次未收敛返回 null（调用方退 open_id 前 11 字符短 id 展示）。
 */
export function ensureAlias(conn: Conn, openId: string, now = nowRfc3339()): string | null {
  if (openId === "") {
    return null;
  }
  const got = existingAlias(conn, openId);
  if (got !== null) {
    return got;
  }
  conn
    .prepare(
      "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?, '', ?) " + "ON CONFLICT(open_id) DO NOTHING",
    )
    .run(openId, now);
  const base = aliasHash(openId);
  for (let probe = 0; probe < 64; probe++) {
    const candidate = probe === 0 ? base : `${base}${probe.toString(16)}`;
    // 只写仍为空的行：并发下别人（应用/pk 另一进程）已分配则以库里的为准
    const result = conn
      .prepare("UPDATE feishu_users SET alias=? WHERE open_id=? AND (alias='' OR alias IS NULL)")
      .run(candidate, openId);
    if (Number(result.changes) === 1) {
      return candidate;
    }
    // 候选被占用（唯一索引）或行被并发写入：前者继续探测，后者重查收敛
    const raced = existingAlias(conn, openId);
    if (raced !== null) {
      return raced;
    }
  }
  return null;
}

// ---- 一轮脱敏的规则包 ----

function getSetting(conn: Conn, key: string): string {
  const row = conn.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

/** 称呼列表存储格式：逗号/顿号分隔的明文，解析后去空、滤掉单字（parse_name_list 同构） */
export function parseNameList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => Array.from(s).length >= MIN_NAME_LEN);
}

/** 我的称呼集合（feishu_my_names ∪ feishu_my_name ∪ 群内显示名），去重 + 长名优先 */
function collectMyNames(conn: Conn, myOpenId: string): string[] {
  const names = parseNameList(getSetting(conn, "feishu_my_names"));
  const myName = getSetting(conn, "feishu_my_name");
  if (Array.from(myName).length >= MIN_NAME_LEN) {
    names.push(myName);
  }
  // 群内显示名（群昵称）随成员缓存自动跟上，不需要用户维护
  const displayName = conn.prepare("SELECT name FROM feishu_users WHERE open_id=?").get(myOpenId) as
    { name: string } | undefined;
  if (displayName && Array.from(displayName.name).length >= MIN_NAME_LEN) {
    names.push(displayName.name);
  }
  // 去重 + 长名优先（防短称呼先替换截胡长称呼）
  return [...new Set(names)].sort((a, b) => Array.from(b).length - Array.from(a).length);
}

/** 一轮脱敏的规则包（AnonRules 同构）：构建时查一次库做快照，整批判定复用 */
export class AnonRules {
  private readonly myOpenId: string;
  private readonly myNames: string[];
  private readonly aliases = new Map<string, string>();
  private readonly replacements: Array<{ name: string; rep: string }>;
  readonly sameNameRisk: boolean;

  constructor(args: {
    myOpenId: string;
    myNames: string[];
    aliases: Map<string, string>;
    replacements: Array<{ name: string; rep: string }>;
    sameNameRisk: boolean;
  }) {
    this.myOpenId = args.myOpenId;
    this.myNames = args.myNames;
    this.aliases = args.aliases;
    this.replacements = args.replacements;
    this.sameNameRisk = args.sameNameRisk;
  }

  /** 构建规则快照（AnonRules::build 同构）：我的称呼 ∪ 真名 ∪ 群内显示名；长名优先 */
  static build(conn: Conn): AnonRules {
    const myOpenId = getSetting(conn, "feishu_my_open_id");
    const uniqueMyNames = collectMyNames(conn, myOpenId);

    const aliases = new Map<string, string>();
    const others: Array<{ name: string; rep: string }> = [];
    let sameNameRisk = false;
    const rows = conn.prepare("SELECT open_id, name, alias FROM feishu_users").all() as Array<{
      open_id: string;
      name: string;
      alias: string;
    }>;
    for (const { open_id, name, alias } of rows) {
      const isMe = myOpenId !== "" && open_id === myOpenId;
      if (Array.from(name).length >= MIN_NAME_LEN && uniqueMyNames.includes(name)) {
        // 与我的称呼同名：我优先按「我」替换；他人条目不进词表，由 same_name_risk 标注
        if (!isMe) {
          sameNameRisk = true;
        }
        continue;
      }
      if (isMe || name === "" || alias === "") {
        continue;
      }
      aliases.set(open_id, alias);
      others.push({ name, rep: alias });
    }
    // 长名优先：先替换更具体的称呼，防止「蔡乔蓉」被「乔蓉」拆走
    others.sort((a, b) => Array.from(b.name).length - Array.from(a.name).length);
    const replacements: Array<{ name: string; rep: string }> = uniqueMyNames.map((n) => ({
      name: n,
      rep: ME_HINT,
    }));
    replacements.push(...others);
    return new AnonRules({ myOpenId, myNames: uniqueMyNames, aliases, replacements, sameNameRisk });
  }

  /** open_id → 代号（我的 open_id → 「我」；未分配的懒分配并写库） */
  aliasOf(conn: Conn, openId: string, now = nowRfc3339()): string {
    if (this.myOpenId !== "" && openId === this.myOpenId) {
      return ME;
    }
    const cached = this.aliases.get(openId);
    if (cached !== undefined) {
      return cached;
    }
    const assigned = ensureAlias(conn, openId, now) ?? Array.from(openId).slice(0, 11).join("");
    this.aliases.set(openId, assigned);
    return assigned;
  }

  /** 只读版：未命中缓存时退回短 id 展示（防御路径，正常流程不出现） */
  aliasCached(openId: string): string {
    if (this.myOpenId !== "" && openId === this.myOpenId) {
      return ME;
    }
    return this.aliases.get(openId) ?? Array.from(openId).slice(0, 11).join("");
  }

  /** 文本脱敏（消息正文场景）：称呼/成员名 → ME_HINT / 代号 */
  scrub(text: string): string {
    return this.scrubWith(text, ME_HINT);
  }

  /** 文本脱敏（待办标题/标签场景）：我的称呼替换成第一人称「我」 */
  scrubTitles(text: string): string {
    return this.scrubWith(text, ME);
  }

  private scrubWith(text: string, myReplacement: string): string {
    let out = text;
    for (const { name, rep } of this.replacements) {
      if (out.includes(name)) {
        const target = rep === ME_HINT ? myReplacement : rep;
        out = out.split(name).join(target);
      }
    }
    return out;
  }

  /** 手打文本是否命中过我的称呼（正文出现 ME_HINT 即算疑似提及） */
  hintsMe(text: string): boolean {
    return text.includes(ME_HINT) && this.myNames.length > 0;
  }
}

/**
 * 代号 → 真名（restore 同构）：只还原能查到真名的代号，查不到真名的保留原样
 * （模型幻觉代号原样可见，也便于排查）。长代号优先（防短代号被前缀相同的更长代号截胡）。
 * 群聊名不脱敏，无需还原（A12）。
 */
export function restore(conn: Conn, text: string): string {
  let pairs: Array<{ alias: string; name: string }>;
  try {
    pairs = conn.prepare("SELECT alias, name FROM feishu_users WHERE alias != '' AND name != ''").all() as Array<{
      alias: string;
      name: string;
    }>;
  } catch {
    return text;
  }
  pairs.sort((a, b) => Array.from(b.alias).length - Array.from(a.alias).length);
  let out = text;
  for (const { alias, name } of pairs) {
    if (out.includes(alias)) {
      out = out.split(alias).join(name);
    }
  }
  return out;
}
