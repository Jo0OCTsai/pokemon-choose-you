/**
 * remote/deployments：部署实体 CRUD（dsh:deployments settings 键）——字段白名单
 * （NFR-11③ 凭据零存储机检面）、alias 唯一索引、路径不变式（拒 `~`/相对路径）、
 * 改名被 agent 绑定引用的确认级联（A25）、实质编辑回落 not_ready、移除清理尽力
 * 不阻塞、部署绑定失配查询（悬空引用明示面）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEPLOYMENTS_KEY,
  DEPLOYMENT_FIELD_WHITELIST,
  cleanupCommand,
  danglingDeploymentRefs,
  deploymentByAlias,
  deploymentById,
  deploymentDelete,
  deploymentUpsert,
  listDeployments,
  type DeploymentStatus,
} from "../../src/host/remote/deployments";
import { getSetting } from "../../src/host/domain/settings";
import { createTestDb, seedAgents, type TestDb } from "../helpers";
import { FakeSshScope } from "./fakeSshScope";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seed(input: { alias?: string; nodePath?: string; workdir?: string; note?: string }): string {
  const { deployment } = deploymentUpsert(db.conn, {
    alias: input.alias ?? "dev-box",
    nodePath: input.nodePath ?? "/usr/local/bin/node",
    workdir: input.workdir ?? "/srv/app",
    note: input.note,
  });
  return deployment.id;
}

/** 直接写一条带开通痕迹的实体（模拟已完成向导的历史状态） */
function seedProvisionedEntity(alias = "dev-box", status: DeploymentStatus = "ready"): string {
  const id = seed({ alias });
  const map = listDeployments(db.conn);
  map[id] = {
    ...map[id],
    helperPath: "/home/dev/.dsh-helper/pky-helper-0.1.0.js",
    helperHash: "a".repeat(64),
    status,
    provision: {
      steps: {
        "probe-ssh": { status: "ok", at: "t" },
        "probe-node": { status: "ok", at: "t" },
        upload: { status: "ok", at: "t" },
        verify: { status: "ok", at: "t" },
      },
      homeDir: "/home/dev",
    },
  };
  db.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(map));
  return id;
}

describe("部署 CRUD（dsh:deployments 整读-改-整写）", () => {
  it("新建：生成 id、缺省 draft、诊断字段归零；整读/按 id/按 alias 可查", () => {
    expect(Object.keys(listDeployments(db.conn))).toHaveLength(0);
    const id = seed({ note: " 主力机 " });
    const all = listDeployments(db.conn);
    expect(Object.keys(all)).toEqual([id]);
    expect(all[id]).toMatchObject({
      id,
      alias: "dev-box",
      nodePath: "/usr/local/bin/node",
      workdir: "/srv/app",
      note: "主力机",
      helperPath: "",
      helperHash: null,
      status: "draft",
      lastError: null,
      provision: null,
      degraded: false,
    });
    expect(deploymentById(db.conn, id)?.alias).toBe("dev-box");
    expect(deploymentById(db.conn, "ghost")).toBeNull();
    expect(deploymentByAlias(db.conn, "dev-box")?.id).toBe(id);
    expect(deploymentByAlias(db.conn, "ghost")).toBeNull();
  });

  it("字段白名单（NFR-11③ 凭据零存储）：实体 JSON 键集 = ER §5.1 全集，无凭据类字段", () => {
    const id = seed({});
    const raw = JSON.parse(getSetting(db.conn, DEPLOYMENTS_KEY) ?? "{}") as Record<string, Record<string, unknown>>;
    expect(Object.keys(raw[id]).sort()).toEqual([...DEPLOYMENT_FIELD_WHITELIST].sort());
    // 白名单不含任何私钥/密码/密钥内容字段（gitleaks + 字段审查的机检面）
    for (const forbidden of ["password", "privateKey", "key", "secret", "token"]) {
      expect(Object.keys(raw[id])).not.toContain(forbidden);
    }
  });

  it("坏 JSON 按空表处理（同 listRoutes 口径）", () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(DEPLOYMENTS_KEY, "not-json{");
    expect(listDeployments(db.conn)).toEqual({});
  });
});

describe("部署校验（参数错口径）", () => {
  it("空别名 / 别名重复拒绝（alias 唯一索引）", () => {
    seed({ alias: "dev-box" });
    expect(() => deploymentUpsert(db.conn, { alias: "  ", nodePath: "/n", workdir: "" })).toThrowError(/别名不能为空/);
    expect(() => seed({ alias: "dev-box" })).toThrowError(/已被另一个部署占用/);
    // 自己改名到同名（同 id 编辑）不视为重复
    const id = deploymentByAlias(db.conn, "dev-box")!.id;
    expect(() =>
      deploymentUpsert(db.conn, { id, alias: "dev-box", nodePath: "/usr/bin/node", workdir: "" }),
    ).not.toThrow();
  });

  it("路径不变式：nodePath 必填且拒 `~` 前缀/相对路径；workdir 可空（登录目录缺省）", () => {
    expect(() => seed({ nodePath: "" })).toThrowError(/Node 路径不能为空/);
    expect(() => seed({ nodePath: "~/bin/node" })).toThrowError(/~/);
    expect(() => seed({ nodePath: "bin/node" })).toThrowError(/绝对路径/);
    expect(() => seed({ workdir: "~/app" })).toThrowError(/~/);
    expect(() => seed({ workdir: "app" })).toThrowError(/绝对路径/);
    const id = seed({ workdir: "" });
    expect(listDeployments(db.conn)[id].workdir).toBe("");
  });
});

describe("改名被 agent 绑定引用（A25 确认/级联）", () => {
  it("未携带 confirmAliasRefs → 拒绝并列出受影响 agent", () => {
    const id = seed({ alias: "dev-box" });
    seedAgents(db.conn, [
      { id: "ag-1", deployment: "dev-box" },
      { id: "ag-2", deployment: "dev-box" },
    ]);
    const err = (() => {
      try {
        deploymentUpsert(db.conn, { id, alias: "dev-box-2", nodePath: "/n", workdir: "" });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.message).toContain("confirmAliasRefs");
    expect(err?.message).toContain("ag-1");
    expect(err?.message).toContain("ag-2");
    expect(listDeployments(db.conn)[id].alias).toBe("dev-box"); // 未改
  });

  it("携带 confirmAliasRefs:true → 级联更新 agent 绑定（与部署键同事务）", () => {
    const id = seed({ alias: "dev-box" });
    seedAgents(db.conn, [{ id: "ag-1", deployment: "dev-box" }]);
    deploymentUpsert(db.conn, { id, alias: "dev-box-2", nodePath: "/n", workdir: "", confirmAliasRefs: true });
    expect(listDeployments(db.conn)[id].alias).toBe("dev-box-2");
    const agents = JSON.parse(getSetting(db.conn, "ai_agents") ?? "[]") as Array<{
      id: string;
      deployment: string | null;
    }>;
    expect(agents.find((a) => a.id === "ag-1")?.deployment).toBe("dev-box-2");
  });

  it("改名未被绑定 → 直接放行（无需确认）", () => {
    const id = seed({ alias: "dev-box" });
    expect(() => deploymentUpsert(db.conn, { id, alias: "dev-box-2", nodePath: "/n", workdir: "" })).not.toThrow();
  });
});

describe("编辑语义（轻漂移①：编辑后回落未就绪）", () => {
  it("实质字段变更（alias/nodePath/workdir）→ not_ready + 开通产物清空", () => {
    const id = seedProvisionedEntity("dev-box", "ready");
    deploymentUpsert(db.conn, { id, alias: "dev-box", nodePath: "/usr/bin/node", workdir: "/srv/app" });
    const after = listDeployments(db.conn)[id];
    expect(after.status).toBe("not_ready");
    expect(after.helperPath).toBe("");
    expect(after.helperHash).toBeNull();
    expect(after.provision).toBeNull();
    expect(after.degraded).toBe(false);
    expect(after.lastError).toContain("重跑开通向导");
  });

  it("仅改 note → 状态与开通产物不动", () => {
    const id = seedProvisionedEntity("dev-box", "ready");
    deploymentUpsert(db.conn, { id, alias: "dev-box", note: "新备注" });
    const after = listDeployments(db.conn)[id];
    expect(after.status).toBe("ready");
    expect(after.helperHash).not.toBeNull();
    expect(after.provision).not.toBeNull();
    expect(after.note).toBe("新备注");
  });

  it("编辑不存在的 id → NOT_FOUND", () => {
    expect(() => deploymentUpsert(db.conn, { id: "ghost", alias: "a", nodePath: "/n", workdir: "" })).toThrowError(
      /不存在/,
    );
  });
});

describe("移除（清理尽力执行，失败不阻塞）", () => {
  it("从未安装 helper → 无远端清理项，记录删除、关连接回调执行", async () => {
    const id = seed({});
    let disconnected = false;
    const result = await deploymentDelete(db.conn, id, {
      disconnect: () => {
        disconnected = true;
      },
    });
    expect(result.cleanup.attempted).toBe(false);
    expect(disconnected).toBe(true);
    expect(listDeployments(db.conn)[id]).toBeUndefined();
  });

  it("已安装 → 经 SshScope 执行托管目录自清理（rm -rf 引号引用），远端文件移除", async () => {
    const id = seedProvisionedEntity();
    const scope = new FakeSshScope();
    scope.files.set("/home/dev/.dsh-helper/pky-helper-0.1.0.js", "artifact");
    const result = await deploymentDelete(db.conn, id, {
      disconnect: () => scope.disconnect(),
      scopeFor: async () => scope,
    });
    expect(result.cleanup).toEqual({ attempted: true, ok: true });
    expect(scope.commands).toContain(cleanupCommand("/home/dev/.dsh-helper/pky-helper-0.1.0.js"));
    expect(scope.files.size).toBe(0);
    expect(scope.disconnectCalls).toBe(1);
    expect(listDeployments(db.conn)[id]).toBeUndefined();
  });
});

describe("移除（清理失败与跳过路径——失败不阻塞删除）", () => {
  it("远端清理失败（非零退出）→ 不阻塞删除，结果只留诊断", async () => {
    const id = seedProvisionedEntity();
    const scope = new FakeSshScope();
    scope.program(/^rm -rf/, { code: 1, stderr: "permission denied" });
    const result = await deploymentDelete(db.conn, id, { scopeFor: async () => scope });
    expect(result.cleanup.attempted).toBe(true);
    expect(result.cleanup.ok).toBe(false);
    expect(result.cleanup.detail).toContain("permission denied");
    expect(listDeployments(db.conn)[id]).toBeUndefined();
  });

  it("连接不可用（scope null / 未连接）→ 跳过自清理，删除照常", async () => {
    const id = seedProvisionedEntity();
    const dead = new FakeSshScope();
    dead.simulateDisconnect();
    const a = await deploymentDelete(db.conn, id, { scopeFor: async () => dead });
    expect(a.cleanup.attempted).toBe(false);
    expect(a.cleanup.detail).toContain("连接不可用");
    const id2 = seedProvisionedEntity("dev-box-2");
    const b = await deploymentDelete(db.conn, id2, { scopeFor: async () => null });
    expect(b.cleanup.attempted).toBe(false);
    expect(listDeployments(db.conn)).toEqual({});
  });

  it("scopeFor 抛错 → 容器化进 detail，删除照常", async () => {
    const id = seedProvisionedEntity();
    const result = await deploymentDelete(db.conn, id, {
      scopeFor: async () => {
        throw new Error("isolate boom");
      },
    });
    expect(result.cleanup.attempted).toBe(true);
    expect(result.cleanup.ok).toBe(false);
    expect(result.cleanup.detail).toContain("isolate boom");
    expect(listDeployments(db.conn)[id]).toBeUndefined();
  });

  it("移除不存在的部署 → NOT_FOUND", async () => {
    await expect(deploymentDelete(db.conn, "ghost")).rejects.toThrowError(/不存在/);
  });
});

describe("部署绑定失配明示（agent 绑定指向缺失部署 → 悬空清单数据面）", () => {
  it("列出 deployment 解析不到实体的 agent 绑定；正常绑定与未绑定不列", async () => {
    seed({ alias: "dev-box" });
    seedAgents(db.conn, [
      { id: "ag-1", deployment: "dev-box" },
      { id: "ag-2", deployment: "gone-box" },
      { id: "ag-3" },
    ]);
    expect(danglingDeploymentRefs(db.conn)).toEqual([{ agentId: "ag-2", agentName: "ag-2", ref: "gone-box" }]);
    // 部署删除后（delete 不级联）→ 悬空绑定由本面承接
    const id = deploymentByAlias(db.conn, "dev-box")!.id;
    await deploymentDelete(db.conn, id);
    expect(
      danglingDeploymentRefs(db.conn)
        .map((r) => r.agentId)
        .sort(),
    ).toEqual(["ag-1", "ag-2"]);
  });
});
