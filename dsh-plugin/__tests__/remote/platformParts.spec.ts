/**
 * parity 可选平台件条件展开（loopSection.optionalPlatformParts——ADR-0003 增量）：
 * 注入面逐键透传、缺席不注入。
 */
import { describe, expect, it } from "vitest";
import { optionalPlatformParts } from "../../src/host/loopSection";

describe("optionalPlatformParts", () => {
  it("全部注入 → 逐键透传", () => {
    const parts = optionalPlatformParts({
      helperPath: () => "/h",
      sshFamily: () => null,
      tunnels: { resync: () => undefined, statusOf: () => ({ state: "off", detail: "" }) },
      pkSetup: async () => ({ ok: true, version: null, steps: [] }),
    });
    expect(parts.helperPath?.()).toBe("/h");
    expect(parts.sshFamily?.()).toBeNull();
    expect(parts.tunnels?.statusOf("d1").state).toBe("off");
    expect(parts.pkSetup).toBeDefined();
  });

  it("全部缺席 → 空对象（不注入键）", () => {
    expect(optionalPlatformParts({})).toEqual({});
  });
});
