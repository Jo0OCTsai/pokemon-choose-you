/**
 * 无头执行器接口 + local 子进程实现 + fake（测试）。
 *
 * 零 dsh 依赖（AD 约束）：subagent / SSH 远端执行世界全部经 DispatchExecutor 接口
 * 抽象——真实 dsh 桥（subagent 适配 / SSH provider）后续装配，本模块提供 local 与 fake。
 *
 * 行为基准 = src-tauri/src/ai/invocation.rs build_invocation（本地分支：args 空白分词、
 * {prompt} 占位替换、无占位走 stdin、cwd）+ ai/runner.rs（超时 kill）+
 * commands/dispatch/headless.rs（DISPATCH_MIN_TIMEOUT_SECS=600 超时下限）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { DISPATCH_MIN_TIMEOUT_SECS } from "../domain/dispatch-slots";

/** 一次无头执行的入参（agent 命令面 + 派发 prompt） */
export interface DispatchJob {
  command: string;
  /** 参数模板串（空白分词；含 {prompt} 的元素替换为提示词） */
  args: string;
  prompt: string;
  /** 子进程工作目录（空 = 继承宿主） */
  workdir?: string | null;
  /** 配置超时（秒）——生效值 = max(配置, 600) 对齐 DISPATCH_MIN_TIMEOUT_SECS */
  timeoutSecs: number;
  /** 子进程环境注入（如 PK_DISPATCH_TASK，headless.rs 同款） */
  env?: Record<string, string>;
}

/** claude --output-format json 信封的回传字段（headless.rs parse_headless_envelope 同构） */
export interface HeadlessEnvelope {
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  isError: boolean;
}

/** 执行结果（失败不抛错：编排层按状态落库——headless.rs HeadlessOutcome 同语义） */
export interface ExecOutcome {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  /** 超时被杀（编排层置 failed + DISPATCH_TIMEOUT 记因） */
  timedOut: boolean;
  /** spawn 失败等执行错误（原因文本） */
  error?: string;
}

/** 无头执行器（launch 一次一个；kill 中止当前执行） */
export interface DispatchExecutor {
  launch(job: DispatchJob): Promise<ExecOutcome>;
  kill(): void;
}

/** 生效超时（秒）：max(配置, 下限 600)——下限可注入仅供测试缩短等待 */
export function effectiveTimeoutSecs(timeoutSecs: number, minTimeoutSecs = DISPATCH_MIN_TIMEOUT_SECS): number {
  return Math.max(timeoutSecs, minTimeoutSecs);
}

/** 信封解析（非 JSON / 非对象输出全空——其他 agent 的纯文本输出） */
export function parseHeadlessEnvelope(stdout: string): HeadlessEnvelope {
  const parsed = tryParseObject(stdout);
  if (parsed === null) {
    return { isError: false };
  }
  const usage = readUsage(parsed);
  return {
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    costUsd: readNum(parsed.total_cost_usd),
    inputTokens: readNum(usage.input_tokens),
    outputTokens: readNum(usage.output_tokens),
    isError: parsed.is_error === true,
  };
}

/** JSON 解析为对象形态（数字/数组/坏 JSON → null） */
function tryParseObject(stdout: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(stdout.trim()) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readUsage(parsed: Record<string, unknown>): Record<string, unknown> {
  return typeof parsed.usage === "object" && parsed.usage !== null ? (parsed.usage as Record<string, unknown>) : {};
}

function readNum(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/** job → argv + stdin（invocation.rs 本地分支同构：{prompt} 替换；无占位走 stdin） */
export function buildLocalArgv(job: DispatchJob): { argv: string[]; stdin: string | null } {
  const args = job.args.split(/\s+/).filter((t) => t !== "");
  const hasPlaceholder = args.some((a) => a.includes("{prompt}"));
  return {
    argv: args.map((a) => a.replaceAll("{prompt}", job.prompt)),
    stdin: hasPlaceholder ? null : job.prompt,
  };
}

// ---- local 子进程实现（launchLocal / watchLocalChild / closeOutcome 三段） ----

/** 执行器进程态（kill 与超时共享；一次一个 launch） */
interface LocalRuntime {
  child: ChildProcess | null;
  killed: boolean;
}

/**
 * local 子进程执行器：child_process 跑 agent 命令，{prompt} 占位替换（无占位走
 * stdin），超时 kill（SIGTERM → 1s 后 SIGKILL 兜底）。超时下限 600 秒对齐
 * DISPATCH_MIN_TIMEOUT_SECS（headless.rs 同款）。
 */
export function createLocalExecutor(minTimeoutSecs: number = DISPATCH_MIN_TIMEOUT_SECS): DispatchExecutor {
  const runtime: LocalRuntime = { child: null, killed: false };
  return {
    launch: (job) => launchLocal(job, minTimeoutSecs, runtime),
    kill: () => {
      runtime.killed = true;
      runtime.child?.kill("SIGKILL");
      runtime.child = null;
    },
  };
}

/** 一次本地执行：spawn → 挂监听 → 等收口（失败/超时一律以 outcome 收场不抛错） */
function launchLocal(job: DispatchJob, minTimeoutSecs: number, runtime: LocalRuntime): Promise<ExecOutcome> {
  const { argv, stdin } = buildLocalArgv(job);
  const timeoutMs = effectiveTimeoutSecs(job.timeoutSecs, minTimeoutSecs) * 1000;
  const started = Date.now();
  let child: ChildProcess;
  try {
    child = spawn(job.command, argv, {
      cwd: job.workdir != null && job.workdir.trim() !== "" ? job.workdir : undefined,
      env: { ...process.env, ...job.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return Promise.resolve({
      exitCode: null,
      durationMs: Date.now() - started,
      stdout: "",
      timedOut: false,
      error: String(error),
    });
  }
  runtime.child = child;
  runtime.killed = false;
  return watchLocalChild(child, { stdin, timeoutMs, started, runtime });
}

interface WatchOptions {
  stdin: string | null;
  timeoutMs: number;
  started: number;
  runtime: LocalRuntime;
}

/** 子进程生命周期监听：输出收集 + 超时定时器 + close/error 收口 + stdin 写入 */
function watchLocalChild(child: ChildProcess, opts: WatchOptions): Promise<ExecOutcome> {
  const { stdin, timeoutMs, started, runtime } = opts;
  const out = collectOutput(child);
  let resolveRef: (outcome: ExecOutcome) => void = () => undefined;
  const done = new Promise<ExecOutcome>((resolve) => {
    resolveRef = resolve;
  });
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  const settle = (outcome: ExecOutcome): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer ?? undefined); // clearTimeout(undefined) 安全；事件回调前 timer 已就位
    runtime.child = null;
    resolveRef(outcome);
  };
  child.on("error", (err) => {
    settle(synthError(child.spawnfile, err.message, started, out));
  });
  child.on("close", (code) => settle(closeOutcome(code, { started, out, runtime })));
  timer = setTimeout(() => {
    runtime.killed = true;
    child.kill("SIGTERM");
    const fallback = setTimeout(() => child.kill("SIGKILL"), 1_000);
    fallback.unref?.();
  }, timeoutMs);
  if (stdin !== null) {
    // 子进程不读 stdin（EPIPE）不视为失败——写侧直接关闭
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  }
  return done;
}

/** stdout/stderr 累积器（按字符串拼接，中文安全） */
function collectOutput(child: ChildProcess): { stdout(): string; stderr(): string } {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: string | Buffer) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    stderr += String(chunk);
  });
  return { stdout: () => stdout, stderr: () => stderr };
}

/** spawn error 事件的收口形态（无法启动） */
function synthError(
  command: string,
  message: string,
  started: number,
  out: ReturnType<typeof collectOutput>,
): ExecOutcome {
  return {
    exitCode: null,
    durationMs: Date.now() - started,
    stdout: out.stdout(),
    timedOut: false,
    error: `无法启动 ${command}: ${message}`,
  };
}

/** close 收口形态：超时被杀 / 信号终止（非超时）/ 正常退出码 */
function closeOutcome(
  code: number | null,
  ctx: { started: number; out: ReturnType<typeof collectOutput>; runtime: LocalRuntime },
): ExecOutcome {
  const durationMs = Date.now() - ctx.started;
  if (ctx.runtime.killed) {
    return { exitCode: null, durationMs, stdout: ctx.out.stdout(), timedOut: true };
  }
  if (code === null) {
    const stderr = ctx.out.stderr();
    return {
      exitCode: null,
      durationMs,
      stdout: ctx.out.stdout(),
      timedOut: false,
      error: `进程被信号终止${stderr === "" ? "" : `：${stderr.slice(0, 200)}`}`,
    };
  }
  return { exitCode: code, durationMs, stdout: ctx.out.stdout(), timedOut: false };
}

// ---- fake 执行器（测试：可编程三态——成功 / 失败 / 挂起等 kill） ----

export type FakeOutcome = Partial<ExecOutcome> | "hang";

export interface FakeExecutor extends DispatchExecutor {
  /** 排队一次结果（launch 按序消费；不排队默认成功退出码 0） */
  enqueue(outcome: FakeOutcome): void;
  /** 已收到的 job 记录（断言 prompt/args/workdir/env） */
  readonly jobs: DispatchJob[];
  /** kill 调用计数 */
  readonly kills: number;
}

/** fake 执行器："hang" 挂起直到 kill()（驱动超时/中止路径）；其余按编程结果返回 */
export function createFakeExecutor(): FakeExecutor {
  const queue: FakeOutcome[] = [];
  const jobs: DispatchJob[] = [];
  const state = { kills: 0, onKill: null as (() => void) | null };
  return {
    jobs,
    enqueue(outcome) {
      queue.push(outcome);
    },
    get kills() {
      return state.kills;
    },
    launch(job: DispatchJob): Promise<ExecOutcome> {
      jobs.push(job);
      const outcome = queue.shift();
      if (outcome === "hang") {
        return new Promise<ExecOutcome>((resolve) => {
          state.onKill = () => resolve({ exitCode: null, durationMs: 0, stdout: "", timedOut: true });
        });
      }
      const started = Date.now();
      const base: ExecOutcome = { exitCode: 0, durationMs: 0, stdout: "", timedOut: false };
      return Promise.resolve({ ...base, ...(outcome ?? {}), durationMs: Date.now() - started });
    },
    kill(): void {
      state.kills++;
      state.onKill?.();
      state.onKill = null;
    },
  };
}
