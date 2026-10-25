/**
 * dsh/sshScopeHost · helper 制品落后于闭包的路由（dsh-ssh 0.2.1-rc.3 升级配套——实体
 * helperHash 落于开通时的闭包，插件升级后远端仍是旧 helper：家族链 hello 即被拒、recheck
 * 走不到摘要比对；权威摘要注入在场且不符 → 先行直连，recheck 经直连命中 mismatch 重装链）。
 */
import { describe, expect, it } from "vitest";
import { entity, setupHost } from "./dsh-scope-host-harness";

describe("scopeFor 路由：helper 制品落后于闭包（插件升级后的旧 helper）→ 直连", () => {
  it("权威摘要在场且与实体 helperHash 不符 → 直连工厂、零家族装配（recheck 得以经直连做摘要比对）", async () => {
    const { host, directAliases, connectCalls } = setupHost({ helperHashAuthority: () => "b".repeat(64) });
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(directAliases).toEqual(["dev-box"]);
    expect(connectCalls).toHaveLength(0);
  });

  it("权威摘要与实体一致 → 家族装配不受影响", async () => {
    const { host, directAliases, connectCalls } = setupHost({ helperHashAuthority: () => "a".repeat(64) });
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(directAliases).toHaveLength(0);
    expect(connectCalls).toHaveLength(1);
  });

  it("未注入权威摘要（缺省）→ 不校验，落定即家族装配", async () => {
    const { host, connectCalls } = setupHost();
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "z".repeat(64) }));
    expect(connectCalls).toHaveLength(1);
  });
});
