/**
 * 上行 cmd 处理（AD §4.3 桥协议 helper → 插件）：start/pause/resume/done/switch/
 * capture/hide/open-page/pet-interact → domain 调用 + pos 持久化（任意 cmd 携带 pos
 * 即存 dsh:pet_pos——协议注记：拖动归为 pet-interact + pos）；open-page 转发给注册的
 * 页面回调接口（host→客户端 pageOpen 推送，装配层接 dsh 客户端导航通道）。
 * focus-settle → domain/focus 入账（D16 整分钟 + localSessionId 幂等账本）。
 * op → 小处理函数映射表（每 op 独立可测、复杂度摊薄）。
 */
import type { Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { completeTask, pauseCurrentTask, resumeTask, startTask } from "../domain/task-lifecycle";
import { settleFocus, type SettleFocusResult } from "../domain/focus";
import { setPetPos } from "./stateFeed";
import type { CmdMsg, CmdOp, FocusSettleMsg } from "../../../helper/src/bridge/protocol";

/** open-page 页面回调（host→客户端 pageOpen 推送面——装配层注册） */
export interface PageOpenPayload {
  section?: "panel" | "settings";
}

export interface CmdHandlerDeps {
  conn: Conn;
  /** 双击精灵打开插件页面（§4.3 open-page → §4.1.1 pageOpen） */
  onOpenPage?(payload: PageOpenPayload): void;
  /** ⚡发报文本 → 判定捕捉管线（judge 装配层注入；未装配时丢弃） */
  onCapture?(text: string): void;
  /** 隐藏桌宠（petHide 生命周期——supervisor.hide 装配注入） */
  onHide?(): void;
  /** 撸宠/交互回调（装配层观测；pos 已在本函数持久化） */
  onPetInteract?(pos: CmdMsg["pos"]): void;
  /** domain 写后直推（stateFeed.notifyLocalWrite 装配注入） */
  onWrites?(): void;
}

/** taskId 归一（桥协议 number | string → number；缺失/非法 → 参数错） */
function toTaskId(msg: CmdMsg): number {
  if (msg.taskId === undefined) {
    throw paramError(`cmd ${msg.op} 需要 taskId`);
  }
  const id = Number(msg.taskId);
  if (!Number.isInteger(id) || id <= 0) {
    throw paramError(`cmd ${msg.op} 的 taskId 非法：${String(msg.taskId)}`);
  }
  return id;
}

type OpHandler = (deps: CmdHandlerDeps, msg: CmdMsg) => void;

/** start / switch：出发任务（顶下 demote 由 domain 原语承载——switch 同一语义） */
const handleStart: OpHandler = (deps, msg) => {
  startTask(deps.conn, toTaskId(msg));
  deps.onWrites?.();
};

const handlePause: OpHandler = (deps, msg) => {
  const taskId = msg.taskId === undefined ? undefined : toTaskId(msg);
  pauseCurrentTask(deps.conn, "dsh:pet", undefined, taskId);
  deps.onWrites?.();
};

/** 番茄药丸 ▶：恢复暂停任务（缺省取最近暂停的一只；无暂停任务 no-op） */
const handleResume: OpHandler = (deps, msg) => {
  const taskId = msg.taskId === undefined ? pausedTaskId(deps.conn) : toTaskId(msg);
  if (taskId !== null) {
    resumeTask(deps.conn, taskId);
    deps.onWrites?.();
  }
};

const handleDone: OpHandler = (deps, msg) => {
  completeTask(deps.conn, msg.taskId === undefined ? undefined : toTaskId(msg));
  deps.onWrites?.();
};

const handleCapture: OpHandler = (deps, msg) => {
  deps.onCapture?.(msg.text ?? "");
};

const handleHide: OpHandler = (deps) => {
  deps.onHide?.();
};

const handleOpenPage: OpHandler = (deps) => {
  deps.onOpenPage?.({});
};

const handlePetInteract: OpHandler = (deps, msg) => {
  deps.onPetInteract?.(msg.pos);
};

const OP_HANDLERS: Record<CmdOp, OpHandler> = {
  start: handleStart,
  switch: handleStart,
  pause: handlePause,
  resume: handleResume,
  done: handleDone,
  capture: handleCapture,
  hide: handleHide,
  "open-page": handleOpenPage,
  "pet-interact": handlePetInteract,
};

/**
 * 处理一条上行 cmd：domain 调用 + pos 持久化 + 写后直推。抛错由桥装配层捕获计错
 * （不崩 helper 通道）；capture/open-page/hide/pet-interact 走注册回调（零依赖约束：
 * judge 管线 / 页面导航 / supervisor 生命周期经接口注入，真实 dsh 面后续装配）。
 */
export function handleCmd(deps: CmdHandlerDeps, msg: CmdMsg): void {
  // 任意 cmd 携带 pos 即持久化（拖动结束上报；petMove 同义）
  if (msg.pos !== undefined) {
    setPetPos(deps.conn, msg.pos);
  }
  OP_HANDLERS[msg.op](deps, msg);
}

/** 最近暂停的任务（resume 缺省目标；全局唯一进行中不变量下 paused 可能多只） */
function pausedTaskId(conn: Conn): number | null {
  const row = conn
    .prepare("SELECT id FROM tasks WHERE status='paused' ORDER BY started_at DESC, id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  return row === undefined ? null : Number(row.id);
}

/** focus-settle 上行 → domain/focus（D16 整分钟入账 + 幂等账本：同 localSessionId 只入账一次） */
export function handleFocusSettle(conn: Conn, msg: FocusSettleMsg): SettleFocusResult {
  return settleFocus(conn, {
    taskId: Number(msg.taskId),
    localSessionId: msg.localSessionId,
    elapsedMin: msg.elapsedMin,
  });
}
