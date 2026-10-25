/**
 * dsh/probeDsh：capability 探测实装（AD §4.8）——键集与 CAPABILITY_KEYS 单源锁一致
 * （dsh 子集双向断言）、fake ctx 表面全枚举（在场/缺席/自持三分支）、dsh-ssh 家族
 * 本机闭包真实动态 import（钉版 0.2.1-rc.3 在场即 ok）、sshFamily 投影不另立探测路径。
 */
import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS } from "../src/host/index";
import { DSH_CAPABILITY_KEYS, probeDshCapabilities, sshFamilyOf, type DshHostSurface } from "../src/host/dsh/probeDsh";

/** 全表面在场的 fake 宿主 ctx */
function fullSurface(): DshHostSurface {
  return {
    isolate: () => undefined,
    plugin: () => ({ dispose: () => Promise.resolve() }),
    interval: () => () => undefined,
    timer: {},
    subprocess: { spawnTerminal: () => Promise.resolve({}) },
    terminals: {},
    sessions: {},
    worktrees: {},
    storage: {},
    slots: {},
  };
}

describe("键集单源（CAPABILITY_KEYS 的 dsh 子集）", () => {
  it("DSH_CAPABILITY_KEYS ⊆ CAPABILITY_KEYS 且无重复", () => {
    for (const key of DSH_CAPABILITY_KEYS) {
      expect(CAPABILITY_KEYS).toContain(key);
    }
    expect(new Set(DSH_CAPABILITY_KEYS).size).toBe(DSH_CAPABILITY_KEYS.length);
  });

  it("CAPABILITY_KEYS 的 dsh 前缀键全部被探测覆盖（合流后 capabilities 段无缺口）", () => {
    const dshKeys = CAPABILITY_KEYS.filter((k) => k === "dsh" || k.startsWith("dsh-"));
    expect([...DSH_CAPABILITY_KEYS].sort()).toEqual([...dshKeys].sort());
  });
});

describe("ctx 表面探测（fake 全枚举）", () => {
  it("全表面在场 → 八键全 ok", async () => {
    const probes = await probeDshCapabilities(fullSurface());
    for (const key of DSH_CAPABILITY_KEYS) {
      expect(probes[key].ok, key).toBe(true);
    }
    expect(probes.dsh.detail).toContain("isolate");
    expect(probes["dsh-terminal"].detail).toContain("spawnTerminal");
    expect(probes["dsh-session"].detail).toContain("sessions");
    expect(probes["dsh-storage"].detail).toContain("storage");
    expect(probes["dsh-slots"].detail).toContain("slots");
  });

  it("空 ctx（非宿主环境）→ 平台键缺失如实呈现；storage/slots 按自持口径标 ok", async () => {
    const probes = await probeDshCapabilities(undefined);
    expect(probes.dsh.ok).toBe(false);
    expect(probes["dsh-terminal"].ok).toBe(false);
    expect(probes["dsh-terminal"].detail).toContain("复制命令行");
    expect(probes["dsh-session"].ok).toBe(false);
    expect(probes["dsh-worktrees"].ok).toBe(false);
    expect(probes["dsh-timer"].ok).toBe(false);
    // 前序自持：宿主无服务不构成缺失（插件不依赖该两面）
    expect(probes["dsh-storage"].ok).toBe(true);
    expect(probes["dsh-storage"].detail).toContain("自持");
    expect(probes["dsh-slots"].ok).toBe(true);
    expect(probes["dsh-slots"].detail).toContain("自持");
  });

  it("timer 双形态（ctx.interval 函数 / ctx.timer 对象）任一在场即 ok", async () => {
    expect((await probeDshCapabilities({ interval: () => () => undefined }))["dsh-timer"].ok).toBe(true);
    expect((await probeDshCapabilities({ timer: {} }))["dsh-timer"].ok).toBe(true);
  });

  it("终端表面：spawnTerminal 缺席但 terminals 在场 → ok（面板服务可用）", async () => {
    const probes = await probeDshCapabilities({ subprocess: {}, terminals: {} });
    expect(probes["dsh-terminal"].ok).toBe(true);
    expect(probes["dsh-terminal"].detail).toContain("terminals");
  });
});

describe("dsh-ssh 家族探测（本机闭包真实动态 import）", () => {
  it("依赖钉版在场 → ok + 版本 detail（0.2.1-rc.3）", async () => {
    const probes = await probeDshCapabilities(undefined);
    expect(probes["dsh-ssh"].ok).toBe(true);
    expect(probes["dsh-ssh"].detail).toContain("0.2.1-rc.3");
  });

  it("sshFamily 投影 = capabilities.dsh-ssh 的呈现投影（missing 随 ok 取反）", async () => {
    const probes = await probeDshCapabilities(undefined);
    const projection = sshFamilyOf(probes);
    expect(projection).toEqual({
      ok: probes["dsh-ssh"].ok,
      detail: probes["dsh-ssh"].detail,
      missing: !probes["dsh-ssh"].ok,
    });
  });
});
