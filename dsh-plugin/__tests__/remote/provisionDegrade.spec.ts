/**
 * remote/provision · degradeConfirm（D31：显式确认留痕，两态前提；从 provision.spec
 * 拆出——棘轮 max-lines，等量迁移）：未确认拒绝 / 曾摘要不符确认 / 从未安装跳过 /
 * ready 与安装中前置错 / 向导重跑不触碰 degraded。夹具 = provisionFx.ts。
 */
import { describe, expect, it } from "vitest";
import { degradeConfirm, helperNeverInstalled } from "../../src/host/remote/provision";
import { DEPLOYMENTS_KEY, listDeployments, type DeploymentEntity } from "../../src/host/remote/deployments";
import { DEFAULT_HELPER_CONTENT, FakeSshScope } from "./fakeSshScope";
import { setupProvisionFx } from "./provisionFx";

const fx = setupProvisionFx();

/** 直接落一条 mismatch 历史（模拟向导/recheck 已产出摘要不符） */
function seedMismatched(alias = "dev-box"): string {
  const id = fx.seedDeployment(alias);
  const map = listDeployments(fx.db.conn);
  map[id] = {
    ...map[id],
    status: "not_ready",
    helperPath: "/home/dev/.dsh-helper/pky-0.1.0.js",
    provision: {
      steps: {
        "probe-ssh": { status: "ok", at: "t" },
        "probe-node": { status: "ok", at: "t" },
        upload: { status: "pending", at: "t" },
        verify: { status: "failed", tag: "HELPER_HASH_MISMATCH", message: "不符", at: "t" },
      },
      homeDir: "/home/dev",
    },
  };
  fx.db.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(map));
  return id;
}

/** 直接落一条安装中实体（upload ok / verify pending——未出摘要结论） */
function seedInstalling(alias = "dev-box-3"): string {
  const id = fx.seedDeployment(alias);
  const map = listDeployments(fx.db.conn);
  map[id] = {
    ...map[id],
    status: "installing",
    helperPath: "/home/dev/.dsh-helper/pky-0.1.0.js",
    provision: {
      steps: {
        "probe-ssh": { status: "ok", at: "t" },
        "probe-node": { status: "ok", at: "t" },
        upload: { status: "ok", at: "t" },
        verify: { status: "pending", at: "t" },
      },
      homeDir: "/home/dev",
    },
  } satisfies DeploymentEntity;
  fx.db.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(map));
  return id;
}

describe("degradeConfirm（D31：显式确认留痕，两态前提）", () => {
  it("未显式确认风险 → 拒绝", () => {
    const id = seedMismatched();
    expect(() => degradeConfirm(fx.db.conn, id, { acknowledgedRisk: false })).toThrowError(/显式确认/);
  });

  it("曾摘要不符 → 确认后 ready + degraded 留痕（诊断可查）", () => {
    const id = seedMismatched();
    const { deployment } = degradeConfirm(fx.db.conn, id, { acknowledgedRisk: true });
    expect(deployment.status).toBe("ready");
    expect(deployment.degraded).toBe(true);
    expect(deployment.lastError).toContain("降级");
    expect(listDeployments(fx.db.conn)[id].degraded).toBe(true);
  });

  it("helper 从未安装（草稿）→ 允许显式跳过降级", () => {
    const id = fx.seedDeployment("skip-box");
    expect(helperNeverInstalled(listDeployments(fx.db.conn)[id])).toBe(true);
    const { deployment } = degradeConfirm(fx.db.conn, id, { acknowledgedRisk: true });
    expect(deployment.degraded).toBe(true);
  });

  it("摘要校验通过的 ready 部署 / 安装未出结论 → 前置错（向导重跑不可绕行）", async () => {
    const scope = new FakeSshScope();
    const readyId = fx.seedDeployment("ok-box");
    await fx.runWizard(readyId, fx.makeDeps(scope));
    expect(() => degradeConfirm(fx.db.conn, readyId, { acknowledgedRisk: true })).toThrowError(/无需降级/);

    const installingId = seedInstalling();
    expect(() => degradeConfirm(fx.db.conn, installingId, { acknowledgedRisk: true })).toThrowError(/可降级状态/);
  });

  it("不存在 / 向导重跑不触碰 degraded（确认不可绕行）", async () => {
    expect(() => degradeConfirm(fx.db.conn, "ghost", { acknowledgedRisk: true })).toThrowError(/不存在/);
    const scope = new FakeSshScope();
    const id = seedMismatched("rerun-box");
    scope.files.set("/home/dev/.dsh-helper/pky-0.1.0.js", DEFAULT_HELPER_CONTENT);
    await fx.runWizard(id, fx.makeDeps(scope)); // 重跑向导转正
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("ready");
    expect(entity.degraded).toBe(false); // 向导路径永不置 degraded
  });
});
