/**
 * 迟到回传留痕（AD §4.7/A33 / FR-RD3）：断连窗口内失败派发的远端活动痕迹
 * （worktree mtime / 会话文件 mtime——经注入的远端探测函数）→ 只增行落库：
 * task_logs 审计留痕（并入任务时间线）+ agent_sessions 补录（origin/kind =
 * dsh:late-report）。不改写失败结论——本模块无任何 UPDATE 既有行路径（测试断言），
 * 无并发冲突面（AD §5.4）。
 *
 * 挂接点：recheck 恢复回调（disconnected → ready）触发（装配归任务 2.8）；
 * 全部落库单条 BEGIN IMMEDIATE（纯插入，事务内零远端调用——痕迹探测在事务外）。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";

/** 留痕标记（task_logs.origin 与 agent_sessions 补录行 kind 的机器稳定单源） */
export const LATE_REPORT_ORIGIN = "dsh:late-report";

/** 一条远端活动痕迹 */
export interface LateReportTrace {
  /** 痕迹路径（worktree / 会话文件） */
  path: string;
  /** 远端 mtime（RFC3339；不可解析 → 视为窗口外，不入证据） */
  mtime: string;
}

/** 断连窗口内失败派发的账本行（调用方查询面装配——remote_host/workdir 执行世界快照） */
export interface LateReportFailedRow {
  /** agent_sessions 行 id（描述用；本模块不改写该行） */
  rowId: number;
  taskId: number | null;
  agentId: string;
  /** 执行世界快照 workdir（空 = 登录目录 → 无痕迹可探） */
  workdir: string;
  remoteHost: string;
}

export interface LateReportInput {
  deploymentAlias: string;
  /** 断连起点（RFC3339，含） */
  disconnectedAt: string;
  /** 恢复时刻（RFC3339，含） */
  recoveredAt: string;
  failedRows: LateReportFailedRow[];
}

/** 远端痕迹探测（经注入——实现走 SshScope；本模块零 dsh import） */
export interface LateReportDeps {
  probeTraces(workdir: string): Promise<LateReportTrace[]>;
}

export interface LateReportResult {
  /** 写入 task_logs 的留痕行数 */
  audited: number;
  /** 补录 agent_sessions 行数 */
  supplemented: number;
}

/** 窗口判定：mtime 可解析且落在 [disconnectedAt, recoveredAt]（含端点） */
function withinWindow(trace: LateReportTrace, disconnectedAt: string, recoveredAt: string): boolean {
  const mtime = Date.parse(trace.mtime);
  const from = Date.parse(disconnectedAt);
  const to = Date.parse(recoveredAt);
  return !Number.isNaN(mtime) && !Number.isNaN(from) && !Number.isNaN(to) && mtime >= from && mtime <= to;
}

/** 痕迹摘要（路径 + mtime，截长防账本行膨胀） */
function traceSummary(traces: LateReportTrace[]): string {
  return traces
    .slice(0, 5)
    .map((t) => `${t.path} @ ${t.mtime}`)
    .join("；")
    .slice(0, 400);
}

/**
 * 迟到回传留痕：对断连窗口内每条失败派发探测远端活动痕迹；有窗口内证据才落痕——
 * 每条失败派发 ≤ 1 行审计（task 有 id 才可入时间线）+ 1 行会话补录。
 * 无证据 / workdir 空 → 不落任何行。纯插入，不改写任何既有行。
 */
export async function lateReport(
  conn: Conn,
  input: LateReportInput,
  deps: LateReportDeps,
  now: string = nowRfc3339(),
): Promise<LateReportResult> {
  validateLateReportInput(input);
  if (input.failedRows.length === 0) {
    return { audited: 0, supplemented: 0 };
  }
  // ---- 痕迹探测（事务外——事务内禁止远端调用） ----
  const evidence = await probeEvidence(input, deps);
  if (evidence.size === 0) {
    return { audited: 0, supplemented: 0 };
  }
  // ---- 只增行落库（单条 BEGIN IMMEDIATE，纯 INSERT） ----
  return txImmediate(conn, () => insertLateReportRows(conn, input, evidence, now));
}

/** 痕迹探测（事务外）：有窗口内证据的失败行才入证据表；workdir 空 = 无可定位痕迹 */
async function probeEvidence(input: LateReportInput, deps: LateReportDeps): Promise<Map<number, LateReportTrace[]>> {
  const evidence = new Map<number, LateReportTrace[]>();
  for (const row of input.failedRows) {
    if (row.workdir.trim() === "") {
      continue; // 登录目录快照：无可定位痕迹
    }
    let traces: LateReportTrace[] = [];
    try {
      traces = await deps.probeTraces(row.workdir);
    } catch {
      traces = []; // 探测失败不阻塞其余行——留痕面尽力执行
    }
    const inWindow = traces.filter((t) => withinWindow(t, input.disconnectedAt, input.recoveredAt));
    if (inWindow.length > 0) {
      evidence.set(row.rowId, inWindow);
    }
  }
  return evidence;
}

/** 证据行落库（纯 INSERT：task_logs 审计 + agent_sessions 补录各 ≤ 1 行/失败行） */
function insertLateReportRows(
  conn: Conn,
  input: LateReportInput,
  evidence: Map<number, LateReportTrace[]>,
  now: string,
): LateReportResult {
  let audited = 0;
  let supplemented = 0;
  const insertLog = conn.prepare(
    "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
      "VALUES (?, 'update', 'late_report', NULL, ?, ?, ?)",
  );
  const insertSession = conn.prepare(
    "INSERT INTO agent_sessions (task_id, agent_id, agent_name, session_id, command, exit_code, status, " +
      "kind, workdir, remote_host, remote_port, remote_key, created_at) " +
      "VALUES (?, ?, ?, NULL, ?, NULL, 'ok', ?, ?, ?, 0, '', ?)",
  );
  for (const row of input.failedRows) {
    const traces = evidence.get(row.rowId);
    if (traces === undefined) {
      continue;
    }
    const summary = `迟到回传补录（部署 ${input.deploymentAlias}，断连窗口 ${input.disconnectedAt} ~ ${input.recoveredAt}）：远端仍有活动痕迹，失败结论不变——${traceSummary(traces)}`;
    if (row.taskId !== null) {
      insertLog.run(row.taskId, summary, LATE_REPORT_ORIGIN, now);
      audited += 1;
    }
    insertSession.run(
      row.taskId,
      row.agentId,
      row.agentId,
      summary,
      LATE_REPORT_ORIGIN,
      row.workdir,
      row.remoteHost,
      now,
    );
    supplemented += 1;
  }
  return { audited, supplemented };
}

/** 入参防御：窗口时间不可解析直接拒绝（调用方装配面错误，不留半截痕迹） */
export function validateLateReportInput(input: LateReportInput): void {
  if (Number.isNaN(Date.parse(input.disconnectedAt)) || Number.isNaN(Date.parse(input.recoveredAt))) {
    throw paramError("迟到回传窗口时间不可解析（需 RFC3339）");
  }
}
