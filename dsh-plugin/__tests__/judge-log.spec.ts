/**
 * judge 运行日志（deps.log——背包-诊断-运行日志 target=judge）：编排判定完成/失败行
 * （执行方呈现含绑定部署）、retryJudge 重判开始行；快捕链路日志见 capture.spec。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orchestrateBatch, retryJudge, type OrchestrateDeps } from "../src/host/judge/orchestrator";
import { fakeSubagentExecutor, type JudgeExecutor } from "../src/host/judge/adapters";
import { sessionReplay, type LocalReplayLaunch, type ReplayLauncher } from "../src/host/dispatch/sessions";
import { replayCommandLine } from "../src/host/commands/replayRig";
import { seedAgents, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seedMessage(mid: string): void {
  db.conn
    .prepare(
      "INSERT INTO chat_messages (message_id, chat_id, chat_type, chat_name, sender, sender_id, content, content_anon, " +
        "sent_at, is_self, ai_status, review_status, created_at) VALUES (?, 'oc_g', 'group', '项目群', '张三', 'ou_z', ?, ?, 1789200000000, 0, 'pending', 'pending', '2026-10-11T00:00:00+00:00')",
    )
    .run(mid, "内容", "内容");
}

/** 判定编排依赖（lines 收集运行日志行；fail = 执行方抛错；remoteHost = 执行方绑定部署） */
function depsWith(lines: string[], opts: { fail?: boolean; remoteHost?: string } = {}): OrchestrateDeps {
  return {
    conn: db.conn,
    executor: {
      ...fakeSubagentExecutor("fake", (batch) => {
        if (opts.fail === true) {
          throw new Error("远端炸了");
        }
        return batch.messageIds.map((id) => ({ messageId: id, action: "none" as const, reason: "闲聊", tags: [] }));
      }),
      ...(opts.remoteHost === undefined ? {} : { remoteHost: opts.remoteHost }),
    },
    log: (level, message) => lines.push(`${level}: ${message}`),
  };
}

describe("判定运行日志（deps.log——背包-诊断-运行日志 target=judge）", () => {
  it("成功：判定完成行带条数分布 / 执行方 / 耗时；失败：判定失败行带原因", async () => {
    seedMessage("om_1");
    const lines: string[] = [];
    await orchestrateBatch(depsWith(lines), ["om_1"]);
    expect(lines[0]).toMatch(/^info: 判定完成：1 条（todo 0 · update 0 · followup 0 · none 1）· 执行方 fake · \d+ms$/);

    seedMessage("om_2");
    const failLines: string[] = [];
    await orchestrateBatch(depsWith(failLines, { fail: true }), ["om_2"]);
    expect(failLines[0]).toBe("warn: 判定失败（执行方 fake）：远端炸了");
  });

  it("执行方呈现含绑定部署；retryJudge 重判开始行随行", async () => {
    seedMessage("om_1");
    const lines: string[] = [];
    await orchestrateBatch(depsWith(lines, { remoteHost: "dev-box" }), ["om_1"]);
    expect(lines[0]).toContain("执行方 fake · 部署 dev-box");

    // 重判开始行：error 态消息重置后送判
    db.conn.prepare("UPDATE chat_messages SET ai_status='error' WHERE message_id='om_1'").run();
    const retryLines: string[] = [];
    await retryJudge(depsWith(retryLines), ["om_1"]);
    expect(retryLines[0]).toBe("info: 重判 1 条 · 执行方 fake");
    expect(retryLines[1]).toMatch(/^info: 判定完成：1 条/);
  });
});

describe("判定账本 workdir 快照 → 回放 cd 前缀（不再落终端默认 home）", () => {
  it("classify 行记执行方 workdir；本机回放 launch 携带该目录，命令行组 cd 前缀 + --resume", async () => {
    seedAgents(db.conn, [{ id: "fake", command: "claude" }]);
    seedMessage("om_1");
    const executor: JudgeExecutor = {
      id: "fake",
      name: "fake",
      selfLanding: false,
      workdir: "~/.choose-you/workspace",
      run: async (batch) => ({
        suggestions: batch.messageIds.map((id) => ({ messageId: id, action: "none" as const, tags: [] })),
        sessionId: "sess-9",
      }),
    };
    await orchestrateBatch({ conn: db.conn, executor }, ["om_1"]);
    const rowId = Number(
      (db.conn.prepare("SELECT id FROM agent_sessions ORDER BY id DESC LIMIT 1").get() as { id: number }).id,
    );
    const launches: LocalReplayLaunch[] = [];
    const launcher: ReplayLauncher = {
      resolveDeployment: () => null,
      launchLocal: (l) => launches.push(l),
      launchRemote: () => undefined,
      launchAlias: () => undefined,
    };
    expect(sessionReplay(db.conn, rowId, launcher)).toMatchObject({ kind: "routed", branch: "resume" });
    expect(launches[0]).toMatchObject({ workdir: "~/.choose-you/workspace", sessionId: "sess-9" });
    expect(replayCommandLine(launches[0])).toBe("cd ~/.choose-you/workspace && claude --resume sess-9");
  });
});
