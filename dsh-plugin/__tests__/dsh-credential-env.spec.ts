/**
 * dsh 形态子进程凭据环境注入链：dsh/credentialEnv 提供者（basename 门控 + 五路降级）
 * + judge/adapters 消费面（spawnFn opts.env 传递 / realAgentSpawn 的 childEnvFor 落地）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dshCredentialEnvOf } from "../src/host/dsh/credentialEnv";
import { cliJudgeExecutor } from "../src/host/judge/adapters";
import { applySuggestion } from "../src/host/domain/suggest-apply";
import type { AgentConfig } from "../src/host/domain/settings";
import { createTestDb, seedMessage, type TestDb } from "./helpers";

function fakeCtx(resolve?: (ref: string) => Promise<{ value: string; source?: string } | undefined>): unknown {
  return resolve === undefined ? {} : { credentials: { resolve } };
}

describe("dshCredentialEnvOf（宿主 credentials 服务 → AgentEnvProvider）", () => {
  it("dsh 命令（裸名/绝对路径/Windows 可执行扩展）+ 凭据在库 → 注入 DEEPSEEK_API_KEY", async () => {
    const env = dshCredentialEnvOf(
      fakeCtx(async (ref) => (ref === "DEEPSEEK_API_KEY" ? { value: "sk-store" } : undefined)),
    );
    await expect(env("dsh")).resolves.toEqual({ DEEPSEEK_API_KEY: "sk-store" });
    await expect(env("/opt/homebrew/bin/dsh")).resolves.toEqual({ DEEPSEEK_API_KEY: "sk-store" });
    await expect(env("C:\\tools\\dsh.exe")).resolves.toEqual({ DEEPSEEK_API_KEY: "sk-store" });
  });

  it("非 dsh 命令 → 不解析不注入（claude/pi 等别家 agent 不带 DeepSeek 凭据）", async () => {
    let called = 0;
    const env = dshCredentialEnvOf(
      fakeCtx(async () => {
        called += 1;
        return { value: "sk-store" };
      }),
    );
    await expect(env("claude")).resolves.toBeUndefined();
    await expect(env("/usr/local/bin/pi")).resolves.toBeUndefined();
    await expect(env("dsh-ssh")).resolves.toBeUndefined();
    expect(called).toBe(0);
  });

  it("未命中 / 空值 → 不注入", async () => {
    const miss = dshCredentialEnvOf(fakeCtx(async () => undefined));
    await expect(miss("dsh")).resolves.toBeUndefined();
    const empty = dshCredentialEnvOf(fakeCtx(async () => ({ value: "" })));
    await expect(empty("dsh")).resolves.toBeUndefined();
  });

  it("resolve 抛错 / 服务缺席 → 降级不注入（不抛错——子进程按原环境跑，dsh 自身报 MISSING_CREDENTIAL）", async () => {
    const boom = dshCredentialEnvOf(
      fakeCtx(async () => {
        throw new Error("store read failed");
      }),
    );
    await expect(boom("dsh")).resolves.toBeUndefined();
    const absent = dshCredentialEnvOf({});
    await expect(absent("dsh")).resolves.toBeUndefined();
  });
});

/** 判定 agent 夹具（command 可覆写） */
function judgeAgent(over: Partial<AgentConfig>): AgentConfig {
  return {
    id: "a1",
    name: "A1",
    command: "/bin/sh",
    args: "",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 10,
    enabled: true,
    ...over,
  };
}

/** 预落一条判定（模拟 agent 期间经 pk suggest batch 写回——spawnFn 成功返回后可回读） */
function seedLanded(conn: TestDb["conn"]): void {
  seedMessage(conn, "om_1", {});
  applySuggestion(conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
}

describe("凭据环境 × 判定执行方（cliJudgeExecutor agentEnv 消费面）", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.close());

  it("spawnFn 面：命中 → opts.env 传递；未注入/未命中 → opts.env 缺席", async () => {
    seedLanded(db.conn);
    const seen: Array<Record<string, string> | undefined> = [];
    const probeSpawn = (async (_program: string, _argv: string[], opts: { env?: Record<string, string> }) => {
      seen.push(opts.env);
      return { stdout: '{"result":"ok","session_id":"s"}', stderr: "" };
    }) as Parameters<typeof cliJudgeExecutor>[0]["spawnFn"];
    const run = (agentEnv?: () => Promise<Record<string, string> | undefined>) =>
      cliJudgeExecutor({ conn: db.conn, agent: judgeAgent({ command: "dsh" }), spawnFn: probeSpawn, agentEnv }).run({
        prompt: "p",
        messageIds: ["om_1"],
      });
    await run(async () => ({ DEEPSEEK_API_KEY: "sk-hit" }));
    await run();
    await run(async () => undefined);
    expect(seen).toEqual([{ DEEPSEEK_API_KEY: "sk-hit" }, undefined, undefined]);
  });

  it("真实子进程：env 经 realAgentSpawn 的 childEnvFor 注入（子进程环境可见）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pky-agent-env-"));
    try {
      const envdump = join(dir, "env.txt");
      const bin = join(dir, "env-agent.sh");
      writeFileSync(
        bin,
        `#!/bin/sh\ncat > /dev/null\nenv > ${envdump}\nprintf '%s' '{"result":"ok","session_id":"s"}'\n`,
      );
      chmodSync(bin, 0o755);
      seedLanded(db.conn);
      const exec = cliJudgeExecutor({
        conn: db.conn,
        agent: judgeAgent({ command: bin }),
        agentEnv: async () => ({ DEEPSEEK_API_KEY: "sk-judge-env-test" }),
      });
      const out = await exec.run({ prompt: "p", messageIds: ["om_1"] });
      expect(out.sessionId).toBe("s");
      expect(readFileSync(envdump, "utf8")).toContain("DEEPSEEK_API_KEY=sk-judge-env-test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
