/**
 * provision 系列共享受测装配（从 provision.spec.ts 拆出——棘轮 max-lines，等量
 * 迁移）：db 每用例重建 + 种子部署 + deps 组装 + 向导步进驱动；消费面 =
 * provision.spec.ts / provisionDegrade.spec.ts。
 */
import { afterEach, beforeEach } from "vitest";
import { provisionRun, type ProvisionDeps, type ProvisionRunResult } from "../../src/host/remote/provision";
import { deploymentUpsert, listDeployments } from "../../src/host/remote/deployments";
import { createTestDb, type TestDb } from "../helpers";
import { FakeSshScope, fakeProvisionDeps } from "./fakeSshScope";

/** 每用例重建的受测装配（db + 种子/驱动辅助闭包） */
export interface ProvisionFx {
  readonly db: TestDb;
  seedDeployment(alias?: string): string;
  makeDeps(scope: FakeSshScope | null, opts?: { pluginVersion?: string; helperContent?: string }): ProvisionDeps;
  runWizard(id: string, deps: ProvisionDeps, maxSteps?: number): Promise<ProvisionRunResult[]>;
}

/** 装配受测面（beforeEach 重建 / afterEach 收口）；调用方 spec 顶层调用一次 */
export function setupProvisionFx(): ProvisionFx {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });
  return {
    get db(): TestDb {
      return db;
    },
    seedDeployment: (alias = "dev-box") =>
      deploymentUpsert(db.conn, { alias, nodePath: "/usr/local/bin/node", workdir: "/srv/app" }).deployment.id,
    makeDeps: (scope, opts = {}) => fakeProvisionDeps(async () => scope, opts),
    /** 步进驱动到向导收敛（step === null）或步数上限 */
    runWizard: async (id, deps, maxSteps = 10) => {
      const results: ProvisionRunResult[] = [];
      for (let i = 0; i < maxSteps; i += 1) {
        const result = await provisionRun(db.conn, id, deps);
        results.push(result);
        if (result.step === null) {
          break;
        }
      }
      return results;
    },
  };
}

export { listDeployments };
