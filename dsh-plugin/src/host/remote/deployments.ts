/**
 * 部署实体定义 + 读面（AD §5.1/§5.2/A25）：settings 键 `dsh:deployments`（JSON：id→实体，
 * alias 唯一索引约束在写入时校验），整读-改-整写（A24 模式，同 dsh:dispatch_routes）。
 * 零新表零迁移；随库备份/导出。
 *
 * 实体字段白名单（NFR-11③ 凭据零存储的机检面）：键集 = ER §5.1 全集 + pkTunnel
 * （ADR-0003），超出即测试断言红。路径不变式（§4.5）：nodePath/workdir 只存展开后
 * POSIX 绝对路径——显式拒 `~` 前缀与相对路径。
 *
 * 落库规范序（PROTOCOL §8，与 Rust oracle 字节一致的单源）：map 按 id 字典序、实体键
 * 按白名单序、未知键排尾按字典序——storeDeployments 统一 canonicalize。
 *
 * 写面拆件（棘轮 max-lines，等量迁移）：upsert = deploymentUpsert.ts、移除 + 自清理 =
 * deploymentDelete.ts；本文件为统一再出口（消费面不变）。
 */
import type { Conn } from "../storage/db";
import { txImmediate } from "../storage/db";
import { loadAgents } from "../domain/settings";
import type { ProvisionState } from "./provision";

/** 部署实体存储键（host 半边内部态，随库备份/导出） */
export const DEPLOYMENTS_KEY = "dsh:deployments";

/** 部署状态机取值（SDD §3.3） */
export type DeploymentStatus = "draft" | "probing" | "not_ready" | "installing" | "ready" | "disconnected";

/** pk 通道机器级隧道配置（ADR-0003 §2；PROTOCOL §8 pkTunnel） */
export interface PkTunnelConfig {
  /** 远端侧隧道端口（1..=65535；0 拒绝） */
  port: number;
  /** 常驻开关（任一宿主驻留期维持） */
  persistent: boolean;
}

/**
 * 部署实体（PROTOCOL §8 字段表；键集 = 白名单精确到键，凭据零存储）。
 */
export interface DeploymentEntity {
  /** 实体唯一键（upsert 无 id 时生成；路由引用用 alias 不用 id） */
  id: string;
  /** OpenSSH 别名（唯一索引；凭据与主机身份全由它承载——不存私钥/密码） */
  alias: string;
  /** 远端 node 绝对路径（展开后 POSIX 绝对路径，拒 `~`） */
  nodePath: string;
  /** 远端 helper 入口（provision 步③ 落定；未安装 = 空串） */
  helperPath: string;
  /** helper SHA-256（就绪判据；verify 通过才落；未就绪 = null） */
  helperHash: string | null;
  /** 默认远端工作目录（展开后 POSIX 绝对路径，拒 `~`；空串 = 登录目录） */
  workdir: string;
  /** 备注 */
  note: string;
  /** 生命周期状态（SDD §3.3 状态图） */
  status: DeploymentStatus;
  /** 最近错误（诊断呈现） */
  lastError: string | null;
  /** 开通向导步骤状态（幂等状态机；未发起 = null） */
  provision: ProvisionState | null;
  /** 直连降级标记（D31：仅显式确认留痕后可达 true） */
  degraded: boolean;
  /** pk 通道隧道配置（null = 未配置；alias 改名时一并清空——PROTOCOL §8） */
  pkTunnel: PkTunnelConfig | null;
}

/** 实体 JSON 键集白名单（测试断言单源；超出即 NFR-11③ 断言红）。序 = 落库规范序 */
export const DEPLOYMENT_FIELD_WHITELIST = [
  "id",
  "alias",
  "nodePath",
  "helperPath",
  "helperHash",
  "workdir",
  "note",
  "status",
  "lastError",
  "provision",
  "degraded",
  "pkTunnel",
] as const;

/** 实体键集判定（canonicalize 的已知键面 = 白名单） */
const KNOWN_KEYS: ReadonlySet<string> = new Set(DEPLOYMENT_FIELD_WHITELIST);

/** 缺省填充（与 Rust DeploymentEntity::default 对齐——canonicalize 补齐缺失键） */
const FIELD_DEFAULTS: Record<string, unknown> = {
  id: "",
  alias: "",
  nodePath: "",
  helperPath: "",
  helperHash: null,
  workdir: "",
  note: "",
  status: "",
  lastError: null,
  provision: null,
  degraded: false,
  pkTunnel: null,
};

/**
 * 实体 canonicalize：白名单键按规范序（缺失键按缺省补齐）+ 未知键排尾字典序。
 * 双端落库字节一致性的 TS 半边（Rust 半边 = 结构体声明序 + flatten extra）。
 */
function canonicalizeEntity(entity: DeploymentEntity): Record<string, unknown> {
  const source = entity as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DEPLOYMENT_FIELD_WHITELIST) {
    const v = source[key];
    out[key] = v === undefined ? FIELD_DEFAULTS[key] : v;
  }
  for (const key of Object.keys(source).sort()) {
    if (!KNOWN_KEYS.has(key) && !(key in out)) {
      out[key] = source[key];
    }
  }
  return out;
}

// ---- 整读-改-整写（A24） ----

/** 部署列表整读（坏 JSON 按空表处理，同 listRoutes） */
export function listDeployments(conn: Conn): Record<string, DeploymentEntity> {
  const row = conn.prepare("SELECT value FROM settings WHERE key=?").get(DEPLOYMENTS_KEY) as
    { value: string } | undefined;
  if (row === undefined) {
    return {};
  }
  try {
    const parsed = JSON.parse(row.value) as Record<string, DeploymentEntity>;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 部署列表整写（upsert / delete / 断连收口共用落库单点；规范序 = PROTOCOL §8） */
export function storeDeployments(conn: Conn, deployments: Record<string, DeploymentEntity>): void {
  const canonical: Record<string, unknown> = {};
  for (const id of Object.keys(deployments).sort()) {
    canonical[id] = canonicalizeEntity(deployments[id]);
  }
  conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(canonical));
}

/** 按 id 取实体（不存在 = null） */
export function deploymentById(conn: Conn, id: string): DeploymentEntity | null {
  return listDeployments(conn)[id] ?? null;
}

/** 按 alias 取实体（alias 唯一索引的读取面；不存在 = null） */
export function deploymentByAlias(conn: Conn, alias: string): DeploymentEntity | null {
  const hit = Object.values(listDeployments(conn)).find((d) => d.alias === alias);
  return hit ?? null;
}

/** 远端执行失败落实体 lastError（判定链诊断留痕，部署设置 UI 可见；status 迁移归
 *  recheck——本写入不动状态，recheck 恢复时清空。实体并发消失 = 静默（best-effort）） */
export function recordDeploymentLaunchError(conn: Conn, id: string, message: string): void {
  txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    if (deployments[id] === undefined) {
      return;
    }
    deployments[id] = { ...deployments[id], lastError: message };
    storeDeployments(conn, deployments);
  });
}

/**
 * 部署绑定失配查询（§5.2 ② / A25；2026-10-19 单源化后引用方 = agent 绑定）：
 * 列出 ai_agents 中 deployment 指向不存在部署实体的 agent——delete 不做级联后的
 * 悬空绑定由本面承接呈现（派发时 planRemoteRoute 硬拒 DEPLOYMENT_NOT_READY 兜底）。
 */
export function danglingDeploymentRefs(conn: Conn): Array<{ agentId: string; agentName: string; ref: string }> {
  const aliases = new Set(Object.values(listDeployments(conn)).map((d) => d.alias));
  const out: Array<{ agentId: string; agentName: string; ref: string }> = [];
  for (const agent of loadAgents(conn)) {
    const ref = agent.deployment?.trim();
    if (ref !== undefined && ref !== "" && !aliases.has(ref)) {
      out.push({ agentId: agent.id, agentName: agent.name, ref });
    }
  }
  return out;
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export { deploymentUpsert, type DeploymentUpsertInput } from "./deploymentUpsert";
export {
  cleanupCommand,
  deploymentDelete,
  type DeploymentCleanup,
  type DeploymentDeleteDeps,
  type DeploymentDeleteResult,
} from "./deploymentDelete";
