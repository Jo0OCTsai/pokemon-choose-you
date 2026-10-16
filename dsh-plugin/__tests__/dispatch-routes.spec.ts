/**
 * dispatch/routes：项目路由 CRUD（dsh:dispatch_routes）与解析优先级
 * （override > route > meta > default）、routeOverride 不回写、deployment 引用、
 * hostKey 归一、并发/worktree 配置层级——对齐 Rust route.rs resolve_route 行为。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISPATCH_ROUTES_KEY,
  listRoutes,
  resolveDispatchRoute,
  routeDelete,
  routeUpsert,
} from "../src/host/dispatch/routes";
import { getSetting } from "../src/host/domain/settings";
import { createTestDb, seedAgents, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 建项目标签（dimension_id=1 = project 种子）并挂到任务上 */
function seedProjectTag(taskId: number, tagName: string, meta: string | null = null): void {
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(tagName, meta) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
}

describe("路由 CRUD（dsh:dispatch_routes）", () => {
  it("upsert/list/delete：以项目标签名为键整读-改-整写", () => {
    expect(Object.keys(listRoutes(db.conn))).toHaveLength(0);
    const routes = routeUpsert(db.conn, "PokemonApp", { agentId: "ag-1", workdir: "~/app", context: "Tauri" });
    expect(routes["PokemonApp"]).toEqual({ agentId: "ag-1", workdir: "~/app", context: "Tauri" });
    expect(JSON.parse(getSetting(db.conn, DISPATCH_ROUTES_KEY) ?? "{}")).toHaveProperty("PokemonApp");
    // upsert 覆盖同键
    routeUpsert(db.conn, "PokemonApp", { agentId: "ag-2" });
    expect(listRoutes(db.conn)["PokemonApp"]?.agentId).toBe("ag-2");
    // 删除
    expect(routeDelete(db.conn, "PokemonApp")).toBe(true);
    expect(routeDelete(db.conn, "PokemonApp")).toBe(false);
    expect(listRoutes(db.conn)).toEqual({});
  });

  it("校验：空 tag / deployment 缺字段 / maxConcurrent 非法 → 参数错；空 agentId 合法（回落全局默认）", () => {
    expect(() => routeUpsert(db.conn, "  ", { agentId: "a" })).toThrowError(/标签名/);
    expect(() => routeUpsert(db.conn, "T", { agentId: "a", deployment: { ref: "", target: "u@h" } })).toThrowError(
      /deployment/,
    );
    expect(() => routeUpsert(db.conn, "T", { agentId: "a", maxConcurrent: 0 })).toThrowError(/maxConcurrent/);
    // 空 agentId = 只配目录/上下文，解析时回落 meta / 全局默认（桌面 tags.meta 双轨语义）
    routeUpsert(db.conn, "T", { agentId: "", workdir: "~/only-dir" });
    expect(listRoutes(db.conn)["T"]).toEqual({ agentId: "", workdir: "~/only-dir" });
  });

  it("deployment 引用只存 ref + target（不存连接细节——A13）", () => {
    routeUpsert(db.conn, "Remote", { agentId: "a", deployment: { ref: "dev-box", target: "vscode@localhost:1022" } });
    expect(listRoutes(db.conn)["Remote"]?.deployment).toEqual({ ref: "dev-box", target: "vscode@localhost:1022" });
  });
});

describe("路由解析（resolve_dispatch_route 同构）", () => {
  it("优先级 pick > route > meta > default；routeOverride 不回写", () => {
    seedAgents(db.conn, [
      { id: "ag-1", command: "claude" },
      { id: "ag-2", command: "claude" },
    ]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(
      taskId,
      "PokemonApp",
      JSON.stringify({ agentId: "ag-2", workdir: "~/meta-dir", context: "meta ctx" }),
    );
    // meta 层（主应用 tags.meta 双轨对齐）
    const meta = resolveDispatchRoute(db.conn, taskId);
    expect(meta.source).toBe("meta");
    expect(meta.agent.id).toBe("ag-2");
    expect(meta.workdir).toBe("~/meta-dir");
    expect(meta.context).toBe("meta ctx");
    expect(meta.hostKey).toBe("local");
    expect(meta.maxConcurrent).toBe(1);
    // dsh 路由表层覆盖 meta（agentId/workdir/context）
    routeUpsert(db.conn, "PokemonApp", {
      agentId: "ag-1",
      workdir: "~/route-dir",
      context: "route ctx",
      maxConcurrent: 3,
    });
    const route = resolveDispatchRoute(db.conn, taskId);
    expect(route.source).toBe("route");
    expect(route.agent.id).toBe("ag-1");
    expect(route.workdir).toBe("~/route-dir");
    expect(route.context).toBe("route ctx");
    expect(route.maxConcurrent).toBe(3);
  });
});

describe("路由解析改选与回落", () => {
  it("改选（pick）临时生效不回写；路由表删除回落 meta；ghost 改选回落路由层", () => {
    seedAgents(db.conn, [
      { id: "ag-1", command: "claude" },
      { id: "ag-2", command: "claude" },
    ]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(taskId, "PokemonApp", JSON.stringify({ agentId: "ag-2" }));
    routeUpsert(db.conn, "PokemonApp", { agentId: "ag-1", workdir: "~/route-dir" });
    const pick = resolveDispatchRoute(db.conn, taskId, "ag-2");
    expect(pick.source).toBe("pick");
    expect(pick.agent.id).toBe("ag-2");
    expect(pick.workdir).toBe("~/route-dir"); // workdir 仍取路由表（改选只换 agent）
    expect(listRoutes(db.conn)["PokemonApp"]?.agentId).toBe("ag-1");
    expect(resolveDispatchRoute(db.conn, taskId, "ghost").source).toBe("route");
    expect(routeDelete(db.conn, "PokemonApp")).toBe(true);
    expect(resolveDispatchRoute(db.conn, taskId).source).toBe("meta");
  });
});

describe("路由解析默认层与回写语义", () => {
  it("无路由无 meta → 全局默认（ai_agent_id 指向 > 首个启用）；停用项不选", () => {
    seedAgents(db.conn, [
      { id: "ag-1", command: "claude", enabled: false },
      { id: "ag-2", command: "claude" },
    ]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(taskId, "Plain");
    const resolved = resolveDispatchRoute(db.conn, taskId);
    expect(resolved.source).toBe("default");
    expect(resolved.agent.id).toBe("ag-2");
    // ai_agent_id 指向启用项时优先
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agent_id', 'ag-2')").run();
    expect(resolveDispatchRoute(db.conn, taskId).agent.id).toBe("ag-2");
  });
});

describe("路由解析边界（缺标签 / deployment / worktree 层级）", () => {
  it("无 project 标签 / 无可用 agent → 参数错（文案对齐主应用）", () => {
    const bare = seedTask(db.conn, "裸任务");
    expect(() => resolveDispatchRoute(db.conn, bare)).toThrowError(/项目/);
    seedAgents(db.conn, [{ id: "ag-1", command: "claude" }]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(taskId, "PokemonApp", null);
    // 有 agent：不报错（default 层接住）
    expect(resolveDispatchRoute(db.conn, taskId).agent.id).toBe("ag-1");
    db.conn.prepare("DELETE FROM settings WHERE key='ai_agents'").run();
    expect(() => resolveDispatchRoute(db.conn, taskId)).toThrowError(/没有可用的 Agent/);
  });

  it("deployment 路由 → hostKey 归一 ssh:user@host[:port]（domain 口径复用）", () => {
    seedAgents(db.conn, [{ id: "ag-1", command: "claude" }]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(taskId, "Remote");
    routeUpsert(db.conn, "Remote", {
      agentId: "ag-1",
      deployment: { ref: "dev-box", target: "vscode@localhost:1022" },
    });
    const resolved = resolveDispatchRoute(db.conn, taskId);
    expect(resolved.hostKey).toBe("ssh:vscode@localhost:1022");
    expect(resolved.deployment?.ref).toBe("dev-box");
  });

  it("worktree 层级：route.worktree > 全局 dispatch_worktree > false", () => {
    seedAgents(db.conn, [{ id: "ag-1", command: "claude" }]);
    const taskId = seedTask(db.conn, "任务");
    seedProjectTag(taskId, "App");
    expect(resolveDispatchRoute(db.conn, taskId).worktree).toBe(false);
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_worktree', 'true')").run();
    expect(resolveDispatchRoute(db.conn, taskId).worktree).toBe(true);
    routeUpsert(db.conn, "App", { agentId: "ag-1", worktree: false });
    expect(resolveDispatchRoute(db.conn, taskId).worktree).toBe(false);
  });
});
