/**
 * 隧道让位锁（remote/tunnelLock）：目录锁原子抢/让位/死锁接管/跨部署不互斥/
 * ssh-pid 记账与孤儿清理/自残留回收（与桌面 tunnel_lock.rs 同协议——ADR-0003 §2 的 TS 半边）。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultLockBase,
  holderPid,
  killOrphanSsh,
  pidAlive,
  reclaimSelfResidue,
  tryAcquireTunnelLock,
} from "../../src/host/remote/tunnelLock";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pky-tlock-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("tryAcquireTunnelLock", () => {
  it("首个获取成功并写 pid；存活持有者使后来者让位（null）；释放后可再获取", () => {
    const a = tryAcquireTunnelLock(base, "d1");
    expect(a).not.toBeNull();
    expect(readFileSync(join(base, "tunnels", "d1", "pid"), "utf8").trim()).toBe(String(process.pid));
    // 自己存活 → 第二次让位
    expect(tryAcquireTunnelLock(base, "d1")).toBeNull();
    a!.release();
    const b = tryAcquireTunnelLock(base, "d1");
    expect(b).not.toBeNull();
    b!.release();
  });

  it("死锁（持有者 PID 已死）被清理接管；无 pid 文件的半锁同样可接管", () => {
    const dir = join(base, "tunnels", "d2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), "2147480000");
    expect(tryAcquireTunnelLock(base, "d2")).not.toBeNull();

    const half = join(base, "tunnels", "d3");
    mkdirSync(half, { recursive: true });
    expect(tryAcquireTunnelLock(base, "d3")).not.toBeNull();
  });

  it("不同部署不互斥", () => {
    const a = tryAcquireTunnelLock(base, "d1");
    const b = tryAcquireTunnelLock(base, "d2");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("release 幂等（重复调用无副作用）", () => {
    const a = tryAcquireTunnelLock(base, "d1")!;
    a.release();
    a.release();
    expect(tryAcquireTunnelLock(base, "d1")).not.toBeNull();
  });
});

describe("holderPid / pidAlive", () => {
  it("holderPid：合法 pid 读取、坏内容/缺文件归 null", () => {
    const dir = join(base, "tunnels", "dx");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), " 42 \n");
    expect(holderPid(base, "dx")).toBe(42);
    writeFileSync(join(dir, "pid"), "not-a-pid");
    expect(holderPid(base, "dx")).toBeNull();
    expect(holderPid(base, "missing")).toBeNull();
  });

  it("pidAlive：自己恒活；不存在的 PID 判死", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2147480000)).toBe(false);
  });
});

describe("defaultLockBase", () => {
  it("CHOOSE_YOU_HOME 覆盖优先（与库定位同规则）", () => {
    process.env.CHOOSE_YOU_HOME = base;
    try {
      expect(defaultLockBase()).toBe(base);
    } finally {
      delete process.env.CHOOSE_YOU_HOME;
    }
  });
});

describe("ssh-pid 记账", () => {
  it("recordSshPid 落 ssh-pid 文件；release 随目录一并清", () => {
    const a = tryAcquireTunnelLock(base, "d1")!;
    a.recordSshPid(424242);
    expect(readFileSync(join(base, "tunnels", "d1", "ssh-pid"), "utf8").trim()).toBe("424242");
    a.release();
    expect(existsSync(join(base, "tunnels", "d1"))).toBe(false);
  });

  it("killOrphanSsh：ssh-pid 缺失/已死进程直接跳过（不误伤）", () => {
    const dir = join(base, "tunnels", "d13");
    mkdirSync(dir, { recursive: true });
    expect(() => killOrphanSsh(dir)).not.toThrow(); // 无 ssh-pid 文件
    writeFileSync(join(dir, "ssh-pid"), "2147480000"); // 必死 pid
    expect(() => killOrphanSsh(dir)).not.toThrow();
  });
});

describe("孤儿 ssh 清理（死锁接管）", () => {
  it("命令行含 ssh 与 -R 的孤儿被 SIGTERM", async () => {
    // 假孤儿：脚本名含 ssh、参数带 -R（对齐 ps 命令行核对口径），长眠等杀
    const script = join(base, "fake-ssh-orphan.sh");
    writeFileSync(script, "#!/bin/sh\nsleep 30\n");
    chmodSync(script, 0o755);
    const orphan = spawn(script, ["-R", "127.0.0.1:10022:127.0.0.1:22"]);
    const dir = join(base, "tunnels", "d9");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), "2147480000");
    writeFileSync(join(dir, "ssh-pid"), String(orphan.pid));
    await new Promise((r) => setTimeout(r, 150)); // 等 ps 命令行可见
    const lock = tryAcquireTunnelLock(base, "d9");
    expect(lock).not.toBeNull();
    const deadline = Date.now() + 5000;
    while (pidAlive(orphan.pid!) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(pidAlive(orphan.pid!)).toBe(false);
    lock!.release();
  }, 10000);

  it("PID 复用防线：ssh-pid 指向不像隧道的存活进程 → 只接管锁不杀", async () => {
    const innocent = spawn("sleep", ["30"]);
    const dir = join(base, "tunnels", "d10");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), "2147480000");
    writeFileSync(join(dir, "ssh-pid"), String(innocent.pid));
    await new Promise((r) => setTimeout(r, 150));
    const lock = tryAcquireTunnelLock(base, "d10");
    expect(lock).not.toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(pidAlive(innocent.pid!)).toBe(true);
    innocent.kill("SIGTERM");
    lock!.release();
  }, 10000);
});

describe("reclaimSelfResidue", () => {
  it("pid 文件 = 本进程的自残留（旧版泄漏）→ 清目录重抢到手", () => {
    const dir = join(base, "tunnels", "d11");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), String(process.pid));
    const lock = reclaimSelfResidue(base, "d11");
    expect(lock).not.toBeNull();
    lock!.release();
  });

  it("持有方是其他存活进程 → 不动（null）", () => {
    const other = spawn("sleep", ["30"]);
    const dir = join(base, "tunnels", "d12");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), String(other.pid));
    expect(reclaimSelfResidue(base, "d12")).toBeNull();
    other.kill("SIGTERM");
  });
});
