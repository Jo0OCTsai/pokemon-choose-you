/**
 * dispatch/cmdline ssh 别名包装行与远端载荷（desktop direct_ssh_argv / history_invocation
 * 远端分支同构）+ dispatch/dstLaunch（dsh 类 agent 的 dst 交互前端：dsh 本体无交互/续接旗标，
 * 派发 `dst -- <提示词>`、回放 `dst --resume <id>`）+ 交互派发 dsh agent 的注入行/账本摘要。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dispatchInteractive } from "../src/host/dispatch/interactive";
import { createFakeTerminal } from "../src/host/dispatch/terminalAdapters";
import { agentLine, posixQuote, promptSummary, remotePayloadLine, sshAliasLine } from "../src/host/dispatch/cmdline";
import { dispatchPrompt } from "../src/host/domain/injection";
import { dstLaunchLine, dstReplayLine, isDshKind } from "../src/host/dispatch/dstLaunch";
import { createTestDb, seedTask, type TestDb } from "./helpers";

/** 真 shell 剥一层引用（本机 shell / 远端外层 shell 各剥一层——与命令行实际经历的解析一致） */
function shellUnquote(token: string): string {
  return execFileSync("/bin/sh", ["-c", `printf '%s' ${token}`], { encoding: "utf8" });
}

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 挂项目标签的任务（tag meta 指向 ag-1） */
function seedProjectTask(title: string): number {
  const taskId = seedTask(db.conn, title);
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

describe("ssh 别名包装行 / 远端载荷（desktop direct_ssh_argv 同构）", () => {
  it("remotePayloadLine：工作目录非空 cd 段前缀（~ 裸写）；空目录原样", () => {
    expect(remotePayloadLine("claude -p", "~/proj")).toBe("cd ~/proj && claude -p");
    expect(remotePayloadLine("claude -p", "/srv/my app")).toBe("cd '/srv/my app' && claude -p");
    expect(remotePayloadLine("claude -p", "")).toBe("claude -p");
    expect(remotePayloadLine("claude -p", null)).toBe("claude -p");
  });

  it("sshAliasLine：-tt + ConnectTimeout + 别名 + 登录 shell -c；载荷自携单引号再整体引用；port 22/0 与空 key 不带旗标", () => {
    expect(sshAliasLine("dev-box", "cd /srv && claude")).toBe(
      `ssh -tt -o ConnectTimeout=10 -- dev-box exec '"$SHELL"' -l -c ''\\''cd /srv && claude'\\'''`,
    );
    expect(sshAliasLine("dev-box", "x", { port: 22, keyPath: "  " })).not.toMatch(/ -p | -i /);
    expect(sshAliasLine("dev-box", "x", { port: 2222, keyPath: "~/.ssh/k" })).toContain(
      "ConnectTimeout=10 -i '~/.ssh/k' -p 2222 -- dev-box",
    );
  });

  it("sshAliasLine：载荷含单引号与多行 prompt 时两层剥引后远端内层 -c 逐字拿到载荷（交互派发只送达首行的回归）", () => {
    // 真实派发载荷：cd 段 + agent 行（prompt 整体单引号引用，内含 '\'' 转义与多行定界块）
    const prompt = dispatchPrompt(4, '标题 it\'s "q"', "详情一\n详情二", ["跟进"], "备注");
    const payload = remotePayloadLine(agentLine("claude", ["--session-id", "s1"], prompt), "~/proj");
    const line = sshAliasLine("dev-box", payload);
    const token = posixQuote(posixQuote(payload));
    expect(line.endsWith(` -c ${token}`)).toBe(true);
    const remoteWord = shellUnquote(token); // 本机 shell 剥一层 = ssh 原样送达远端的 -c 参数文本
    expect(shellUnquote(remoteWord)).toBe(payload); // 远端外层 shell 再剥一层 = 内层 -c 的完整命令串
    expect(payload).toContain("===== 待办数据结束 =====");
  });

  it("promptSummary：48 字符截断加省略号；短文原样", () => {
    expect(promptSummary("短")).toBe("短");
    const long = "提示词".repeat(20);
    expect(promptSummary(long)).toBe(`${"提示词".repeat(16)}…`);
  });
});

describe("dsh 类 agent 的 dst 前端（dstLaunch）", () => {
  it("isDshKind 识别 dsh / dst / dsh-tui（含路径）；claude 不命中", () => {
    expect(isDshKind("dsh")).toBe(true);
    expect(isDshKind("dst")).toBe(true);
    expect(isDshKind("/opt/homebrew/bin/dsh-tui")).toBe(true);
    expect(isDshKind("claude")).toBe(false);
  });

  it("dstLaunchLine 以 `--` 交字面提示词（整体引用）；dstReplayLine 有 id → --resume、无 id → 裸 dst", () => {
    expect(dstLaunchLine("修 bug && 跑测试")).toBe("dst -- '修 bug && 跑测试'");
    expect(dstReplayLine("sess-9")).toBe("dst --resume sess-9");
    expect(dstReplayLine(null)).toBe("dst");
  });

  it("交互派发 dsh agent：注入行与账本摘要均为 dst 形态（不带 dsh 历史参数），工作目录仍经适配器 workdir 传递", async () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
      JSON.stringify([
        {
          id: "ag-1",
          name: "DSH",
          command: "dsh",
          args: "headless {prompt}",
          historyArgs: "--profile headless",
          workdir: "/tmp",
          timeoutSecs: 120,
          enabled: true,
        },
      ]),
    );
    const terminal = createFakeTerminal();
    const taskId = seedProjectTask("dst 派发");
    const outcome = await dispatchInteractive(db.conn, { terminal }, taskId);
    expect(outcome.line.startsWith("dst -- '")).toBe(true);
    expect(outcome.line).not.toContain("headless");
    expect(terminal.injections[0]?.workdir).toBe("/tmp");
    const row = db.conn.prepare("SELECT command FROM agent_sessions WHERE task_id=?").get(taskId) as {
      command: string;
    };
    expect(row.command.startsWith("dst -- '")).toBe(true);
    expect(row.command).toContain("…");
  });
});
