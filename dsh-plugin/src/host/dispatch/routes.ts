/**
 * 项目路由（A13 / AD §5.2）：settings 键 `dsh:dispatch_routes` 以项目标签名为键，
 * 与主应用 tags.meta 平行双轨各一份（以标签名对齐）。字段对齐主应用 tags.meta
 * {workdir, agentId, context} 并扩展（maxConcurrent / worktree / auto）。
 * 执行世界不在此层（2026-10-19 裁决）：agent 绑定部署（ai_agents.deployment alias）单源驱动。
 *
 * 行为基准 = src-tauri/src/commands/dispatch/route.rs（resolve_route /
 * effective_workdir 的取数顺序）+ meta.rs（project_tag_meta）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { getSetting, loadAgents, primaryAgent, type AgentConfig } from "../domain/settings";
import { getTask } from "../domain/tasks";
import { parseTagMeta } from "../domain/dispatch";
import { dispatchHostKey } from "../domain/dispatch-slots";

/** 路由存储键（host 半边内部态，随库备份/导出——AD §5.2） */
export const DISPATCH_ROUTES_KEY = "dsh:dispatch_routes";

/** 解析产物：生效部署引用（ref = target = 部署 alias——OpenSSH 别名即 ssh 连接目标，凭据归 ~/.ssh） */
export interface RouteDeployment {
  ref: string;
  target: string;
}

/** 一条项目路由（键 = 项目标签名；执行世界不在此层——agent 绑定部署单源，路由级 deployment 已移除） */
export interface DispatchRoute {
  agentId: string;
  workdir?: string;
  context?: string;
  maxConcurrent?: number;
  worktree?: boolean;
  auto?: boolean;
}

/** 路由解析来源（Rust route.rs source 枚举 + dsh 路由表层） */
export type RouteSource = "pick" | "route" | "meta" | "default";

/** 解析后的派发路由（无头/交互编排共用） */
export interface ResolvedDispatchRoute {
  agent: AgentConfig;
  source: RouteSource;
  projectTag: string;
  /** 生效工作目录（route.workdir > meta.workdir > agent.workdir；空串 = 缺省） */
  workdir: string;
  /** 项目补充上下文（route > meta；空归 null） */
  context: string | null;
  /** 机器并发上限（route > 全局 dispatch_max_concurrent > 1） */
  maxConcurrent: number;
  /** worktree 策略（route > 全局 dispatch_worktree > false） */
  worktree: boolean;
  /** 是否参与自动派发（route.auto 缺省 true） */
  auto: boolean;
  /** SSH deployment 引用（本机派发为 null） */
  deployment: RouteDeployment | null;
  /** host_key 归一（domain/dispatch-slots 同口径：local / ssh:user@host[:port]） */
  hostKey: string;
}

/** 路由列表整读（键 = 项目标签名；坏 JSON 按空表处理） */
export function listRoutes(conn: Conn): Record<string, DispatchRoute> {
  const raw = getSetting(conn, DISPATCH_ROUTES_KEY);
  if (raw === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, DispatchRoute>;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 路由条目校验：tag 必填；agentId 允许空（空 = 不指定，解析时回落标签 meta / 全局默认——
 * 与主应用 tags.meta 双轨语义一致）；maxConcurrent 正整数
 */
function validateRoute(tag: string, route: DispatchRoute): void {
  if (tag.trim() === "") {
    throw paramError("项目标签名不能为空");
  }
  if (route.agentId !== undefined && typeof route.agentId !== "string") {
    throw paramError(`路由「${tag}」的 agentId 必须是字符串`);
  }
  if (route.maxConcurrent !== undefined && (!Number.isInteger(route.maxConcurrent) || route.maxConcurrent < 1)) {
    throw paramError(`路由「${tag}」的 maxConcurrent 必须为正整数`);
  }
}

/** 路由 upsert（单条 BEGIN IMMEDIATE 内整读-改-整写，与 ai_agents 同形态 A24） */
export function routeUpsert(conn: Conn, tag: string, route: DispatchRoute): Record<string, DispatchRoute> {
  validateRoute(tag.trim(), route);
  return txImmediate(conn, () => {
    const routes = listRoutes(conn);
    routes[tag.trim()] = route;
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DISPATCH_ROUTES_KEY, JSON.stringify(routes));
    return routes;
  });
}

/** 删除路由（不存在返回 false） */
export function routeDelete(conn: Conn, tag: string): boolean {
  return txImmediate(conn, () => {
    const routes = listRoutes(conn);
    if (routes[tag] === undefined) {
      return false;
    }
    delete routes[tag];
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DISPATCH_ROUTES_KEY, JSON.stringify(routes));
    return true;
  });
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const v of values) {
    const t = v?.trim();
    if (t !== undefined && t !== "") {
      return t;
    }
  }
  return "";
}

/**
 * 路由解析（route.rs resolve_route 同构，dsh 侧多一层路由表）：
 * 任务 → project 标签 → agent 取 显式改选（pick）> dsh 路由表（route）> 标签 meta
 * （meta）> 全局默认（default：ai_agent_id 指向的启用项 > 首个启用项）。
 * routeOverride 只影响本次解析不回写（确认弹窗改选语义）。
 * 无 project 标签 / 无可用 agent → 参数错（文案对齐主应用）。
 */
/** agent 级联取选（route.rs resolve_route 同构）：pick（改选）> route（dsh 路由表）>
 * meta（主应用 tags.meta 双轨）> default（全局默认）；上层命中即短路 */
function pickAgentForRoute(
  conn: Conn,
  agents: AgentConfig[],
  layers: Array<{ agentId: string | undefined | null; source: RouteSource }>,
): { agent: AgentConfig; source: RouteSource } {
  for (const layer of layers) {
    const id = layer.agentId?.trim();
    if (id !== undefined && id !== "") {
      const hit = agents.find((a) => a.id === id);
      if (hit !== undefined) {
        return { agent: hit, source: layer.source };
      }
    }
  }
  const fallback = primaryAgent(conn);
  if (fallback === null) {
    throw paramError("没有可用的 Agent：请先在 设置 → 集成 添加并启用");
  }
  return { agent: fallback, source: "default" };
}

/** 读 project 标签的 meta（主应用 tags.meta 双轨对齐面；坏 JSON 按无元数据处理） */
function projectTagMeta(conn: Conn, projectTag: string): ReturnType<typeof parseTagMeta> {
  const row = conn
    .prepare("SELECT meta FROM tags WHERE name=? AND dimension_id=(SELECT id FROM tag_dimensions WHERE key='project')")
    .get(projectTag) as { meta: string | null } | undefined;
  return parseTagMeta(row?.meta);
}

/** 并发上限层级（route.maxConcurrent > 全局 dispatch_max_concurrent > 1） */
function resolveMaxConcurrent(conn: Conn, route: DispatchRoute | undefined): number {
  if (route?.maxConcurrent !== undefined) {
    return route.maxConcurrent;
  }
  const v = Number(getSetting(conn, "dispatch_max_concurrent"));
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/** agent 绑定部署 → 生效引用（ref = target = alias；未绑定/空白 = null 本机） */
function agentDeployment(agent: AgentConfig): RouteDeployment | null {
  const alias = agent.deployment?.trim();
  return alias ? { ref: alias, target: alias } : null;
}

export function resolveDispatchRoute(conn: Conn, taskId: number, routeOverride?: string): ResolvedDispatchRoute {
  const task = getTask(conn, taskId);
  const projectTag = task.tags.find((t) => t.dimension === "project")?.name;
  if (projectTag === undefined) {
    throw paramError("先给待办挂上「项目」维度的标签再派发（图鉴机以项目标签路由 agent 与工作目录）");
  }
  const meta = projectTagMeta(conn, projectTag);
  const route = listRoutes(conn)[projectTag];
  const picked = pickAgentForRoute(conn, loadAgents(conn), [
    { agentId: routeOverride, source: "pick" },
    { agentId: route?.agentId, source: "route" },
    { agentId: meta?.agentId, source: "meta" },
  ]);
  const config = routeConfig(conn, route, meta);
  // 执行世界单源：所选 agent 的部署绑定（实体缺失由派发时 planRemoteRoute 硬拒，解析不查实体）
  const deployment = agentDeployment(picked.agent);
  return {
    agent: picked.agent,
    source: picked.source,
    projectTag,
    workdir: firstNonEmpty(config.workdir, picked.agent.workdir),
    context: config.context,
    maxConcurrent: resolveMaxConcurrent(conn, route),
    worktree: config.worktree,
    auto: config.auto,
    deployment,
    hostKey: dispatchHostKey(deployment !== null ? { host: deployment.target } : null),
  };
}

/** 路由上下文配置（dsh 路由表 > tags.meta 双轨；空上下文归 null） */
function routeConfig(
  conn: Conn,
  route: DispatchRoute | undefined,
  meta: { workdir?: string; context?: string } | null,
): { workdir: string; context: string | null; worktree: boolean; auto: boolean } {
  const context = firstNonEmpty(route?.context, meta?.context);
  return {
    workdir: firstNonEmpty(route?.workdir, meta?.workdir),
    context: context === "" ? null : context,
    worktree: route?.worktree ?? getSetting(conn, "dispatch_worktree") === "true",
    auto: route?.auto ?? true,
  };
}
