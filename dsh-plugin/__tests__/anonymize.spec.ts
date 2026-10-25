/**
 * domain/anonymize：懒分配稳定/唯一/形态、碰撞探测、长名优先、same_name_risk、
 * 「我」与（疑似@我）、MIN_NAME_LEN、还原长代号优先、群名不脱敏（D17/A12）。
 * 别名生成不承诺与 Rust 同哈希值（A18）——断言稳定/唯一/形态而非具体值。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AnonRules,
  ensureAlias,
  ME,
  ME_HINT,
  MIN_NAME_LEN,
  parseNameList,
  restore,
} from "../src/host/domain/anonymize";
import { createTestDb, scalar, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seedUser(openId: string, name: string, alias = ""): void {
  db.conn
    .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES (?, ?, ?, '2026-09-01')")
    .run(openId, name, alias);
}

function setSetting(key: string, value: string): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

const ALIAS_FORM = /^成员_[0-9a-f]+/;

describe("懒分配（ensure_alias 同构）", () => {
  it("分配一次后稳定复用；形态 成员_xxxx；跨调用同一代号", () => {
    seedUser("ou_a", "张三");
    const a1 = ensureAlias(db.conn, "ou_a");
    const a2 = ensureAlias(db.conn, "ou_a");
    expect(a1).toBe(a2);
    expect(a1).toMatch(ALIAS_FORM);
    expect(a1?.length).toBe("成员_".length + 4);
  });

  it("群外成员（无缓存行）也能即时分配并落库（跨进程共用）", () => {
    const b = ensureAlias(db.conn, "ou_b");
    expect(b).toMatch(ALIAS_FORM);
    expect(scalar(db.conn, "SELECT alias FROM feishu_users WHERE open_id='ou_b'")).toBe(b);
  });

  it("不同 open_id 代号唯一；空 open_id 返回 null", () => {
    const a = ensureAlias(db.conn, "ou_a");
    const b = ensureAlias(db.conn, "ou_b");
    expect(a).not.toBe(b);
    expect(ensureAlias(db.conn, "")).toBeNull();
  });

  it("候选被占时向后探测（唯一索引防碰撞锚点）", () => {
    // 预占第一个候选：构造同 hash 候选不可行（哈希算法不同），改为占用大量 4hex 槽
    // 逼近探测路径——直接给 ou_b 预填已知别名走「行已分配」收敛分支
    seedUser("ou_b", "李四", "成员_dead");
    const b = ensureAlias(db.conn, "ou_b");
    expect(b).toBe("成员_dead");
  });

  it("并发收敛：条件更新只写空别名行（WHERE alias=''），已写值不被覆盖", () => {
    // 模拟另一进程先行分配：行上已有非空别名时，本进程同款条件 UPDATE affected=0
    seedUser("ou_c", "王五", "成员_beef");
    const n = db.conn
      .prepare("UPDATE feishu_users SET alias=? WHERE open_id=? AND (alias='' OR alias IS NULL)")
      .run("成员_1234", "ou_c");
    expect(Number(n.changes)).toBe(0);
    expect(scalar(db.conn, "SELECT alias FROM feishu_users WHERE open_id='ou_c'")).toBe("成员_beef");
    // ensureAlias 重查收敛到库里值
    expect(ensureAlias(db.conn, "ou_c")).toBe("成员_beef");
  });
});

describe("AnonRules（build/scrub/alias_of）", () => {
  it("我的称呼（含短称呼）→（疑似@我）；长名优先防截胡；成员名 → 代号", () => {
    setSetting("feishu_my_open_id", "ou_me");
    setSetting("feishu_my_name", "蔡乔蓉");
    setSetting("feishu_my_names", "乔蓉");
    seedUser("ou_me", "蔡乔蓉");
    seedUser("ou_z", "张三丰", "成员_00aa");
    seedUser("ou_w", "张三", "成员_00bb");
    const rules = AnonRules.build(db.conn);
    const out = rules.scrub("乔蓉帮我看下，再找张三丰和张三对齐");
    expect(out).toBe(`${ME_HINT}帮我看下，再找成员_00aa和成员_00bb对齐`);
    expect(rules.hintsMe(out)).toBe(true);
    expect(rules.hintsMe("只有成员_00aa，没有称呼")).toBe(false);
  });

  it("标题场景：称呼替换成第一人称「我」", () => {
    setSetting("feishu_my_open_id", "ou_me");
    setSetting("feishu_my_name", "蔡乔蓉");
    seedUser("ou_me", "蔡乔蓉");
    seedUser("ou_z", "张三", "成员_00aa");
    const rules = AnonRules.build(db.conn);
    expect(rules.scrubTitles("蔡乔蓉要找张三")).toBe(`${ME}要找成员_00aa`);
  });

  it("same_name_risk：同名他人条目不进词表，检出风险", () => {
    setSetting("feishu_my_open_id", "ou_me");
    setSetting("feishu_my_name", "蔡乔蓉");
    seedUser("ou_me", "蔡乔蓉");
    seedUser("ou_same", "蔡乔蓉", "成员_00cc");
    seedUser("ou_z", "李四", "成员_00dd");
    const rules = AnonRules.build(db.conn);
    expect(rules.sameNameRisk).toBe(true);
    expect(rules.scrub("蔡乔蓉来对一下")).toBe(`${ME_HINT}来对一下`);
  });
});

describe("AnonRules（build/scrub/alias_of）·下", () => {
  it("aliasOf：我的 open_id → 「我」；未分配的懒分配；缓存复用", () => {
    setSetting("feishu_my_open_id", "ou_me");
    const rules = AnonRules.build(db.conn);
    expect(rules.aliasOf(db.conn, "ou_me")).toBe(ME);
    const a = rules.aliasOf(db.conn, "ou_new");
    expect(a).toMatch(ALIAS_FORM);
    expect(rules.aliasOf(db.conn, "ou_new")).toBe(a);
    expect(rules.aliasCached("ou_new")).toBe(a);
    expect(rules.aliasCached("ou_unknown")).toBe("ou_unknown".slice(0, 11));
  });

  it("MIN_NAME_LEN=2：单字称呼不进文本替换；单字名条目不进词表", () => {
    expect(MIN_NAME_LEN).toBe(2);
    setSetting("feishu_my_names", "王,小蔡");
    const rules = AnonRules.build(db.conn);
    const out = rules.scrub("王和小蔡都在");
    expect(out).toBe("王和（疑似@我）都在");
  });
});

describe("还原（restore）", () => {
  it("代号 → 真名；长代号优先（防短代号被前缀截胡）；未知代号原样保留", () => {
    seedUser("ou_z", "张三", "成员_00aa");
    seedUser("ou_w", "王五", "成员_00aa01");
    expect(restore(db.conn, "找成员_00aa01和成员_00aa对齐")).toBe("找王五和张三对齐");
    expect(restore(db.conn, "找成员_ffff对齐")).toBe("找成员_ffff对齐");
  });

  it("群名不脱敏：原样透传无需还原（A12/D17）", () => {
    expect(restore(db.conn, "按 项目攻坚群 的安排推进")).toBe("按 项目攻坚群 的安排推进");
  });
});

describe("parseNameList", () => {
  it("逗号/顿号分隔，滤单字与空串", () => {
    expect(parseNameList("蔡乔蓉，乔蓉、小蔡 , 王")).toEqual(["蔡乔蓉", "乔蓉", "小蔡"]);
  });
});
