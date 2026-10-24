/**
 * health/redact 三层脱敏：单元行为 + contracts/fixtures/redact/ 夹具逐行回放
 * （Rust oracle 锁定的期望输出，FR-X3）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectSensitiveNames,
  redactLine,
  redactNames,
  redactValues,
  redactWithNames,
} from "../src/host/health/redact";
import { createTestDb, type TestDb } from "./helpers";

const ROOT = join(import.meta.dirname, "..", "..");
let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("第一层：键名遮蔽（redactLine）", () => {
  it("敏感键命中遮值，Bearer 凭证连遮，引用值保持对称", () => {
    expect(redactLine("feishu poll failed: app_secret=abcd1234efgh")).toBe("feishu poll failed: app_secret=***");
    expect(redactLine('保存 "refresh_token":"u-xYz123"')).toBe('保存 "refresh_token":"***"');
    expect(redactLine("Authorization: Bearer t-9a8b7c6d")).toBe("Authorization: ***");
    const masked = redactLine("token：很长的值");
    expect(masked).not.toContain("很长的值");
    expect(masked.startsWith("token")).toBe(true);
    // 键名大小写不敏感
    expect(redactLine("API_KEY=xyz")).toBe("API_KEY=***");
  });

  it("无敏感键的行原样保留（含多字节字符）", () => {
    expect(redactLine("AI 判定 3/5 条：新待办 2")).toBe("AI 判定 3/5 条：新待办 2");
    expect(redactLine("拉取「项目攻坚群」消息")).toBe("拉取「项目攻坚群」消息");
  });
});

describe("第二层：值形态遮蔽（redactValues）", () => {
  it("邮箱与凭证前缀（≥8 位）遮蔽，短前缀词不误伤", () => {
    expect(redactValues("联系 joe.cai+tag@example.com 收尾")).toBe("联系 ***@*** 收尾");
    expect(redactValues("key: sk-proj-AbCd1234EfGh5678 done")).toBe("key: *** done");
    expect(redactValues("ghp_0123456789abcdefghijklm 失效")).toBe("*** 失效");
    expect(redactValues("AWS AKIAIOSFODNN7EXAMPLE 权限不足")).toBe("AWS *** 权限不足");
    expect(redactValues("sk-ip 是普通词")).toBe("sk-ip 是普通词");
    expect(redactValues("AI 判定 3/5 条")).toBe("AI 判定 3/5 条");
  });

  it("裸 @ 与无点域名不按邮箱处理", () => {
    expect(redactValues("at符号 @ 后面没域名")).toBe("at符号 @ 后面没域名");
    expect(redactValues("a@b")).toBe("a@b");
  });
});

describe("第三层：名词表遮蔽（collectSensitiveNames + redactNames）", () => {
  it("库内真名/群名/称呼进词表，长名优先", () => {
    db.conn.prepare("INSERT INTO feishu_users (open_id, name, updated_at) VALUES ('ou_a', '张三丰', 'x')").run();
    db.conn
      .prepare(
        "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES ('oc_g', '项目攻坚群', 'group', 'unknown')",
      )
      .run();
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_my_name', '蔡乔蓉')").run();
    const names = collectSensitiveNames(db.conn);
    expect(names).toContain("张三丰");
    expect(names).toContain("项目攻坚群");
    expect(names).toContain("蔡乔蓉");
    expect(names.indexOf("项目攻坚群")).toBeLessThan(names.indexOf("张三丰"));
    const out = redactNames(names, "张三丰在 项目攻坚群 提到 蔡乔蓉");
    expect(out).toBe("***在 *** 提到 ***");
  });

  it("单字名/单字称呼不进词表（误伤率过高）", () => {
    db.conn.prepare("INSERT INTO feishu_users (open_id, name, updated_at) VALUES ('ou_b', '王', 'x')").run();
    expect(collectSensitiveNames(db.conn)).toEqual([]);
  });
});

interface RedactScenario {
  setup: {
    settings?: Record<string, string>;
    feishu_users?: Array<{ open_id: string; name: string }>;
    chats?: Array<{ chat_id: string; chat_name: string; chat_type: string; mute_outcome: string }>;
  };
  steps: Array<{ args: { lines: string[] } }>;
}

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as unknown;
}

describe("redact 夹具回放（contracts/fixtures/redact，Rust oracle）", () => {
  function applySetup(scenario: RedactScenario): void {
    for (const [k, v] of Object.entries(scenario.setup.settings ?? {})) {
      db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(k, v);
    }
    for (const u of scenario.setup.feishu_users ?? []) {
      db.conn.prepare("INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?, ?, 'x')").run(u.open_id, u.name);
    }
    for (const c of scenario.setup.chats ?? []) {
      db.conn
        .prepare("INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES (?, ?, ?, ?)")
        .run(c.chat_id, c.chat_name, c.chat_type, c.mute_outcome);
    }
  }

  it.each(["report-no-secret-leak", "three-layer-redact"])("%s：期望行逐字对齐", (name) => {
    const scenario = loadJson(`contracts/scenarios/redact/${name}.json`) as RedactScenario;
    const fixture = loadJson(`contracts/fixtures/redact/${name}.json`) as {
      steps: Array<{ value: { lines: string[] } }>;
    };
    applySetup(scenario);
    const names = collectSensitiveNames(db.conn);
    const input = scenario.steps[0].args.lines;
    const got = input.map((line) => redactWithNames(names, line));
    expect(got).toEqual(fixture.steps[0].value.lines);
  });

  it("夹具断言零泄漏：敏感原文不在任何输出行里", () => {
    const scenario = loadJson("contracts/scenarios/redact/report-no-secret-leak.json") as RedactScenario;
    const secrets = [
      "8f3c91d2aa04e7b6",
      "AKIAIOSFODNN7EXAMPLE",
      "1234567890abcdef",
      "11AaBbCcDdEeFf00112233",
      "hunter2hunter2",
    ];
    const names = collectSensitiveNames(db.conn);
    for (const line of scenario.steps[0].args.lines) {
      const out = redactWithNames(names, line);
      for (const s of secrets) {
        expect(out).not.toContain(s);
      }
    }
  });
});
