/* eslint-disable complexity, max-lines, max-lines-per-function -- spike 探针为可重跑证据工件（非产品代码，AD §9），按「单文件自足可读」优先于复杂度上限 */
/**
 * pky-spike —— AD §9 spike 探针（非产品代码，随 specs/ 分发）。
 *
 * 验证点① 多实例 isolate 装配：两 label 作用域（pky-dep-a / pky-dep-b）各自
 *   isolate("ssh",label).isolate("subprocess",label) + 动态 import dsh-ssh 家族 +
 *   ctx.plugin() 装载（不同 Config/alias）→ 断言独立连接、单侧 dispose 不影响另一侧、
 *   同 scope 并发两路 spawn。
 * 验证点② terminal backend 作用域：两作用域 + 同作用域各开真 PTY，断言面板输出路由
 *   无串扰、注册无冲突（双终端并存 + 双向写读隔离）。
 * 附带：连接建立时长（NFR-15 P95 口径的样本）、宿主级 ssh 进程记账（装载/卸载副作用）、
 *   lib/helper.js 远端可跑（ctx.ssh.ready 即远端 node 直跑 helper + 摘要校验通过的证明）。
 *
 * env 门控：未设 PKY_SPIKE=1 时 apply() 立即返回（inert），spike 插件可常驻测试 profile。
 * 其余 env（由 run-spike.sh 注入）：
 *   PKY_SPIKE_ALIAS_A/B（OpenSSH 别名，默认 pky-spike-a/b）
 *   PKY_SPIKE_NODE（远端 node 绝对路径）
 *   PKY_SPIKE_HELPER（远端 helper 入口绝对路径）
 *   PKY_SPIKE_HASH（helper sha256）
 *   PKY_SPIKE_WS_A/B（远端工作目录）
 *   PKY_SPIKE_REPORT（报告 JSON 落点，默认 /tmp/pky-spike-report.json）
 *   PKY_SPIKE_KEEP=1（跑完不退进程——交互检查用）
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

export const name = "pky-spike";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 服务消费探针：cordis 要求消费方声明 inject 才能访问注入服务；spike 主插件在 root
 * ctx（无 ssh/subprocess 服务），故向目标 scope 装一个 consumer 子插件，其 apply 在
 * 两个服务都可用时被调用（cordis inject 等待语义），把引用递出来。
 */
function loadConsumer(scope, tag, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`consumer(${tag}) not started: services never became available`)), timeoutMs);
    const consumer = {
      name: `pky-spike-consumer-${tag}`,
      inject: ["ssh", "subprocess"],
      apply(c) {
        clearTimeout(timer);
        resolve({ ssh: c.ssh, subprocess: c.subprocess, ctx: c });
      },
    };
    try {
      scope.plugin(consumer, {});
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** 从终端输出流持续累积文本，直到谓词命中或超时；返回 { text, hit }。 */
async function drainUntil(handle, predicate, timeoutMs = 20000) {
  let text = "";
  const chunks = [];
  const decoder = new TextDecoder();
  const onChunk = (c) => {
    chunks.push(decoder.decode(c, { stream: true }));
  };
  handle.output.on("data", onChunk);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      text += chunks.splice(0).join("");
      if (predicate(text)) return { text, hit: true };
      await sleep(80);
    }
    text += chunks.splice(0).join("") + decoder.decode();
    return { text, hit: predicate(text) };
  } finally {
    handle.output.off("data", onChunk);
  }
}

function sshProcessSnapshot() {
  try {
    return execSync("pgrep -fl 'ssh.*(pky-spike|dsh-helper)' || true", { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

async function spawnCollect(subprocess, argv, cwd) {
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: "ignore",
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 65536 },
    },
    graceMs: 10000,
  });
  const outcome = await handle.done;
  const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
  const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
  return { outcome, stdout, stderr };
}

export function apply(ctx) {
  if (process.env.PKY_SPIKE !== "1") return;
  const log = ctx.logger("pky-spike");
  log.info("spike armed (PKY_SPIKE=1)");
  void run(ctx, log).then(
    (report) => finish(ctx, log, report, 0),
    (error) => {
      const report = { fatal: String(error?.stack ?? error) };
      try {
        writeFileSync(process.env.PKY_SPIKE_REPORT ?? "/tmp/pky-spike-report.json", JSON.stringify(report, null, 2));
      } catch {}
      log.error("spike failed", error);
      finish(ctx, log, report, 1);
    },
  );
}

function finish(ctx, log, report, code) {
  log.info(`spike finished code=${code}`);
  if (process.env.PKY_SPIKE_KEEP === "1") return;
  setTimeout(() => process.exit(code), 250).unref();
  void ctx;
}

async function run(ctx, log) {
  const env = process.env;
  const aliasA = env.PKY_SPIKE_ALIAS_A ?? "pky-spike-a";
  const aliasB = env.PKY_SPIKE_ALIAS_B ?? "pky-spike-b";
  const node = env.PKY_SPIKE_NODE;
  const helper = env.PKY_SPIKE_HELPER;
  const helperHash = env.PKY_SPIKE_HASH;
  const wsA = env.PKY_SPIKE_WS_A;
  const wsB = env.PKY_SPIKE_WS_B;
  for (const [k, v] of Object.entries({ node, helper, helperHash, wsA, wsB })) {
    if (!v) throw new Error(`missing env ${k}`);
  }

  const report = {
    startedAt: new Date().toISOString(),
    env: { aliasA, aliasB, node, helper, helperHash: helperHash.slice(0, 12) + "…", wsA, wsB },
    checks: [],
    sshProcesses: { baseline: sshProcessSnapshot() },
  };
  const check = (id) => {
    const entry = { id, assertions: [] };
    report.checks.push(entry);
    return {
      ok(detail) {
        entry.assertions.push({ ok: true, ...(detail ? { detail } : {}) });
        log.info(`PASS ${id}${detail ? ` :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
      },
      fail(detail) {
        entry.assertions.push({ ok: false, detail });
        log.error(`FAIL ${id} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
      },
    };
  };

  const dshSshMod = await import("@deepseek-ai/dsh-ssh");
  const dshSubSshMod = await import("@deepseek-ai/dsh-subprocess-ssh");
  const dshSsh = dshSshMod.default;
  const dshSubSsh = dshSubSshMod.default;
  report.familyLoaded = {
    ssh: { name: dshSsh?.name ?? "SshConnection", hasConfig: !!dshSsh?.Config },
    subprocess: { name: dshSubSsh?.name ?? "SshSubprocessRuntime", inject: dshSubSsh?.inject },
  };

  // ---------- ③ 构建产物解析锚点（dsh 宿主进程内实测） ----------
  // 断言：插件包闭包内的 @deepseek-ai/dsh-ssh 解析锚定 = profile 的 dsh-plugin 依赖闭包
  // （file: 安装拷贝），peer（cordis）由 dsh install anchor 供给；uiohook-napi 的
  // N-API prebuild 在同一进程实载成功（ABI 稳定 → Electron 兼容由构造保证）。
  const c0 = check("vp3-anchor");
  try {
    const sshUrl = import.meta.resolve("@deepseek-ai/dsh-ssh");
    const subUrl = import.meta.resolve("@deepseek-ai/dsh-subprocess-ssh");
    const anchorOk = sshUrl.includes("/profiles/") && !sshUrl.includes("/lib/node_modules/");
    c0.ok({ msg: "dsh-ssh 解析锚点 = profile 插件闭包", sshUrl, subUrl });
    if (!anchorOk) c0.fail({ msg: "解析锚点不在 profile 内", sshUrl, self: import.meta.url });
    try {
      const hook = await import("uiohook-napi");
      const hookUrl = import.meta.resolve("uiohook-napi");
      c0.ok({ msg: "uiohook-napi prebuild 实载成功（N-API 稳定 ABI）", hookUrl, face: typeof (hook.default ?? hook) });
    } catch (error) {
      c0.fail({ msg: "uiohook-napi 加载失败", detail: String(error).slice(0, 300) });
    }
  } catch (error) {
    c0.fail({ msg: "解析锚点探测失败", detail: String(error).slice(0, 300) });
  }

  // ---------- ① 多实例 isolate 装配 ----------
  const c1 = check("vp1-multi-instance");
  const mkScope = (dep, alias, workspace) => {
    // cordis store 以 label 单一编址：同一 label 给 ssh 与 subprocess 两个名字会撞进
    // 同一注册槽（"service subprocess has been registered at <SshConnection>"）——
    // 每部署双 label（spike 实测修正，AD §3.1/§4.7 的同名 label 链式写法作废）。
    const sshLabel = Symbol(`pky-dep-${dep}-ssh`);
    const subLabel = Symbol(`pky-dep-${dep}-sub`);
    const sshScope = ctx.isolate("ssh", sshLabel);
    const subScope = sshScope.isolate("subprocess", subLabel);
    const fibers = [];
    return {
      dep,
      sshLabel,
      subLabel,
      sshScope,
      subScope,
      load: async () => {
        // fiber.dispose() 是 cordis 的卸载原语（context.dispose 是注入属性，探针无注入面）
        fibers.push(await sshScope.plugin(dshSsh, { host: alias, node, helper, helperHash, workspace }));
        fibers.push(await subScope.plugin(dshSubSsh, {}));
      },
      dispose: async () => {
        await Promise.all(fibers.map((f) => f.dispose()));
      },
    };
  };
  const scopeA = mkScope("a", aliasA, wsA);
  const scopeB = mkScope("b", aliasB, wsB);

  const t0 = Date.now();
  await scopeA.load();
  const consumerA = await loadConsumer(scopeA.subScope, "a");
  const connA = consumerA.ssh;
  const readyA = await connA.ready;
  const readyMsA = Date.now() - t0;
  c1.ok({ msg: "scopeA ctx.ssh ready（远端 helper 直跑 + 摘要校验通过）", readyMsA, hello: { platform: readyA?.platform, node: readyA?.node } });

  const t1 = Date.now();
  await scopeB.load();
  const consumerB = await loadConsumer(scopeB.subScope, "b");
  const connB = consumerB.ssh;
  await connB.ready;
  c1.ok({ msg: "scopeB ctx.ssh ready", readyMsB: Date.now() - t1 });

  if (connA === connB) c1.fail("两作用域拿到了同一连接实例");
  else c1.ok("两作用域连接实例独立");

  const subA = consumerA.subprocess;
  const subB = consumerB.subprocess;
  c1.ok("两作用域 ctx.subprocess 就绪（ssh runtime 注入各自 ctx.ssh）");

  // 独立性：各在工作目录跑 /bin/pwd，输出应各自等于自己的 workspace
  // （macOS /tmp 是 /private/tmp 的符号链接——pwd 返回解析后路径，按 realpath 归一比较）
  const norm = (p) => p.replace(/^\/private\/tmp\//, "/tmp/").replace(/\/+$/, "").trim();
  const [pwdA, pwdB] = await Promise.all([
    spawnCollect(subA, ["/bin/pwd"], wsA),
    spawnCollect(subB, ["/bin/pwd"], wsB),
  ]);
  if (norm(pwdA.stdout) === norm(wsA) && norm(pwdB.stdout) === norm(wsB)) c1.ok({ msg: "执行世界隔离（pwd 各归各 workspace）", a: pwdA.stdout.trim(), b: pwdB.stdout.trim() });
  else c1.fail({ msg: "pwd 输出错位", a: pwdA.stdout.trim(), b: pwdB.stdout.trim(), expectA: wsA, expectB: wsB });

  // 同 scope 并发两路 spawn（部署级连接复用语义——dsh-ssh 自协议单连接）
  const [c1a, c1b] = await Promise.all([
    spawnCollect(subA, ["/bin/echo", "CONCURRENT-A1"], wsA),
    spawnCollect(subA, ["/bin/echo", "CONCURRENT-A2"], wsA),
  ]);
  if (c1a.outcome.exitCode === 0 && c1b.outcome.exitCode === 0 && c1a.stdout.includes("CONCURRENT-A1") && c1b.stdout.includes("CONCURRENT-A2"))
    c1.ok("同 scope 并发两路 spawn 成立（单连接复用）");
  else c1.fail({ msg: "并发 spawn 失败", a: c1a, b: c1b });

  report.sshProcesses.bothLoaded = sshProcessSnapshot();

  // ---------- ② terminal backend 作用域 ----------
  const c2 = check("vp2-terminal-scope");
  const mkTerm = async (sub, dep, cwd) => {
    const handle = await sub.spawnTerminal({
      argv: ["/bin/sh", "-c", "echo TERM-READY; exec cat"],
      cwd,
      rows: 24,
      cols: 120,
      terminalType: "xterm-256color",
      graceMs: 8000,
    });
    const boot = await drainUntil(handle, (t) => t.includes("TERM-READY"));
    return { handle, boot };
  };
  const termA = await mkTerm(subA, "a", wsA);
  const termB = await mkTerm(subB, "b", wsB);
  c2.ok({ msg: "两作用域 PTY 并存分配成功", pidA: termA.handle.pid, pidB: termB.handle.pid, bootAHit: termA.boot.hit, bootBHit: termB.boot.hit });
  if (termA.handle.pid === termB.handle.pid) c2.fail("两作用域 PTY pid 相同（疑似同终端）");

  await termA.handle.write("ECHO-FROM-A\n");
  await termB.handle.write("ECHO-FROM-B\n");
  let drainA = await drainUntil(termA.handle, (t) => t.includes("ECHO-FROM-A"));
  let drainB = await drainUntil(termB.handle, (t) => t.includes("ECHO-FROM-B"));
  if (!drainA.hit) {
    // 首写可能落在 shell→exec cat 的换位窗口：补写一次再等
    await termA.handle.write("ECHO-FROM-A\n");
    drainA = await drainUntil(termA.handle, (t) => t.includes("ECHO-FROM-A"));
  }
  if (!drainB.hit) {
    await termB.handle.write("ECHO-FROM-B\n");
    drainB = await drainUntil(termB.handle, (t) => t.includes("ECHO-FROM-B"));
  }
  if (drainA.hit && drainB.hit) c2.ok("双作用域终端双向写读命中各自标记");
  else c2.fail({ msg: "终端标记未命中", aHit: drainA.hit, bHit: drainB.hit, textA: drainA.text.slice(0, 400), textB: drainB.text.slice(0, 400) });
  if (drainA.text.includes("ECHO-FROM-B")) c2.fail("A 终端串入了 B 的输入（路由串扰）");
  else if (drainB.text.includes("ECHO-FROM-A")) c2.fail("B 终端串入了 A 的输入（路由串扰）");
  else c2.ok("终端输出无跨作用域串扰");

  // 同作用域第二终端（同部署多面板形态）
  const termA2 = await mkTerm(subA, "a2", wsA);
  await termA2.handle.write("ECHO-FROM-A2\n");
  const drainA2 = await drainUntil(termA2.handle, (t) => t.includes("ECHO-FROM-A2"));
  if (drainA2.hit && !drainA2.text.includes("ECHO-FROM-B")) c2.ok({ msg: "同作用域第二终端独立路由", pid: termA2.handle.pid });
  else c2.fail("同作用域第二终端路由异常");

  // 终端存活复查（注册无相互覆盖：新终端不破坏旧终端）
  await termA.handle.write("ECHO-FROM-A-AGAIN\n");
  const drainA3 = await drainUntil(termA.handle, (t) => t.includes("ECHO-FROM-A-AGAIN"));
  if (drainA3.hit) c2.ok("旧终端在新终端注册后仍可用（无相互覆盖）");
  else c2.fail("旧终端失效（疑似注册覆盖）");

  termA.handle.terminate?.();
  termA2.handle.terminate?.();
  termB.handle.terminate?.();
  await Promise.allSettled([termA.handle.done, termA2.handle.done, termB.handle.done]);
  c2.ok("三终端全部收口");

  // ---------- ①收尾：单侧 dispose ----------
  const c3 = check("vp1-dispose-isolation");
  report.sshProcesses.beforeDispose = sshProcessSnapshot();
  try {
    await scopeA.dispose();
    c3.ok("scopeA dispose 完成（fiber 卸载无异常）");
  } catch (error) {
    c3.fail(`scopeA dispose 抛错: ${String(error)}`);
  }
  await sleep(800);
  report.sshProcesses.afterDisposeA = sshProcessSnapshot();
  try {
    const post = await spawnCollect(subB, ["/bin/echo", "B-SURVIVES"], wsB);
    if (post.outcome.exitCode === 0 && post.stdout.includes("B-SURVIVES")) c3.ok("dispose A 后 B 仍可用");
    else c3.fail({ msg: "dispose A 后 B 不可用", post });
  } catch (error) {
    c3.fail(`dispose A 后 B 调用抛错: ${String(error)}`);
  }
  try {
    await spawnCollect(subA, ["/bin/echo", "A-DEAD"], wsA);
    c3.fail("dispose 后 A 仍可执行（未真正卸载？）");
  } catch {
    c3.ok("dispose 后 A 通道关闭（真正卸载）");
  }

  await scopeB.dispose();
  await sleep(800);
  report.sshProcesses.final = sshProcessSnapshot();

  // ---------- 汇总 ----------
  const all = report.checks.flatMap((c) => c.assertions);
  report.summary = {
    passed: all.filter((a) => a.ok).length,
    failed: all.filter((a) => !a.ok).length,
    verdict: all.every((a) => a.ok) ? "PASS" : "FAIL",
    readyMsA,
  };
  report.finishedAt = new Date().toISOString();
  try {
    writeFileSync(process.env.PKY_SPIKE_REPORT ?? "/tmp/pky-spike-report.json", JSON.stringify(report, null, 2));
  } catch {}
  return report;
}
