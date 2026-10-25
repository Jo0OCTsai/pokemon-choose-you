/**
 * radio/fetcher：一轮拉取全链路（fake lark-cli 真实子进程）——语境规则（bot/p2p/发给自己
 * /群聊/免打扰）、富文本与媒体占位、@提及/疑似@我、去重入库、水位推进、快照落库。
 * 数据集对齐 Rust pull_new_messages_applies_chat_type_rules 用例。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLark } from "../src/host/radio/lark";
import { pullOnce } from "../src/host/radio/fetcher";
import { readWatermark } from "../src/host/radio/watermark";
import { createTestDb, scalar, type TestDb } from "./helpers";
import { stageFixture } from "./fake-shell";

let db: TestDb;
let staged: { bin: string; cleanup: () => void };
beforeEach(() => {
  db = createTestDb();
  staged = stageFixture("lark-cli-ok.sh");
});
afterEach(() => {
  db.close();
  staged.cleanup();
});

/** 固定拉取时刻：消息 create_time=1789200000000 在 [now-24h, now] 窗内 */
const NOW_MS = 1_789_211_331_894;

interface Row {
  message_id: string;
  chat_type: string;
  sender: string;
  content: string;
  content_anon: string;
  at_me: string;
  is_self: number;
  ai_status: string;
}

function rows(): Row[] {
  return db.conn
    .prepare(
      "SELECT message_id, chat_type, sender, content, content_anon, at_me, is_self, ai_status FROM chat_messages ORDER BY message_id",
    )
    .all() as unknown as Row[];
}

function rowOf(id: string): Row {
  return rows().find((r) => r.message_id === id) as Row;
}

describe("pullOnce 语境规则（Rust 全链路用例对齐）", () => {
  it("bot 单聊：我发的送 AI、bot 回复只作上下文", async () => {
    const out = await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    expect(out.inserted).toBe(10);
    expect(out.filteredOut).toBe(1);
    const b1 = rowOf("om_b1");
    expect(b1.chat_type).toBe("bot");
    expect(b1.is_self).toBe(1);
    expect(b1.ai_status).toBe("pending");
    expect(b1.sender).toBe("乔老板");
    expect(rowOf("om_b2").ai_status).toBe("skipped");
    expect(rowOf("om_b2").sender).toBe("皮卡丘助手");
  });

  it("身份与群成员名落库（pk context 脱敏词源）", async () => {
    await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    expect(scalar(db.conn, "SELECT value FROM settings WHERE key='feishu_my_open_id'")).toBe("ou_me");
    expect(scalar(db.conn, "SELECT value FROM settings WHERE key='feishu_my_name'")).toBe("乔老板");
    expect(scalar(db.conn, "SELECT name FROM feishu_users WHERE open_id='ou_z'")).toBe("张三");
  });

  it("p2p 单聊：对方发的送 AI；我发的只作上下文；发给自己的会话视作备忘", async () => {
    await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    const f1 = rowOf("om_f1");
    expect(f1.chat_type).toBe("p2p");
    expect(f1.ai_status).toBe("pending");
    expect(f1.sender).toBe("李四");
    expect(rowOf("om_f2").ai_status).toBe("skipped");
    expect(rowOf("om_f2").sender).toBe("乔老板");
    const s1 = rowOf("om_s1");
    expect(s1.is_self).toBe(1);
    expect(s1.ai_status).toBe("pending");
  });
});

describe("pullOnce 语境规则 · 群聊与过滤", () => {
  it("群聊：@我（显式 at_me=at）、@他人（代号进匿名版）、手打名字（name）、图片只作上下文", async () => {
    await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    const g1 = rowOf("om_g1");
    expect(g1.chat_type).toBe("group");
    expect(g1.ai_status).toBe("pending");
    expect(g1.sender).toBe("张三");
    expect(g1.content).toContain("@我");
    expect(g1.content_anon).toBe("@我 周会改到周四10点");
    expect(g1.at_me).toBe("at");
    expect(rowOf("om_g2").ai_status).toBe("skipped");
    const g4 = rowOf("om_g4");
    expect(g4.ai_status).toBe("skipped");
    expect(g4.content).toBe("[图片]");
    const g5 = rowOf("om_g5");
    expect(g5.content).toContain("@王五");
    expect(g5.content_anon).toContain("@成员_");
    expect(g5.content_anon).not.toContain("王五");
    expect(g5.at_me).toBe("");
    const g6 = rowOf("om_g6");
    expect(g6.content_anon).toContain("（疑似@我）帮我看下发布单");
    expect(g6.at_me).toBe("name");
  });

  it("免打扰会话被过滤不拉取；快照含全部会话并推进时间戳；水位推进", async () => {
    await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    expect(rows().every((r) => r.message_id !== "om_noisy")).toBe(true);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM feishu_chats")).toBe(5);
    expect(scalar(db.conn, "SELECT mute_outcome FROM feishu_chats WHERE chat_id='oc_noisy'")).toBe("muted");
    expect(scalar(db.conn, "SELECT value FROM settings WHERE key='feishu_snapshot_at'")).toBeTruthy();
    expect(readWatermark(db.conn)).toBe(NOW_MS);
  });
});

describe("增量与去重", () => {
  it("二轮拉取同数据：INSERT OR IGNORE 去重不重复入库、pending 不再产生", async () => {
    const lark = createLark(staged.bin);
    const r1 = await pullOnce(db.conn, lark, { nowMs: NOW_MS });
    expect(r1.pendingIds.length).toBe(6);
    const r2 = await pullOnce(db.conn, lark, { nowMs: NOW_MS + 60_000 });
    expect(r2.inserted).toBe(0);
    expect(r2.pendingIds).toEqual([]);
    expect(rows().length).toBe(10);
    expect(readWatermark(db.conn)).toBe(NOW_MS + 60_000);
  });

  it("水位驱动增量窗口：请求参数带 since-2min 容错（首拉回看 24h）", async () => {
    const lark = createLark(staged.bin);
    const seen: string[] = [];
    const recording = {
      ...lark,
      listMessages: async (chatId: string, startS: number, endS: number) => {
        seen.push(`${chatId}:${startS}-${endS}`);
        return lark.listMessages(chatId, startS, endS);
      },
    };
    await pullOnce(db.conn, recording, { nowMs: NOW_MS });
    await pullOnce(db.conn, recording, { nowMs: NOW_MS + 3_600_000 });
    // 首拉窗口 = [now-24h, now]；增量窗口 = [since-2min, now]
    const first = seen[0].split(":")[1].split("-");
    expect(Number(first[1])).toBe(Math.floor(NOW_MS / 1000));
    expect(Number(first[0])).toBe(Math.floor((NOW_MS - 24 * 3_600_000) / 1000));
    const second = seen[seen.length - 1].split(":")[1].split("-");
    expect(Number(second[0])).toBe(Math.floor((NOW_MS - 120_000) / 1000));
  });

  it("超期未捕捉消息（>60 天）被清理，已建待办的不清理", async () => {
    db.conn
      .prepare(
        "INSERT INTO chat_messages (message_id, content, ai_status, review_status, created_at) VALUES ('om_old', '旧', 'none', 'pending', '2020-01-01T00:00:00+00:00')",
      )
      .run();
    db.conn
      .prepare(
        "INSERT INTO chat_messages (message_id, content, task_id, ai_status, review_status, created_at) VALUES ('om_kept', '有任务', 1, 'todo', 'accepted', '2020-01-01T00:00:00+00:00')",
      )
      .run();
    db.conn.prepare("INSERT INTO tasks (title, status, created_at) VALUES ('t', 'inbox', '2020-01-01')").run();
    await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_messages WHERE message_id='om_old'")).toBe(0);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_messages WHERE message_id='om_kept'")).toBe(1);
  });
});

describe("会话过滤偏好（chat_filter_prefs）", () => {
  it("always_pull 拯救被免打扰误杀的会话；always_filter 跳过未免打扰会话", async () => {
    db.conn
      .prepare(
        "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at) VALUES ('oc_noisy', 'always_pull', 't')",
      )
      .run();
    db.conn
      .prepare(
        "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at) VALUES ('oc_group', 'always_filter', 't')",
      )
      .run();
    const out = await pullOnce(db.conn, createLark(staged.bin), { nowMs: NOW_MS });
    expect(out.filteredOut).toBe(1);
    expect(rowOf("om_noisy")).toBeDefined();
    expect(rowOf("om_noisy").ai_status).toBe("pending");
    expect(rows().some((r) => r.message_id === "om_g1")).toBe(false);
  });
});
