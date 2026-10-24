/**
 * 判定 CLI 执行面（从 adapters.ts 拆出——棘轮 max-lines，等量迁移；adapters.ts 为统一再出口，
 * 消费面不变）：本机子进程 spawn（realAgentSpawn——which.rs/runner.rs 基准的 GUI 精简 PATH
 * 适配）、命令行组装（build_invocation 本地分支同构）、远端 DispatchExecutor 路径（绑定部署
 * 的 agent 在部署上执行——judge.rs resolve_remote_target 同构）与远端结果折算判定口径；
 * 远端面解析（工厂缺席拒绝）在 adapters.ts resolveRemoteExecutor。
 * 零 dsh 依赖。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { childEnvFor, expandHome, resolveCommand, spawnErrorHint } from "../dispatch/localEnv";
import type { DispatchExecutor } from "../dispatch/executor";
import { sessionArgv } from "./sessionId";
import { PkyError } from "../storage/errors";
import type { AgentConfig } from "../domain/settings";

/** 单次 agent 调用的超时下限（秒，runner.rs MIN_TIMEOUT_SECS） */
export const MIN_AGENT_TIMEOUT_SECS = 10;

// ---- 子进程执行面（可注入） ----

export interface AgentSpawn {
  (
    program: string,
    argv: string[],
    opts: { stdin?: string; cwd?: string; timeoutMs: number; env?: Record<string, string> },
  ): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

/**
 * 真实子进程执行面：GUI 进程精简 PATH 适配同构 dispatch/localEnv（which.rs/runner.rs 基准）——
 * 裸名补扫解析绝对路径、workdir `~/` 展开 + 存在性预检（目录缺失独立报错，不与命令
 * 找不到的 ENOENT 混淆）、子进程 PATH 前插 node 宿主目录（`#!/usr/bin/env node` 脚本）。
 */
export const realAgentSpawn: AgentSpawn = (program, argv, opts) =>
  new Promise((resolve, reject) => {
    const bin = resolveCommand(program);
    const cwd = expandHome(opts.cwd);
    if (cwd !== undefined && !existsSync(cwd)) {
      reject(new Error(`Agent 工作目录不存在: ${cwd}（请在设置中改正）`));
      return;
    }
    const child = spawn(bin, argv, { cwd, env: childEnvFor(bin, opts.env), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new PkyError("JUDGE_TIMEOUT", `Agent「${program}」执行超时（${opts.timeoutMs / 1000} 秒），可在设置中调大超时`),
      );
    }, opts.timeoutMs);
    child.stdout?.on("data", (c: Buffer) => out.push(c));
    child.stderr?.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Agent「${program}」执行失败: ${e.message}${spawnErrorHint(e.message)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      } else {
        const detail =
          Buffer.concat(err).toString("utf8").trim().slice(0, 300) ||
          Buffer.concat(out).toString("utf8").trim().slice(0, 300);
        reject(new Error(`Agent「${program}」退出码 ${code ?? -1}：${detail}`));
      }
    });
    if (opts.stdin !== undefined) {
      // 子进程未读 stdin 即退出（如无 {prompt} 占位的 CLI 秒退）时写入 EPIPE——失败已由
      // 退出码路径上报，吞掉 EPIPE 勿成未处理错误炸宿主；其余写入错误维持原样上抛
      child.stdin?.on("error", (e) => {
        if ((e as NodeJS.ErrnoException).code !== "EPIPE") throw e;
      });
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });

/** 命令行组装（build_invocation 本地分支同构）：args 按空白切分、{prompt} 替换；未出现走 stdin */
export function buildAgentInvocation(
  agent: Pick<AgentConfig, "command" | "args">,
  prompt: string,
): { program: string; argv: string[]; stdin?: string } {
  const args = agent.args.split(/\s+/).filter((a) => a !== "");
  const hasPromptSlot = args.some((a) => a.includes("{prompt}"));
  const argv = args.map((a) => a.replaceAll("{prompt}", prompt));
  return { program: agent.command, argv, stdin: hasPromptSlot ? undefined : prompt };
}

// ---- 本机 / 远端两条执行路径（cliJudgeExecutor.run 消费） ----

/** 一次判定调用的执行面入参（本机 spawn / 远端 DispatchExecutor 两条路径共用） */
export interface JudgeInvocation {
  agent: AgentConfig;
  prompt: string;
  kind: string | null;
  pregen: string | null;
  timeoutMs: number;
  env: Record<string, string> | undefined;
  /** 执行时工作目录（cliJudgeExecutor 按执行世界解析：远端 = 部署工作区口径；本机 = agent.workdir） */
  workdir: string;
}

/** 本机子进程执行（realAgentSpawn 口径：argv 已替换 {prompt}，会话旗标追加 argv 尾） */
export async function spawnLocalJudge(spawnFn: AgentSpawn, inv: JudgeInvocation): Promise<string> {
  const built = buildAgentInvocation(inv.agent, inv.prompt);
  const out = await spawnFn(built.program, sessionArgv(built.argv, inv.kind, inv.pregen, inv.agent.args), {
    stdin: built.stdin,
    cwd: inv.workdir === "" ? undefined : inv.workdir,
    timeoutMs: inv.timeoutMs,
    ...(inv.env === undefined ? {} : { env: inv.env }),
  });
  return out.stdout;
}

/** 远端执行（DispatchExecutor 口径：会话旗标以模板尾缀交执行器，{prompt} 替换 / stdin 语义与本机同构） */
export async function spawnRemoteJudge(executor: DispatchExecutor, inv: JudgeInvocation): Promise<string> {
  const outcome = await executor.launch({
    command: inv.agent.command,
    args: [inv.agent.args, ...sessionArgv([], inv.kind, inv.pregen, inv.agent.args)].filter((t) => t !== "").join(" "),
    prompt: inv.prompt,
    workdir: inv.workdir === "" ? null : inv.workdir,
    timeoutSecs: inv.agent.timeoutSecs,
    ...(inv.env === undefined ? {} : { env: inv.env }),
  });
  return remoteStdoutOf(outcome, inv.agent, inv.timeoutMs);
}

/** 远端执行结果 → 判定口径（成功取 stdout；超时 JUDGE_TIMEOUT、执行错误/非零退出带详情抛错——与本机 realAgentSpawn 同形） */
function remoteStdoutOf(
  outcome: Awaited<ReturnType<DispatchExecutor["launch"]>>,
  agent: Pick<AgentConfig, "name">,
  timeoutMs: number,
): string {
  if (outcome.timedOut) {
    throw new PkyError(
      "JUDGE_TIMEOUT",
      `Agent「${agent.name}」远端执行超时（${timeoutMs / 1000} 秒），可在设置中调大超时`,
    );
  }
  if (outcome.error !== undefined) {
    throw new Error(`Agent「${agent.name}」远端执行失败: ${outcome.error}`);
  }
  if (outcome.exitCode !== 0) {
    // stderr 优先（CLI 失败详情多在 stderr），stdout 兜底——与 realAgentSpawn 口径同形
    const detail = (outcome.stderr ?? "").trim().slice(0, 300) || outcome.stdout.trim().slice(0, 300);
    throw new Error(`Agent「${agent.name}」退出码 ${outcome.exitCode ?? -1}：${detail}`);
  }
  return outcome.stdout;
}

/** 远端执行面 bundle（remoteJudgeExecutorFor 产出）：执行器 + 部署登记工作区（空 = 未登记） */
export interface RemoteJudgePlane {
  executor: DispatchExecutor;
  workdir: string;
}

/** 绑定部署的 agent 取远端执行面：工厂缺席（远程平台面未装配）或返回 null 一律明确拒绝，不回落本机 */
export function resolveRemoteExecutor(
  factory: ((agent: AgentConfig) => RemoteJudgePlane | null) | undefined,
  agent: AgentConfig,
): RemoteJudgePlane {
  const alias = agent.deployment?.trim() ?? "";
  const remote = factory?.(agent) ?? null;
  if (remote === null) {
    throw new PkyError(
      "DEPLOYMENT_NOT_READY",
      `agent「${agent.name}」绑定部署「${alias}」，但当前宿主未装配远程执行面，无法在部署上判定`,
      "在 dsh 宿主内运行，或解除该 agent 的部署绑定改回本机执行",
    );
  }
  return remote;
}

/**
 * 判定执行世界（cliJudgeExecutor 消费；懒解析 + 实例内缓存——执行方一次判定一建）：
 * 远端面经注入工厂解析（绑定部署；缺席明确拒绝）；工作目录随执行世界——远端 = 部署登记
 * 工作区压过 agent.workdir（本机路径语义在远端展开成远端 home 子目录），本机 = agent.workdir。
 */
export function judgeWorldOf(
  agent: AgentConfig,
  remoteExecutorFor: ((agent: AgentConfig) => RemoteJudgePlane | null) | undefined,
) {
  const remoteHost = agent.deployment?.trim() ?? "";
  let cachedRemote: RemoteJudgePlane | null | undefined;
  let cachedWorkdir: string | null = null;
  const remoteOf = (): RemoteJudgePlane | null => {
    if (remoteHost === "") {
      return null;
    }
    return (cachedRemote ??= resolveRemoteExecutor(remoteExecutorFor, agent));
  };
  return {
    remoteHost,
    remoteOf,
    workdirOf(): string {
      if (cachedWorkdir === null) {
        const remote = remoteOf();
        cachedWorkdir = remote === null ? agent.workdir : remote.workdir.trim() !== "" ? remote.workdir : agent.workdir;
      }
      return cachedWorkdir;
    },
  };
}
