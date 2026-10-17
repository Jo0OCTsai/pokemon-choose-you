/**
 * dispatch/executor：local 子进程（{prompt} 占位 / stdin 路径 / 超时 kill / 信封解析 /
 * 超时下限 600）+ fake 执行器三态。local 用真实 node 子进程（-e 脚本）驱动。
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalArgv,
  createFakeExecutor,
  createLocalExecutor,
  effectiveTimeoutSecs,
  parseHeadlessEnvelope,
} from "../src/host/dispatch/executor";
import { DISPATCH_MIN_TIMEOUT_SECS } from "../src/host/domain/dispatch-slots";

const NODE = process.execPath;

describe("effectiveTimeoutSecs（DISPATCH_MIN_TIMEOUT_SECS=600 下限）", () => {
  it("配置小于 600 按下限；大于则原样", () => {
    expect(effectiveTimeoutSecs(30)).toBe(600);
    expect(effectiveTimeoutSecs(0)).toBe(600);
    expect(effectiveTimeoutSecs(1200)).toBe(1200);
    expect(DISPATCH_MIN_TIMEOUT_SECS).toBe(600); // headless.rs DISPATCH_MIN_TIMEOUT_SECS 同值
  });
});

describe("parseHeadlessEnvelope（headless.rs 同构）", () => {
  it("claude JSON 信封字段提取；is_error 判失败；非 JSON 全空", () => {
    const env = parseHeadlessEnvelope(
      '{"type":"result","session_id":"abc-1","total_cost_usd":0.42,"usage":{"input_tokens":1000,"output_tokens":2000},"is_error":false}',
    );
    expect(env.sessionId).toBe("abc-1");
    expect(env.costUsd).toBeCloseTo(0.42);
    expect(env.inputTokens).toBe(1000);
    expect(env.outputTokens).toBe(2000);
    expect(env.isError).toBe(false);
    expect(parseHeadlessEnvelope('{"is_error":true,"session_id":"abc-2"}').isError).toBe(true);
    // JSON 但非对象（数字/数组）全空；session_id 非字符串按缺省
    expect(parseHeadlessEnvelope("42").isError).toBe(false);
    expect(parseHeadlessEnvelope("[1,2]").sessionId).toBeUndefined();
    expect(parseHeadlessEnvelope('{"session_id":5}').sessionId).toBeUndefined();
    const text = parseHeadlessEnvelope("处理完成，变更见 git log");
    expect(text.sessionId).toBeUndefined();
    expect(text.costUsd).toBeUndefined();
    expect(text.isError).toBe(false);
  });
});

describe("buildLocalArgv（invocation.rs 本地分支同构）", () => {
  it("{prompt} 占位替换进 argv；无占位时 prompt 走 stdin", () => {
    const withArg = buildLocalArgv({
      command: "claude",
      args: "-p {prompt} --output-format json",
      prompt: "做点事",
      timeoutSecs: 60,
    });
    expect(withArg.argv).toEqual(["-p", "做点事", "--output-format", "json"]);
    expect(withArg.stdin).toBeNull();
    const viaStdin = buildLocalArgv({ command: "claude", args: "-p", prompt: "做点事", timeoutSecs: 60 });
    expect(viaStdin.argv).toEqual(["-p"]);
    expect(viaStdin.stdin).toBe("做点事");
  });
});

describe("local 执行器（真实 node 子进程）", () => {
  it("成功：退出码 0 + stdout 透传（env 注入可见）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e process.stdout.write(process.env.PK_DISPATCH_TASK||'none')",
      prompt: "",
      timeoutSecs: 60,
      env: { PK_DISPATCH_TASK: "7" },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("7");
    expect(outcome.timedOut).toBe(false);
    expect(outcome.error).toBeUndefined();
  });

  it("失败：非零退出码透传（不抛错）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e process.exit(3)",
      prompt: "",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.timedOut).toBe(false);
  });

  it("超时 kill：挂起子进程到时被杀，timedOut=true（下限注入缩短等待）", async () => {
    const executor = createLocalExecutor(0.2);
    const outcome = await executor.launch({
      command: NODE,
      args: "-e setTimeout(()=>{},60000)",
      prompt: "",
      timeoutSecs: 0.1,
    });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).toBeNull();
  });
});

describe("local 执行器 IO 路径（stdin / spawn 失败）", () => {
  it("stdin 路径：无 {prompt} 占位时 prompt 写入子进程 stdin", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.trim()))",
      prompt: "PROMPT-BODY",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("PROMPT-BODY");
  });

  it("kill()：中止挂起中的执行（timedOut 收口）", async () => {
    const executor = createLocalExecutor(60);
    const pending = executor.launch({
      command: NODE,
      args: "-e setInterval(()=>{},60000)",
      prompt: "",
      timeoutSecs: 60,
    });
    await new Promise((r) => setTimeout(r, 80));
    executor.kill();
    const outcome = await pending;
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).toBeNull();
  });

  it("进程被信号终止（非超时路径）：code=null + stderr 摘要进 error", async () => {
    const executor = createLocalExecutor();
    const withErr = await executor.launch({
      command: NODE,
      args: '-e console.error("boom-stderr");process.kill(process.pid,"SIGKILL")',
      prompt: "",
      timeoutSecs: 60,
    });
    expect(withErr.exitCode).toBeNull();
    expect(withErr.timedOut).toBe(false);
    expect(withErr.error).toMatch(/信号终止/);
    expect(withErr.error).toMatch(/boom-stderr/);
  });
});

describe("local 执行器占位与 kill/cwd", () => {
  it("{prompt} 占位经 argv 注入（无 stdin 写入）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e process.stdout.write(process.argv[1]) {prompt}",
      prompt: "PROMPT-ARG",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("PROMPT-ARG");
  });

  it("spawn 同步抛错（非法 cwd 控制字符）→ error 收口不炸", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e 0",
      prompt: "",
      workdir: "/tmp/\u0000bad",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBeNull();
    expect(outcome.error).toBeTruthy();
    expect(outcome.timedOut).toBe(false);
  });

  it("workdir 生效：子进程 cwd = 配置目录（真实临时目录）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e process.stdout.write(process.cwd())",
      prompt: "",
      workdir: process.cwd(),
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(process.cwd());
  });
});

describe("local 执行器环境解析（localEnv 接线：which.rs / agent_workdir 同构）", () => {
  it("回归：workdir `~` 前缀展开为 home（spawn 不展开 ~，cwd 不存在时误报 spawn <cmd> ENOENT）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e process.stdout.write(process.cwd())",
      prompt: "",
      workdir: "~",
      timeoutSecs: 60,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    expect(realpathSync(outcome.stdout)).toBe(realpathSync(homedir()));
  });

  it("裸命令名经 PATH 解析后可启动（which 同构接线不破坏常规裸名）", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: basename(NODE),
      args: "-e process.stdout.write('bare-ok')",
      prompt: "",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("bare-ok");
  });
});

describe("local 执行器 spawn 失败", () => {
  it("不可执行命令：error 文案可读（不抛错）；ENOENT 附带安装 / PATH / 绝对路径可操作提示", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: "/definitely/not/a/real/binary-pky",
      args: "",
      prompt: "",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBeNull();
    expect(outcome.error).toMatch(/无法启动/);
    expect(outcome.error).toMatch(/ENOENT/);
    expect(outcome.error).toMatch(/绝对路径/);
  });

  it("工作目录不存在：同样 ENOENT，提示里点名工作目录", async () => {
    const executor = createLocalExecutor();
    const outcome = await executor.launch({
      command: NODE,
      args: "-e 0",
      prompt: "",
      workdir: "/definitely/not/a/real/dir-pky",
      timeoutSecs: 60,
    });
    expect(outcome.exitCode).toBeNull();
    expect(outcome.error).toMatch(/ENOENT/);
    expect(outcome.error).toMatch(/工作目录/);
  });
});

describe("fake 执行器（测试替身）", () => {
  it("默认成功；可编程失败 / 挂起等 kill；job 记录可断言", async () => {
    const fake = createFakeExecutor();
    const ok = await fake.launch({ command: "x", args: "", prompt: "p", timeoutSecs: 1 });
    expect(ok.exitCode).toBe(0);
    fake.enqueue({ exitCode: 1, error: "boom" });
    const bad = await fake.launch({ command: "x", args: "", prompt: "p", timeoutSecs: 1 });
    expect(bad.exitCode).toBe(1);
    expect(bad.error).toBe("boom");
    expect(fake.jobs).toHaveLength(2);
    expect(fake.jobs[0]?.prompt).toBe("p");
  });

  it("hang 挂起直到 kill（驱动超时/中止路径）", async () => {
    const fake = createFakeExecutor();
    fake.enqueue("hang");
    const hanging = fake.launch({ command: "x", args: "", prompt: "p", timeoutSecs: 1 });
    fake.kill();
    const killed = await hanging;
    expect(killed.timedOut).toBe(true);
    expect(fake.kills).toBe(1);
  });
});
