/**
 * agent 工具面命令（agentTest 连接探针 / pkSkillCheck / pkSkillInstall）：
 * 探针经 fixture 的 dispatchDeps 执行器替身（stdout 可按用例覆写）；技能检查/安装
 * 用 dir 覆盖参数指向临时目录（不碰真实 $HOME 技能目录）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DispatchJob, ExecOutcome } from "../src/host/dispatch/executor";
import type { ResolvedDispatchRoute } from "../src/host/dispatch/routes";
import { seedDeployment } from "./helpers";
import { seedAgent } from "./agentToolsSeed";
import { createCommandsFixture, type CommandsFixture } from "./commandsSetup";

let f: CommandsFixture;
beforeEach(() => {
  f = createCommandsFixture();
});
afterEach(() => {
  f.close();
});

/** 探针执行器替身：返回固定 stdout（按用例注入） */
function probeStdout(stdout: string, extra: Partial<ExecOutcome> = {}): void {
  f.deps.dispatchDeps.executorFor = () => ({
    launch: async (): Promise<ExecOutcome> => ({
      exitCode: 0,
      durationMs: 5,
      stdout,
      timedOut: false,
      ...extra,
    }),
    kill: () => undefined,
  });
}

/**
 * 装配层同形替身（remoteHeadlessDeps 语义）：路由带 deployment → 远端执行器（记录 job、
 * 回 remoteStdout）；deployment null → 本机执行器（记录 job、stdout 恒空）。远端 agent
 * 落到本机执行器即「本机 CLI 冒充」回归红。
 */
function executorRouting(remoteStdout: string): {
  seen: Array<Pick<ResolvedDispatchRoute, "deployment" | "workdir">>;
  remoteJobs: DispatchJob[];
  localJobs: DispatchJob[];
} {
  const seen: Array<Pick<ResolvedDispatchRoute, "deployment" | "workdir">> = [];
  const remoteJobs: DispatchJob[] = [];
  const localJobs: DispatchJob[] = [];
  f.deps.dispatchDeps.executorFor = (_agent, route) => {
    seen.push({ deployment: route.deployment, workdir: route.workdir });
    const isLocal = route.deployment === null;
    const jobs = isLocal ? localJobs : remoteJobs;
    return {
      launch: async (job): Promise<ExecOutcome> => {
        jobs.push(job);
        return { exitCode: 0, durationMs: 5, stdout: isLocal ? "" : remoteStdout, timedOut: false };
      },
      kill: () => undefined,
    };
  };
  return { seen, remoteJobs, localJobs };
}

describe("agentTest × 凭据环境注入（dispatchDeps.agentEnv——判定/派发同链路）", () => {
  it("命中 → 探针 job 带凭据环境", async () => {
    seedAgent(f.conn, "ag-dsh", "dsh");
    const jobs: Array<{ command: string; env: Record<string, string> | undefined }> = [];
    f.deps.dispatchDeps.executorFor = () => ({
      launch: async (job): Promise<ExecOutcome> => {
        jobs.push({ command: job.command, env: job.env });
        return { exitCode: 0, durationMs: 5, stdout: '{"openTasks":1}', timedOut: false };
      },
      kill: () => undefined,
    });
    f.deps.dispatchDeps.agentEnv = async () => ({ DEEPSEEK_API_KEY: "sk-probe" });
    const out = (await f.call("agentTest", { agentId: "ag-dsh" })) as {
      data: { connected: boolean };
    };
    expect(out.data.connected).toBe(true);
    expect(jobs[0]?.env).toEqual({ DEEPSEEK_API_KEY: "sk-probe" });
  });
});

describe("agentTest 连接探针（ai::test 同构）", () => {
  it("stdout 含 openTasks → connected true + 成功文案", async () => {
    seedAgent(f.conn, "ag-probe", "claude");
    probeStdout('{"openTasks":3,"now":"2026-10-15T09:00:00+08:00"}');
    const out = (await f.call("agentTest", { agentId: "ag-probe" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.ok).toBe(true);
    expect(out.data.connected).toBe(true);
    expect(out.data.message).toContain("pk 工具链已连通");
  });

  it("探针有回复但无 pk 输出 → connected false + 白名单指引与回复片段", async () => {
    seedAgent(f.conn, "ag-plain", "claude");
    probeStdout("我没有找到 pk 这个命令。");
    const out = (await f.call("agentTest", { agentId: "ag-plain" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("工具白名单");
    expect(out.data.message).toContain("我没有找到 pk");
  });

  it("未配置任何 agent → INVALID_ARGUMENT；超时 → connected false 带超时文案", async () => {
    const none = (await f.call("agentTest", {})) as { ok: boolean; error: { code: string } };
    expect(none.ok).toBe(false);
    expect(none.error.code).toBe("INVALID_ARGUMENT");
    seedAgent(f.conn, "ag-slow", "claude");
    probeStdout("", { timedOut: true });
    const out = (await f.call("agentTest", { agentId: "ag-slow" })) as {
      data: { connected: boolean; message: string };
    };
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("超时");
  });
});

describe("agentTest × claude --output-format json 信封（extractPayload 解包后再判定/截断）", () => {
  it("回复片段取 result 正文（不停在元数据头部）；result 含 openTasks 判连通", async () => {
    seedAgent(f.conn, "ag-json", "claude");
    const meta = `"duration_api_ms":${"1".repeat(150)},"num_turns":3,"type":"result","is_error":true,"session_id":"s-1",`;
    probeStdout(`{${meta}"result":"bash: pk: command not found (exit 127)"}`);
    const failed = (await f.call("agentTest", { agentId: "ag-json" })) as {
      data: { connected: boolean; message: string };
    };
    expect(failed.data.connected).toBe(false);
    expect(failed.data.message).toContain("bash: pk: command not found (exit 127)");
    expect(failed.data.message).not.toContain("duration_api_ms");

    probeStdout(`{${meta}"result":"{\\"openTasks\\":[],\\"now\\":\\"2026-10-20T10:00\\"}"}`);
    const ok = (await f.call("agentTest", { agentId: "ag-json" })) as { data: { connected: boolean } };
    expect(ok.data.connected).toBe(true);
  });
});

describe("agentTest 远端 SSH agent（无 provider 不本机回落）", () => {
  it("无 provider 装配 → connected false + 远端提示（不拿本机同名 CLI 冒充探测）；有 provider 照常探测", async () => {
    seedAgent(f.conn, "ag-remote", "dsh", "gpu-1");
    f.deps.dispatchDeps.executorFor = () => null;
    const out = (await f.call("agentTest", { agentId: "ag-remote" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.ok).toBe(true);
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("远端");
    expect(out.data.message).toContain("gpu-1");
    // 平台注入了执行器（真实 SSH provider）：远端 agent 照常经其探测
    probeStdout('{"openTasks":1}');
    const viaProvider = (await f.call("agentTest", { agentId: "ag-remote" })) as {
      data: { connected: boolean };
    };
    expect(viaProvider.data.connected).toBe(true);
  });

  it("部署绑定空白视同本地（resolve_remote_target 同语义）：无 provider 走本机执行器", async () => {
    seedAgent(f.conn, "ag-blank-remote", process.execPath, "   ");
    f.deps.dispatchDeps.executorFor = () => null;
    const local = (await f.call("agentTest", { agentId: "ag-blank-remote" })) as {
      data: { connected: boolean; message: string };
    };
    expect(local.data.message).not.toContain("远端");
  });
});

describe("agentTest 探针路由随部署绑定合成（远端 agent 不落本机执行）", () => {
  it("部署绑定 → 路由带 deployment 经远端执行器探测；workdir = 实体登记工作区（压过 agent.workdir）", async () => {
    seedDeployment(f.conn, "pky-remote", "/workspaces/dev-env-settings");
    // agent.workdir 留本机语义路径：若落本机执行器，cwd 不存在直接 ENOENT（回归现场）
    seedAgent(f.conn, "ag-cc", "claude", "pky-remote", "/Users/jotsai/local-ws");
    const routing = executorRouting('{"openTasks":1}');
    const out = (await f.call("agentTest", { agentId: "ag-cc" })) as {
      data: { connected: boolean; message: string };
    };
    expect(out.data.connected).toBe(true);
    expect(routing.remoteJobs).toHaveLength(1);
    expect(routing.localJobs).toHaveLength(0);
    expect(routing.seen[0]?.deployment).toEqual({ ref: "pky-remote", target: "pky-remote" });
    expect(routing.remoteJobs[0]).toMatchObject({
      command: "claude",
      workdir: "/workspaces/dev-env-settings",
    });
  });

  it("未绑定部署 → 路由 deployment null + workdir = agent.workdir（本机探针行为不变）", async () => {
    seedAgent(f.conn, "ag-local", "claude", undefined, "/tmp/local-ws");
    const routing = executorRouting('{"openTasks":1}');
    const out = (await f.call("agentTest", { agentId: "ag-local" })) as {
      data: { connected: boolean; message: string };
    };
    expect(routing.seen[0]?.deployment).toBeNull();
    expect(routing.remoteJobs).toHaveLength(0);
    expect(routing.localJobs[0]).toMatchObject({ command: "claude", workdir: "/tmp/local-ws" });
    expect(out.data.connected).toBe(false); // 本机执行器替身 stdout 恒空 → 不连通文案
  });

  it("悬空绑定（实体已删）→ 路由仍带 deployment 且 workdir 回落 agent.workdir；装配层拒绝（null）→ 守卫文案点名部署", async () => {
    seedAgent(f.conn, "ag-dangling", "claude", "ghost", "/tmp/ws");
    const routing = executorRouting('{"openTasks":1}');
    const out = (await f.call("agentTest", { agentId: "ag-dangling" })) as {
      data: { connected: boolean };
    };
    expect(out.data.connected).toBe(true); // 实体缺失在路由合成不硬拒——planRemoteRoute 派发时守卫
    expect(routing.seen[0]?.deployment).toEqual({ ref: "ghost", target: "ghost" });
    expect(routing.remoteJobs[0]?.workdir).toBe("/tmp/ws");
    // 装配层计划被拒（DEPLOYMENT_NOT_READY / SSH_FAMILY_MISSING）形态 = null → 不冒充本机
    f.deps.dispatchDeps.executorFor = () => null;
    const rejected = (await f.call("agentTest", { agentId: "ag-dangling" })) as {
      data: { connected: boolean; message: string };
    };
    expect(rejected.data.connected).toBe(false);
    expect(rejected.data.message).toContain("ghost");
    expect(rejected.data.message).toContain("不能用本机同名 CLI 冒充");
  });
});
