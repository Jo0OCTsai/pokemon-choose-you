/**
 * sys/ 装配面（AD §3.4「每能力一文件、独立启停」的组合根）：
 * - `SysRouter`：runtime 下行路由目标（handle 返回 false = 消息类型已认识但实现在位面
 *   缺失——runtime 走 sys-unsupported 兜底，NFR-14）；
 * - `createHeadlessSys`：no-op 记录器全家（HELPER_HEADLESS=1 / 进程内测试；可编程结果）；
 * - `createElectronSys`：真实现（各模块动态 import electron/uiohook——headless 主链路
 *   零 electron 触碰）；mac-auth/input-count 仅 darwin 装配（D32）；uiohook 探测结果决定
 *   input-count 位（能力位与实现不得失配）；
 * - `DeferredSys`：electron 装配期（app ready 前）的排队路由——hello 先行、sys 消息入队
 *   重放，杜绝「hello 已声明能力、模块未挂」窗口丢消息；attach 后能力位有变 → 通知
 *   runtime 重发 hello（host 侧快照随之校正）。
 *
 * 实现拆件（棘轮 max-lines，等量迁移）：headless = headlessSys.ts、electron =
 * electronSys.ts、装配期排队 = deferredSys.ts；本文件为统一再出口（消费面不变）。
 */
import type {
  DialogCancelMsg,
  DialogRequestMsg,
  DownstreamMsg,
  Lang,
  MacAuthQueryMsg,
  OpenPathMsg,
  SysCap,
  SysConfigMsg,
  SysNotifyMsg,
  TtsSpeakMsg,
} from "../bridge/protocol.ts";
export type { SysContext } from "./context.ts";
import type { HeadlessDialogs } from "./dialogs.ts";
import type { HeadlessInputCount } from "./inputCount.ts";
import type { HeadlessMacAuth } from "./macAuth.ts";
import type { HeadlessNotify, NotifyModule } from "./notify.ts";
import type { HeadlessOpenPath } from "./openPath.ts";
import type { HeadlessShortcuts } from "./shortcuts.ts";
import type { HeadlessTray } from "./tray.ts";
import type { HeadlessTts } from "./tts.ts";

/** sys 下行七消息（chat-reply 由 runtime 直派渲染层——非 OS 能力面） */
export type SysDownMsg =
  SysConfigMsg | SysNotifyMsg | TtsSpeakMsg | DialogRequestMsg | DialogCancelMsg | OpenPathMsg | MacAuthQueryMsg;

export function isSysDownMsg(msg: DownstreamMsg): msg is SysDownMsg {
  return (
    msg.type === "sys-config" ||
    msg.type === "sys-notify" ||
    msg.type === "tts-speak" ||
    msg.type === "dialog-request" ||
    msg.type === "dialog-cancel" ||
    msg.type === "open-path" ||
    msg.type === "mac-auth-query"
  );
}

export interface SysRouter {
  /** 当前能力位（hello 组装源；变更经 onCapsChange 通知——runtime 重发 hello 校正快照） */
  readonly caps: readonly SysCap[];
  /** 系统通知模块面（helper 本地发起的通知复用同一实现——如番茄到期 pomo-done） */
  readonly notify: NotifyModule;
  onCapsChange(cb: () => void): () => void;
  handle(msg: SysDownMsg): boolean;
  /** lang 下行（托盘菜单/退出确认三语） */
  setLang(lang: Lang): void;
  /** 桌宠可见性（托盘「显示/隐藏」label——runtime 乐观跟踪维护） */
  setPetVisible(visible: boolean): void;
  dispose(): void;
}

/** headless 全家记录器（测试可编程面直接暴露） */
export interface HeadlessSys extends SysRouter {
  readonly tray: HeadlessTray;
  readonly shortcuts: HeadlessShortcuts;
  readonly notify: HeadlessNotify;
  readonly tts: HeadlessTts;
  readonly dialogs: HeadlessDialogs;
  readonly openPath: HeadlessOpenPath;
  readonly macAuth: HeadlessMacAuth;
  readonly inputCount: HeadlessInputCount;
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export { createHeadlessSys } from "./headlessSys.ts";
export { createElectronSys, electronDeferredCaps } from "./electronSys.ts";
export { DeferredSys } from "./deferredSys.ts";
