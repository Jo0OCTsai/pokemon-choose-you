/**
 * 隧道让位锁（remote/tunnelLock）：目录锁原子抢/让位/死锁接管/跨部署不互斥
 * （与桌面 tunnel_lock.rs 同协议——ADR-0003 §2 的 TS 半边）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLockBase, holderPid, pidAlive, tryAcquireTunnelLock } from "../../src/host/remote/tunnelLock";

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
