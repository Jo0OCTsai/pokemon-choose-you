/**
 * remote/recheck：就绪复核——连接活性 + helper sha256（权威源运行时计算）；活性失败 →
 * disconnected + lastError；摘要不符 → not_ready + D31 证据留痕（degradeConfirm 前提
 * 可达）；断开恢复 → recovered 信号（迟到回传核对挂接点）；未开通态不探测；
 * degraded 直连部署只复核活性。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recheckDeployment, type RecheckDeps } from "../../src/host/remote/recheck";
import { defaultHelperPath, degradeConfirm, provisionRun, type ProvisionDeps } from "../../src/host/remote/provision";
import {
  DEPLOYMENTS_KEY,
  deploymentUpsert,
  listDeployments,
  type DeploymentEntity,
} from "../../src/host/remote/deployments";
import { createTestDb, type TestDb } from "../helpers";
import { DEFAULT_HELPER_CONTENT, FakeSshScope, sha256Of } from "./fakeSshScope";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seedDeployment(alias = "dev-box"): string {
  return deploymentUpsert(db.conn, { alias, nodePath: "/usr/local/bin/node", workdir: "/srv/app" }).deployment.id;
}

/** 跑完向导到 ready（fake 远端自洽：npm 闭包安装落盘 → sha256sum 复核一致） */
async function seedReady(alias?: string): Promise<{ id: string; scope: FakeSshScope }> {
  const scope = new FakeSshScope();
  const id = seedDeployment(alias);
  const deps: ProvisionDeps = {
    scopeFor: async () => scope,
    readHelperArtifact: () => ({ version: "0.1.6-alpha.1", sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
    pluginVersion: "0.1.0",
  };
  for (let i = 0; i < 5; i += 1) {
    const result = await provisionRun(db.conn, id, deps);
    if (result.step === null) {
      break;
    }
  }
  return { id, scope };
}

function recheckDeps(scope: FakeSshScope | null): RecheckDeps {
  return {
    scopeFor: async () => scope,
    readHelperArtifact: () => ({ sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
  };
}

/** 直接把实体置为某状态（模拟断开历史等） */
function forceStatus(id: string, status: DeploymentEntity["status"]): void {
  const map = listDeployments(db.conn);
  map[id] = { ...map[id], status };
  db.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(map));
}

describe("就绪复核（ready 态）", () => {
  it("健康 → ready=true 维持就绪，无恢复信号、无状态改写", async () => {
    const { id, scope } = await seedReady();
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope));
    expect(outcome).toEqual({ ready: true, recovered: false });
    const entity = listDeployments(db.conn)[id];
    expect(entity.status).toBe("ready");
    expect(entity.lastError).toBeNull();
    // 活性 + 摘要两条命令
    expect(scope.commands).toContain("printf pky-ok");
    expect(scope.commands.some((c) => c.startsWith("sha256sum "))).toBe(true);
  });

  it("连接不可达（scope null）→ disconnected + lastError（派发前即时检查面）", async () => {
    const { id } = await seedReady();
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(null));
    expect(outcome).toMatchObject({ ready: false, recovered: false });
    expect(outcome.reason).toContain("连接不可用");
    const entity = listDeployments(db.conn)[id];
    expect(entity.status).toBe("disconnected");
    expect(entity.lastError).toContain("连接");
  });
});

describe("就绪复核（ready 态）：活性失败路径", () => {
  it("活性命令失败 → disconnected", async () => {
    const { id, scope } = await seedReady();
    scope.program(/^printf pky-ok$/, { code: 255, stderr: "broken pipe" });
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope));
    expect(outcome.ready).toBe(false);
    expect(listDeployments(db.conn)[id].status).toBe("disconnected");
  });

  it("摘要复核执行失败 → not_ready（连接活着但无法证明一致）", async () => {
    const { id, scope } = await seedReady();
    scope.program(/^sha256sum/, { code: 127, stderr: "command not found" });
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope));
    expect(outcome.ready).toBe(false);
    const entity = listDeployments(db.conn)[id];
    expect(entity.status).toBe("not_ready");
    expect(entity.lastError).toContain("远端组件验证失败");
  });

  it("摘要不符 → not_ready + provision 记 HELPER_HASH_MISMATCH（拒绝就绪不降级）", async () => {
    const { id, scope } = await seedReady();
    scope.files.set(defaultHelperPath("/home/dev", "0.1.0"), "tampered");
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope));
    expect(outcome.ready).toBe(false);
    expect(outcome.reason).toContain("验证未通过");
    const entity = listDeployments(db.conn)[id];
    expect(entity.status).toBe("not_ready");
    expect(entity.degraded).toBe(false);
    expect(entity.provision?.steps.verify.status).toBe("failed");
    expect(entity.provision?.steps.verify.tag).toBe("HELPER_HASH_MISMATCH");
    // D31 链路：复核产出的 mismatch 证据使显式降级确认可达
    const { deployment } = degradeConfirm(db.conn, id, { acknowledgedRisk: true });
    expect(deployment.degraded).toBe(true);
  });
});

describe("断开恢复（迟到回传核对触发信号）", () => {
  it("disconnected → 全过恢复 ready + recovered=true + 回调携带最新实体", async () => {
    const { id, scope } = await seedReady();
    forceStatus(id, "disconnected");
    const captured: { entity?: DeploymentEntity } = {};
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope), {
      onRecovered: (entity) => {
        captured.entity = entity;
      },
    });
    expect(outcome).toEqual({ ready: true, recovered: true });
    expect(captured.entity?.id).toBe(id);
    expect(captured.entity?.status).toBe("ready");
    expect(listDeployments(db.conn)[id].status).toBe("ready");
    expect(listDeployments(db.conn)[id].lastError).toBeNull();
  });

  it("断开未恢复（scope 仍死）→ 维持 disconnected，不触发回调", async () => {
    const { id } = await seedReady();
    forceStatus(id, "disconnected");
    let called = false;
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(null), {
      onRecovered: () => {
        called = true;
      },
    });
    expect(outcome).toMatchObject({ ready: false, recovered: false });
    expect(called).toBe(false);
    expect(listDeployments(db.conn)[id].status).toBe("disconnected");
  });
});

describe("未开通态与 degraded 直连", () => {
  it("not_ready / draft / installing → 不做远端探测，ready=false 说明原因", async () => {
    const id = seedDeployment(); // draft
    let scopeCalls = 0;
    const deps: RecheckDeps = {
      scopeFor: async () => {
        scopeCalls += 1;
        return new FakeSshScope();
      },
      readHelperArtifact: () => ({ sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
    };
    const draft = await recheckDeployment(db.conn, id, deps);
    expect(draft).toMatchObject({ ready: false, recovered: false });
    expect(draft.reason).toContain("开通向导");
    forceStatus(id, "not_ready");
    expect((await recheckDeployment(db.conn, id, deps)).ready).toBe(false);
    forceStatus(id, "installing");
    expect((await recheckDeployment(db.conn, id, deps)).ready).toBe(false);
    expect(scopeCalls).toBe(0); // 零远端调用
  });

  it("degraded 直连部署（helperHash 空）→ 只复核活性，不做摘要复核", async () => {
    const id = seedDeployment("direct-box");
    const map = listDeployments(db.conn);
    map[id] = { ...map[id], status: "ready", degraded: true, helperHash: null };
    db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    const scope = new FakeSshScope();
    const outcome = await recheckDeployment(db.conn, id, recheckDeps(scope));
    expect(outcome.ready).toBe(true);
    expect(scope.commands.some((c) => c.startsWith("sha256sum"))).toBe(false);
  });
});

describe("边界", () => {
  it("复核不存在的部署 → NOT_FOUND", async () => {
    await expect(recheckDeployment(db.conn, "ghost", recheckDeps(null))).rejects.toThrowError(/不存在/);
  });
});
