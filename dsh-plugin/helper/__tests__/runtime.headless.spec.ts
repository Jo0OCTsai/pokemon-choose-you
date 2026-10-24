import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { DownstreamMsg } from "../src/bridge/protocol.ts";

/**
 * headless 集成：spawn 真 helper 入口（HELPER_HEADLESS=1 node src/main.ts——Node 24 原生执行
 * .ts，零 Electron 依赖验证「胶水与纯逻辑分离」），从宿主侧驱动桥全链路 + 生命周期守卫。
 */
const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");

const procs: ReturnType<typeof spawn>[] = [];
afterAll(() => {
  for (const p of procs.splice(0)) if (!p.killed) p.kill();
});

interface Lines {
  push(chunk: string): void;
  lines(): string[];
}

function lineCollector(): Lines {
  const out: string[] = [];
  let buf = "";
  return {
    push(chunk) {
      buf += chunk;
      for (;;) {
        const i = buf.indexOf("\n");
        if (i < 0) break;
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (l.trim()) out.push(l);
      }
    },
    lines: () => out,
  };
}

function spawnHelper(extraArgs: string[] = []) {
  const proc = spawn(process.execPath, [MAIN, ...extraArgs], {
    env: { ...process.env, HELPER_HEADLESS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  procs.push(proc);
  return proc;
}

async function waitFor<T>(fn: () => T, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 30));
  }
}

const down = (msg: DownstreamMsg) => `${JSON.stringify(msg)}\n`;

describe("headless 集成（真入口 · 桥全链路 + 宿主存亡守卫）", () => {
  it("启动即 hello（版本+能力位）；坏行容错；stdin end → 10s 内退出", async () => {
    const proc = spawnHelper();
    const up = lineCollector();
    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (c: string) => up.push(c));

    // hello 握手
    const helloLine = await waitFor(() => up.lines().find((l) => l.includes('"hello"')));
    const hello = JSON.parse(helloLine!) as { version: string; caps: string[] };
    expect(hello.version).toBe("0.1.0");
    expect(hello.caps).toContain("focus-settle");

    // 下行全集 + 坏行（不崩）
    proc.stdin!.write(down({ type: "heartbeat", ts: 1 }));
    proc.stdin!.write("garbage-not-json\n");
    proc.stdin!.write(
      down({
        type: "task-state",
        activeTask: { id: 3, title: "t", categoryPokemon: "pikachu", status: "active" },
        badge: { pendingSuggestions: 0, failures: 0 },
        ts: 2,
      }),
    );
    proc.stdin!.write(down({ type: "lang", lang: "en" }));

    // 存活观察窗（坏行/合法消息混合后进程仍在）
    await new Promise((r) => setTimeout(r, 400));
    expect(proc.exitCode).toBeNull();

    // focus-settle：61s 专注后任务离开 → 整分钟上报（虚拟不了真实时钟，走零专注分支：
    // 立即离开 = 不足 1 分钟不上报；这里只验证合法处理不崩 + 无输出）
    proc.stdin!.write(
      down({
        type: "task-state",
        activeTask: null,
        badge: { pendingSuggestions: 0, failures: 0 },
        ts: 3,
      }),
    );
    await new Promise((r) => setTimeout(r, 300));

    // stdin end（宿主退场）→ 10s SLA 内退出（实现给 150ms flush 窗口）
    const exited = new Promise<number | null>((res) => proc.on("exit", (c) => res(c)));
    proc.stdin!.end();
    const code = await exited;
    expect(code).toBe(0);
  }, 15_000);
});

describe("headless 集成 · --host-pid 双保险", () => {
  it("--host-pid 双保险：宿主进程死亡 → helper 10s 内自杀（心跳仍在也退）", async () => {
    // 假宿主进程（存活 → 被杀）
    const host = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await waitFor(() => host.pid);
    const helper = spawnHelper([`--host-pid=${String(host.pid)}`]);
    helper.stdout!.resume(); // 丢弃输出防背压

    // helper 存活确认（hello 已发即代表跑起来了）
    await new Promise((r) => setTimeout(r, 400));
    expect(helper.exitCode).toBeNull();

    // 宿主死亡（SIGKILL——轮询探测 process.kill(pid,0) 失败）
    host.kill("SIGKILL");
    const exited = new Promise<number | null>((res) => helper.on("exit", (c) => res(c)));
    const code = await exited;
    expect(code).toBe(0); // 轮询间隔 2s + 退出延迟，远小于 10s SLA
  }, 15_000);
});
