/**
 * 断连收口 guard + 迟到回传挂接（从 sshExecutor.ts 拆出——棘轮 max-lines，等量迁移；
 * sshExecutor.ts 为统一再出口，消费面不变）。AD §4.7 断连 Note / §5.4 事务边界：
 * 远端探测在事务外，回传/断连失败路径单条 BEGIN IMMEDIATE 收口。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { dispatchTransition, DS_FAILED } from "../domain/dispatch";
import { dispatchHostKey } from "../domain/dispatch-slots";
import { loadAgents } from "../domain/settings";
import { posixQuote } from "../dispatch/cmdline";
import { logAgentSession } from "../dispatch/sessions";
import { listDeployments, type DeploymentEntity } from "./deployments";
import { lateReport, type LateReportFailedRow, type LateReportTrace } from "./lateReport";
import { recheckDeployment, type RecheckOutcome } from "./recheck";
import type { RemoteDispatchPlatform, SshTerminalScope } from "./sshExecutor";
import type { SshScope } from "./sshScope";

/** 绑定了某部署别名（alias）的连接目标列表（hostKey / 失败行查询共用）——执行世界
 *  单源：引用面 = agent 绑定（ai_agents.deployment），target = alias（OpenSSH 别名即连接目标） */
function targetsForAlias(conn: Conn, alias: string): string[] {
  return loadAgents(conn).some((a) => a.deployment?.trim() === alias) ? [alias] : [];
}

/** 断连收口 + recheck 恢复入口（挂 SshScopeHost.onScopeDisconnected / 周期 timer——装配归 2.9） */
export interface RemoteDispatchGuard {
  /** scope 断开事件收口：部署置 disconnected + 在途无头派发单事务置失败（可重派） */
  onScopeDisconnected(deploymentId: string): Promise<void>;
  /** 就绪复核入口（周期/手动共用）；disconnected → ready 恢复时自动挂迟到回传核对 */
  recheck(id: string): Promise<RecheckOutcome>;
}

/**
 * 断连收口 guard（FR-RD3 断连语义）：scope 断开 → ① 实体置 disconnected 记因 +
 * 窗口起点记账（进程内——宿主重启丢窗口即无迟到核对，v1 语义）；② 该部署 hostKey 上
 * 在途无头派发（dispatch_slots 持有者、仍 running）单条 BEGIN IMMEDIATE 收口：
 * agent_sessions error 行（remote_host 快照）+ 状态机 failed（拒绝未确认操作、不自动
 * 重放）+ 删槽。恢复（recheck）时对窗口内失败派发做迟到回传留痕（lateReport——只增
 * 行不改写失败结论）。远端进程托管清理由 dsh-subprocess-ssh 语义承载，本机不补偿。
 */
export function createRemoteDispatchGuard(conn: Conn, platform: RemoteDispatchPlatform): RemoteDispatchGuard {
  const disconnectedAt = new Map<string, string>();
  const now = (): string => platform.now?.() ?? nowRfc3339();

  return {
    async onScopeDisconnected(deploymentId) {
      const at = now();
      markDeploymentDisconnected(conn, deploymentId, at);
      disconnectedAt.set(deploymentId, at);
    },

    async recheck(id) {
      return await recheckDeployment(
        conn,
        id,
        { scopeFor: platform.scopeFor, readHelperArtifact: platform.readHelperArtifact },
        {
          onRecovered: async (entity) => {
            const from = disconnectedAt.get(entity.id);
            disconnectedAt.delete(entity.id);
            if (from === undefined) {
              return; // 无窗口记账（宿主重启后恢复）——无迟到核对面
            }
            await reportLateWindow(conn, entity, from, platform);
          },
        },
      );
    },
  };
}

/** 断开事件落库收口（单事务：实体置 disconnected + 在途派发收口） */
function markDeploymentDisconnected(conn: Conn, deploymentId: string, at: string): void {
  txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    const entity = deployments[deploymentId];
    if (entity === undefined) {
      return;
    }
    deployments[deploymentId] = {
      ...entity,
      status: "disconnected",
      lastError: "SSH 连接断开（scope 断开事件）——派发已置失败，恢复后可重派",
    };
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("dsh:deployments", JSON.stringify(deployments));
    settleInFlightTasks(conn, entity.alias, at);
  });
}

/** 断连窗口内在途无头派发收口（逐 hostKey：error 行 + 状态机 failed + 删槽） */
function settleInFlightTasks(conn: Conn, alias: string, at: string): void {
  const hostKeys = targetsForAlias(conn, alias).map((t) => dispatchHostKey({ host: t }));
  if (hostKeys.length === 0) {
    return;
  }
  const selectTasks = conn.prepare("SELECT task_id FROM dispatch_slots WHERE host_key=?");
  const readState = conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?");
  const deleteSlot = conn.prepare("DELETE FROM dispatch_slots WHERE host_key=? AND task_id=?");
  for (const hostKey of hostKeys) {
    for (const row of selectTasks.all(hostKey) as Array<{ task_id: number }>) {
      const taskId = Number(row.task_id);
      const state = (readState.get(taskId) as { dispatch_state: string | null } | undefined)?.dispatch_state;
      if (state !== "running") {
        continue; // 已被在途 flow 收口（containedFailure 竞态先行）——不重复落账
      }
      logAgentSession(
        conn,
        {
          taskId,
          agentId: "",
          kind: "dispatch_headless",
          command: `远端连接断开（部署 ${alias}）——派发置失败，未确认操作已拒绝、不自动重放`,
          status: "error",
          remoteHost: hostKey.slice("ssh:".length),
        },
        at,
      );
      dispatchTransition(
        conn,
        taskId,
        DS_FAILED,
        `远端连接断开（部署 ${alias}）——任务可重派`,
        "dsh:dispatch-remote",
        at,
      );
      deleteSlot.run(hostKey, taskId);
    }
  }
}

// ---- 迟到回传（lateReport 挂接：断连窗口内失败派发的远端活动痕迹探测） ----

/** find -printf 时间戳 → RFC3339（+0800 → +08:00；Z 保留；无时区 = 不可解析） */
export function normalizeTraceTimestamp(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{4})$/.exec(raw.trim());
  if (m === null) {
    return null;
  }
  if (m[2] === "Z") {
    return `${m[1]}Z`;
  }
  const tz = m[2];
  return `${m[1]}${tz.slice(0, 3)}:${tz.slice(3)}`;
}

/**
 * 痕迹探测命令（A33 mtime 面；GNU find -printf）：workdir 本身 + 兄弟 worktree 目录
 * （<base>-pk-*）的修改时间。全部插值逐参 posixQuote；find 自行匹配（不依赖远端 glob）。
 * 非 GNU 远端（无 -printf）探测失败 → lateReport 尽力语义（无证据不落痕）。
 */
export function traceProbeCommand(workdir: string): string {
  const trimmed = workdir.trim().replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  const parent = cut <= 0 ? "/" : trimmed.slice(0, cut);
  const base = cut <= 0 ? trimmed.slice(1) : trimmed.slice(cut + 1);
  return (
    `find ${posixQuote(parent)} -maxdepth 1 \\( -path ${posixQuote(trimmed)} ` +
    `-o -name ${posixQuote(`${base}-pk-*`)} \\) -printf '%p\\t%TY-%Tm-%TdT%TH:%TM:%TS%Tz\\n'`
  );
}

/** SshScope 版痕迹探测器（lateReport.probeTraces 注入件） */
export function scopeTraceProber(scope: SshScope): (workdir: string) => Promise<LateReportTrace[]> {
  return async (workdir) => {
    const result = await scope.shell(traceProbeCommand(workdir));
    if (result.code !== 0) {
      return [];
    }
    const traces: LateReportTrace[] = [];
    for (const line of result.stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab <= 0) {
        continue;
      }
      const mtime = normalizeTraceTimestamp(line.slice(tab + 1));
      if (mtime !== null) {
        traces.push({ path: line.slice(0, tab), mtime });
      }
    }
    return traces;
  };
}

/** 断连窗口内失败派发查询（时间过滤用 Date.parse——RFC3339 字典序跨时区不可比） */
function failedRowsInWindow(conn: Conn, targets: string[], from: string, to: string): LateReportFailedRow[] {
  const select = conn.prepare(
    "SELECT id, task_id, agent_id, workdir, remote_host, created_at FROM agent_sessions " +
      "WHERE kind='dispatch_headless' AND status='error' AND remote_host=?",
  );
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const out: LateReportFailedRow[] = [];
  for (const target of targets) {
    for (const row of select.all(target) as Array<{
      id: number;
      task_id: number | null;
      agent_id: string;
      workdir: string | null;
      remote_host: string;
      created_at: string;
    }>) {
      const at = Date.parse(row.created_at);
      if (Number.isNaN(at) || at < fromMs || at > toMs) {
        continue;
      }
      out.push({
        rowId: Number(row.id),
        taskId: row.task_id === null ? null : Number(row.task_id),
        agentId: String(row.agent_id),
        workdir: String(row.workdir ?? ""),
        remoteHost: String(row.remote_host),
      });
    }
  }
  return out;
}

/** 恢复时刻的迟到回传核对（探测在事务外，落库纯插入单事务——lateReport 模块承载） */
async function reportLateWindow(
  conn: Conn,
  entity: DeploymentEntity,
  from: string,
  platform: RemoteDispatchPlatform,
): Promise<void> {
  const recoveredAt = platform.now?.() ?? nowRfc3339();
  const targets = targetsForAlias(conn, entity.alias);
  if (targets.length === 0) {
    return;
  }
  let scope: SshTerminalScope | null = null;
  try {
    scope = await platform.scopeFor(entity);
  } catch {
    scope = null;
  }
  if (scope === null || !scope.connected) {
    return; // 恢复即再断开：无探测通道，本窗口放弃（下轮恢复重新起算）
  }
  const failedRows = failedRowsInWindow(conn, targets, from, recoveredAt);
  await lateReport(
    conn,
    { deploymentAlias: entity.alias, disconnectedAt: from, recoveredAt, failedRows },
    { probeTraces: scopeTraceProber(scope) },
    recoveredAt,
  );
}
