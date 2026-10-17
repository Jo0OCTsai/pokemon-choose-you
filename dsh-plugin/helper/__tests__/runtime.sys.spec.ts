/**
 * sys 消息路由集成（full-parity 任务 2.4 收口）：真 headless helper（HELPER_HEADLESS=1）
 * ——sys/ 模块族已实装：七条 sys 下行全消费（零 sys-unsupported）、seq 两段语义
 * （dialog/mac-auth ack→result）、chat-reply 不上行、AX 初值可编程
 * （HELPER_HEADLESS_AX=1）。未知 type 仍走 bridge「丢弃 + 计错」不崩（NFR-14）。
 * history：sys 实装前本文件验证「未实装类型 → sys-unsupported 节流兜底」；实装后
 * sys-unsupported 只兜「能力位与实现错位」（headless 全量声明能力位 → 不再触发），
 * 该兜底面的进程内验证由 runtime.sysRouting.spec 的路由断言承载。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");

const procs: ReturnType<typeof spawn>[] = [];
afterAll(() => {
  for (const p of procs.splice(0)) if (!p.killed) p.kill();
});

function spawnHelper(ax: boolean): ReturnType<typeof spawn> {
  const proc = spawn(process.execPath, [MAIN], {
    env: { ...process.env, HELPER_HEADLESS: "1", ...(ax ? { HELPER_HEADLESS_AX: "1" } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  procs.push(proc);
  return proc;
}

function lineCollector() {
  const out: string[] = [];
  let buf = "";
  return {
    push(chunk: string): void {
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

async function waitFor(fn: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** 起子进程并接行收集器（stdout → 行缓冲） */
function spawnCollected(ax: boolean): { proc: ReturnType<typeof spawnHelper>; up: ReturnType<typeof lineCollector> } {
  const proc = spawnHelper(ax);
  const up = lineCollector();
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (c: string) => up.push(c));
  return { proc, up };
}

/** 等 hello 上行（子进程启动即发——bridge 起手） */
async function waitForHello(up: ReturnType<typeof lineCollector>): Promise<void> {
  await waitFor(() => up.lines().some((l) => l.includes('"hello"')));
}

describe("HELPER_HEADLESS sys 路由：hello 与七下行", () => {
  it("hello 携带 8 系统能力位；sys 七下行全消费——零 sys-unsupported", async () => {
    const { proc, up } = spawnCollected(false);
    await waitForHello(up);
    const hello = JSON.parse(up.lines().find((l) => l.includes('"hello"'))!);
    for (const cap of [
      "sys-tray",
      "sys-shortcut",
      "sys-notify",
      "sys-tts",
      "sys-dialog",
      "sys-open",
      "input-count",
      "mac-auth",
    ]) {
      expect(hello.caps).toContain(cap);
    }

    proc.stdin!.write('{"type":"sys-notify","kind":"reminder","title":"t","body":"b"}\n');
    proc.stdin!.write('{"type":"tts-speak","text":"hi"}\n');
    proc.stdin!.write('{"type":"open-path","path":"/tmp"}\n');
    proc.stdin!.write('{"type":"sys-config","tts":{"enabled":true}}\n');
    proc.stdin!.write('{"type":"tts-speak","text":"再说一次"}\n'); // enabled 后照常静默消费
    proc.stdin!.write('{"type":"heartbeat","ts":1}\n');
    await new Promise((r) => setTimeout(r, 300));

    expect(up.lines().filter((l) => l.includes('"sys-unsupported"'))).toHaveLength(0);
    expect(proc.exitCode).toBeNull(); // 不崩证据：进程仍在
    proc.stdin!.end();
  });
});

describe("HELPER_HEADLESS sys 路由：dialog 与 mac-auth 两段语义", () => {
  it("dialog-request → 秒级 ack + 完成级 result（headless 默认 canceled）", async () => {
    const { proc, up } = spawnCollected(false);
    await waitForHello(up);
    proc.stdin!.write(
      '{"type":"dialog-request","mode":"open-file","seq":11,"filters":[{"name":"db","extensions":["db"]}]}\n',
    );
    await waitFor(() => up.lines().some((l) => l.includes('"dialog-result"')));
    const ack = JSON.parse(up.lines().find((l) => l.includes('"dialog-ack"'))!);
    const result = JSON.parse(up.lines().find((l) => l.includes('"dialog-result"'))!);
    expect(ack).toEqual({ type: "dialog-ack", seq: 11 });
    expect(result).toEqual({ type: "dialog-result", seq: 11, canceled: true });
    proc.stdin!.end();
  });

  it("mac-auth-query → ack + result（AX 初值随 HELPER_HEADLESS_AX）", async () => {
    const { proc, up } = spawnCollected(true);
    await waitForHello(up);
    proc.stdin!.write('{"type":"mac-auth-query","kind":"accessibility","seq":2}\n');
    await waitFor(() => up.lines().some((l) => l.includes('"mac-auth-result"')));
    const result = JSON.parse(up.lines().find((l) => l.includes('"mac-auth-result"'))!);
    expect(result).toEqual({ type: "mac-auth-result", seq: 2, kind: "accessibility", granted: true });
    proc.stdin!.end();
  });

  it("chat-reply 下行消费不上行；未知 type 丢弃计错不崩", async () => {
    const { proc, up } = spawnCollected(false);
    await waitForHello(up);
    proc.stdin!.write('{"type":"chat-reply","text":"答","ok":true}\n');
    proc.stdin!.write('{"type":"sys-future-feature","x":1}\n'); // 未来类型：bridge 丢弃 + 计错
    proc.stdin!.write('{"type":"heartbeat","ts":2}\n');
    await new Promise((r) => setTimeout(r, 300));

    const replies = up.lines().filter((l) => l.includes('"chat-reply"'));
    const unsupported = up.lines().filter((l) => l.includes('"sys-unsupported"'));
    expect(replies).toHaveLength(0); // chat-reply 是下行——helper 不回发
    expect(unsupported).toHaveLength(0); // 未知 type 走丢弃计错（不发 unsupported——非已知类型失配）
    expect(proc.exitCode).toBeNull();
    proc.stdin!.end();
  });
});
