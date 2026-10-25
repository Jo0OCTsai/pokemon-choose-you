/**
 * judge/orchestrator 集成：claim→提交校验→落库→还原→健康更新→失败留档→重判；
 * 校验失败重试 ≤2 超限整批落 error（A21）；claim 失配消费守卫（A22）；未提及兜底 none。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { judgePending, orchestrateBatch, pendingJudgeIds, type OrchestrateDeps } from "../src/host/judge/orchestrator";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import { HealthState, AI } from "../src/host/health/snapshot";
import { createTestDb, scalar, type TestDb } from "./helpers";
import type { AiSuggestion } from "../src/host/domain/suggest";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 代号还原链路的种子：张三(ou_z)→成员_00aa，消息 content_anon 用代号 */
function seedAliasMessage(mid: string, opts: Record<string, unknown> = {}): void {
  db.conn
    .prepare(
      "INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', 't') ON CONFLICT(open_id) DO NOTHING",
    )
    .run();
  db.conn
    .prepare(
      "INSERT INTO chat_messages (message_id, chat_id, chat_type, chat_name, sender, sender_id, content, content_anon, sent_at, ai_status, review_status, created_at) " +
        "VALUES (?, 'oc_g', 'group', '项目群', '张三', 'ou_z', ?, ?, 1789200000000, 'pending', 'pending', '2026-10-11T00:00:00+00:00')",
    )
    .run(mid, String(opts.content ?? "张三提醒交周报"), String(opts.content_anon ?? "成员_00aa 提醒交周报"));
}

function depsWith(
  fn: (batch: { prompt: string; feedback?: string }) => AiSuggestion[] | Promise<AiSuggestion[]>,
  health = new HealthState(),
): OrchestrateDeps {
  const executor = fakeSubagentExecutor("fake", (batch) => fn(batch));
  return { conn: db.conn, executor, health };
}

function statusOf(mid: string): string {
  return String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id=?", mid));
}

describe("判定主链路（claim → 校验 → 落库 → 还原 → 健康）", () => {
  it("内存建议经提交期校验落库：代号还原成真名、ai_status=todo、健康记成功", async () => {
    seedAliasMessage("om_1");
    const health = new HealthState();
    const deps = depsWith(() => [{ messageId: "om_1", action: "todo", title: "给成员_00aa 发周报", tags: [] }], health);
    const out = await orchestrateBatch(deps, ["om_1", "om_missing"]);
    expect(out.claimed).toBe(1);
    expect(out.todo).toBe(1);
    expect(statusOf("om_1")).toBe("todo");
    expect(scalar(db.conn, "SELECT suggested_title FROM chat_messages WHERE message_id='om_1'")).toBe("给张三 发周报");
    expect(scalar(db.conn, "SELECT ai_agent FROM chat_messages WHERE message_id='om_1'")).toBe("fake");
    expect(health.snapshot(AI).lastSuccessAt).not.toBeNull();
    expect(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind='classify' AND status='ok'")).toBe(1);
  });

  it("未提及的消息兜底 none（AI 没给判定不等于跳过）", async () => {
    seedAliasMessage("om_a");
    seedAliasMessage("om_b");
    const deps = depsWith(() => [{ messageId: "om_a", action: "todo", title: "甲", tags: [] }]);
    const out = await orchestrateBatch(deps, ["om_a", "om_b"]);
    expect(out.todo).toBe(1);
    expect(statusOf("om_a")).toBe("todo");
    expect(statusOf("om_b")).toBe("none");
    expect(scalar(db.conn, "SELECT ai_agent FROM chat_messages WHERE message_id='om_b'")).toBe("fake");
  });

  it("judgePending 全集分批（>20 条拆批）", async () => {
    for (let i = 1; i <= 25; i++) {
      seedAliasMessage(`om_${i}`);
    }
    const deps = depsWith((batch) => {
      const ids = [...batch.prompt.matchAll(/\[(om_\d+)\]/g)].map((m) => m[1]);
      return ids.map((id) => ({ messageId: id, action: "none", reason: "闲聊", tags: [] }));
    });
    const out = await judgePending(deps);
    expect(out.claimed).toBe(25);
    expect(out.none).toBe(25);
    expect(pendingJudgeIds(db.conn)).toEqual([]);
  });
});

describe("校验失败重试自限（A21）", () => {
  it("第一次校验失败 → 带反馈重试成功（共 2 次执行）", async () => {
    seedAliasMessage("om_1");
    const replies = [
      [{ messageId: "om_1", action: "todo", title: "甲", category: "不存在的分类", tags: [] }],
      [{ messageId: "om_1", action: "todo", title: "甲", tags: [] }],
    ];
    let calls = 0;
    const deps = depsWith((batch) => {
      calls += 1;
      if (calls === 2) {
        expect(batch.feedback).toContain("第 1 条");
      }
      return replies[calls - 1];
    });
    const out = await orchestrateBatch(deps, ["om_1"]);
    expect(calls).toBe(2);
    expect(out.todo).toBe(1);
    expect(statusOf("om_1")).toBe("todo");
  });

  it("持续校验失败：初跑 + 2 重试后整批落 error（可重判），健康记失败", async () => {
    seedAliasMessage("om_1");
    let calls = 0;
    const health = new HealthState();
    const deps = depsWith(() => {
      calls += 1;
      return [{ messageId: "om_1", action: "todo", title: "甲", category: "不存在的分类", tags: [] }];
    }, health);
    const out = await orchestrateBatch(deps, ["om_1"]);
    expect(calls).toBe(3);
    expect(out.markedError).toBe(1);
    expect(statusOf("om_1")).toBe("error");
    expect(scalar(db.conn, "SELECT suggested_title FROM chat_messages WHERE message_id='om_1'")).toBeNull();
    expect(health.snapshot(AI).consecutiveFailures).toBe(1);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind='classify' AND status='error'")).toBe(1);
  });
});

describe("执行方崩溃路径", () => {
  it("执行方崩溃（非校验错）：整批落 error 不重试；claim 落空消息不动", async () => {
    seedAliasMessage("om_mine");
    seedAliasMessage("om_done");
    db.conn
      .prepare("UPDATE chat_messages SET ai_status='todo', suggested_title='已有判定' WHERE message_id='om_done'")
      .run();
    const executor = {
      id: "boom",
      name: "boom",
      selfLanding: false,
      run: async () => {
        throw new Error("agent exploded");
      },
    };
    const out = await orchestrateBatch({ conn: db.conn, executor }, ["om_mine", "om_done"]);
    expect(out.markedError).toBe(1);
    expect(statusOf("om_mine")).toBe("error");
    expect(statusOf("om_done")).toBe("todo");
  });
});

/** 模拟执行期间他形态的并发介入（判定落库与进程退出是两件事） */
function foreignInterventionExecutor(): {
  id: string;
  name: string;
  selfLanding: boolean;
  run: () => Promise<{ suggestions: never[]; sessionId: null }>;
} {
  return {
    id: "cli",
    name: "CLI",
    selfLanding: true,
    async run() {
      db.conn
        .prepare(
          "UPDATE chat_messages SET ai_status='todo', suggested_title='交周报' WHERE message_id='om_ok' AND ai_status='judging'",
        )
        .run();
      db.conn
        .prepare(
          "UPDATE chat_messages SET judge_claimed_at='2026-10-11T00:08:00+00:00' WHERE message_id='om_foreign_judging'",
        )
        .run();
      db.conn
        .prepare(
          "UPDATE chat_messages SET ai_status='todo', suggested_title='别人的判定', judge_claimed_at='2026-10-11T00:30:00+00:00' WHERE message_id='om_foreign_landed'",
        )
        .run();
      return { suggestions: [], sessionId: null };
    },
  };
}

describe("claim 失配消费守卫（A22）", () => {
  it("selfLanding 回读消费守卫：令牌匹配采纳，claim 失配不采纳", async () => {
    seedAliasMessage("om_ok");
    seedAliasMessage("om_foreign_judging");
    seedAliasMessage("om_foreign_landed");
    const out = await orchestrateBatch({ conn: db.conn, executor: foreignInterventionExecutor() }, [
      "om_ok",
      "om_foreign_judging",
      "om_foreign_landed",
    ]);
    expect(out.todo).toBe(1);
    expect(out.dropped).toEqual(["om_foreign_judging", "om_foreign_landed"]);
    expect(statusOf("om_ok")).toBe("todo");
  });

  it("claim 失配行处置：他方在判原样保留；迟到落库回置 pending 清残留", async () => {
    seedAliasMessage("om_foreign_judging");
    seedAliasMessage("om_foreign_landed");
    await orchestrateBatch({ conn: db.conn, executor: foreignInterventionExecutor() }, [
      "om_foreign_judging",
      "om_foreign_landed",
    ]);
    const judging = db.conn
      .prepare("SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id='om_foreign_judging'")
      .get() as { ai_status: string; judge_claimed_at: string };
    expect(judging).toEqual({ ai_status: "judging", judge_claimed_at: "2026-10-11T00:08:00+00:00" });
    const landed = db.conn
      .prepare(
        "SELECT ai_status, judge_claimed_at, suggested_title FROM chat_messages WHERE message_id='om_foreign_landed'",
      )
      .get() as { ai_status: string; judge_claimed_at: string; suggested_title: string | null };
    expect(landed.ai_status).toBe("pending");
    expect(landed.judge_claimed_at).toBe("");
    expect(landed.suggested_title).toBeNull();
  });
});

describe("selfLanding 全链路", () => {
  it("selfLanding 全链路：回读采纳 + 未落库标 error + 兜底 none", async () => {
    seedAliasMessage("om_hit");
    seedAliasMessage("om_miss");
    const executor = {
      id: "cli",
      name: "CLI",
      selfLanding: true,
      run: async () => {
        // 模拟 agent：对 om_hit 经 pk 落库 todo，om_miss 未落
        db.conn
          .prepare(
            "UPDATE chat_messages SET ai_status='todo', suggested_title='交周报' WHERE message_id='om_hit' AND ai_status='judging'",
          )
          .run();
        return { suggestions: [], sessionId: null };
      },
    };
    const health = new HealthState();
    const out = await orchestrateBatch({ conn: db.conn, executor, health }, ["om_hit", "om_miss"]);
    expect(out.todo).toBe(1);
    expect(out.markedError).toBe(0);
    expect(statusOf("om_hit")).toBe("todo");
    expect(statusOf("om_miss")).toBe("none");
    expect(health.snapshot(AI).lastSuccessAt).not.toBeNull();
  });
});

describe("selfLanding 失败挽救", () => {
  it("selfLanding 崩溃：失败挽救收下已落库、未落库标 error（可重判）", async () => {
    seedAliasMessage("om_landed");
    seedAliasMessage("om_missed");
    const executor = {
      id: "cli",
      name: "CLI",
      selfLanding: true,
      run: async () => {
        db.conn
          .prepare(
            "UPDATE chat_messages SET ai_status='todo', suggested_title='交周报' WHERE message_id='om_landed' AND ai_status='judging'",
          )
          .run();
        throw new Error("agent killed after landing");
      },
    };
    const health = new HealthState();
    const out = await orchestrateBatch({ conn: db.conn, executor, health }, ["om_landed", "om_missed"]);
    expect(out.todo).toBe(1);
    expect(out.markedError).toBe(1);
    expect(statusOf("om_landed")).toBe("todo");
    expect(statusOf("om_missed")).toBe("error");
    expect(health.snapshot(AI).consecutiveFailures).toBe(1);
  });
});
