/**
 * remote/provision · 步② probe-node 版本门槛（dsh-ssh 0.2.1-rc.3 helper 依赖 node:sea——
 * Node 20.12 / 21.7 起；从 provision.spec 拆出——棘轮 max-lines）：纯函数版本矩阵 +
 * 向导步进上「node 在场但过旧」判死不进 installing。夹具 = provisionFx.ts。
 */
import { describe, expect, it } from "vitest";
import { listDeployments } from "../../src/host/remote/deployments";
import { provisionRun, remoteNodeSupported } from "../../src/host/remote/provision";
import { FakeSshScope } from "./fakeSshScope";
import { setupProvisionFx } from "./provisionFx";

const fx = setupProvisionFx();

/** 步进至 probing（步① 已完成）——步② 用例起点 */
async function seedAtProbing(scope: FakeSshScope): Promise<string> {
  const id = fx.seedDeployment("dev-box");
  await provisionRun(fx.db.conn, id, fx.makeDeps(scope));
  return id;
}

describe("remoteNodeSupported（远端 Node 版本门槛纯函数）", () => {
  it("20.12 / 21.7 / 22+ 放行（含无 v 前缀）", () => {
    expect(remoteNodeSupported("v20.12.0")).toBe(true);
    expect(remoteNodeSupported("v21.7.0")).toBe(true);
    expect(remoteNodeSupported("v22.0.0")).toBe(true);
    expect(remoteNodeSupported("24.21.0\n")).toBe(true);
  });

  it("20.11 / 21.6 / 18 / 空输出 / 非版本输出判死", () => {
    expect(remoteNodeSupported("v20.11.9")).toBe(false);
    expect(remoteNodeSupported("v21.6.2")).toBe(false);
    expect(remoteNodeSupported("v18.20.4")).toBe(false);
    expect(remoteNodeSupported("")).toBe(false);
    expect(remoteNodeSupported("node: command not found")).toBe(false);
  });
});

describe("步② probe-node：版本门槛", () => {
  it("node 在场但版本低于 20.12 → PROVISION_STEP_FAILED + 升级指引，不进 installing", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    scope.program(/ --version$/, { code: 0, stdout: "v20.11.1\n" });
    const result = await provisionRun(fx.db.conn, id, fx.makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "probe-node", tag: "PROVISION_STEP_FAILED" });
    expect(result.message).toContain("v20.11.1");
    expect(result.hint).toContain("20.12");
    expect(listDeployments(fx.db.conn)[id].status).toBe("not_ready");
  });

  it("版本输出不可解析（exit 0 但非 vX.Y.Z）→ 同样判死（无法证明可用）", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    scope.program(/ --version$/, { code: 0, stdout: "" });
    const result = await provisionRun(fx.db.conn, id, fx.makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "probe-node" });
    expect(result.message).toContain("无输出");
  });
});
