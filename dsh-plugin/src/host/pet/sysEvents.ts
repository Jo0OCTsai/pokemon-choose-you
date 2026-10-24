/**
 * sys 桥事件 host 侧消费（full-parity 任务 2.6 / AD §3.2 pet/ 行）：tray-action、
 * shortcut-fired → 既有 pageOpen / 显隐生命周期链；input-activity 仅透传内存状态面
 * （**不落库不外发**——NFR-13）；mac-auth 主动变更转 inputResponse 状态面回调。
 *
 * 依赖全部注入（pet/ 适配缝零 dsh 面）：openPage = 既有 pageOpen 链（A37——settings 复用
 * `pageOpen(section:"settings")` 零契约变更）；petShow/petHide = supervisor 生命周期；
 * 装配接线归任务 2.7/2.9。
 */
import type { BridgeClientHandlers } from "./bridge";
import type { PageOpenPayload } from "./cmdHandler";
import type { MacAuthResultMsg, NotifyClickedMsg, SysUnsupportedMsg } from "../../../helper/src/bridge/protocol";

/**
 * 输入活动状态面（仅内存：lastCps + 最后更新时刻——petStatus/诊断投影消费，2.9）。
 * cps 数据源 = helper 只计数模块（键值 0 出 helper）；host 侧同样不持久化不外发。
 */
export class InputActivityState {
  private lastCpsValue = 0;
  private lastAtValue: number | null = null;

  record(cps: number, at: number = Date.now()): void {
    if (!Number.isFinite(cps) || cps < 0) return;
    this.lastCpsValue = cps;
    this.lastAtValue = at;
  }

  get lastCps(): number {
    return this.lastCpsValue;
  }

  get lastAt(): number | null {
    return this.lastAtValue;
  }
}

/** tray / shortcut 动作的宿主动作面（装配层注入：openPage 链 + supervisor 生命周期） */
export interface SysEventDeps {
  /** 既有 pageOpen 链（A37：settings 现行已支持；capture 聚焦提示由客户端消费——组 3） */
  openPage(payload: PageOpenPayload): void;
  petShow(): void;
  /** 停 helper（pet-toggle 的隐藏侧 + tray quit 共用——quit = helper 连同桌宠托盘退出） */
  petHide(): void;
  /** 当前桌宠可见性（pet-toggle 判定） */
  petVisible(): boolean;
}

/**
 * tray-action 消费（FR-A1）：open → 打开图鉴机；pet-toggle → 显隐；settings → 设置页
 * （复用 pageOpen(section)——零契约变更 A37）；quit → 停 helper（宿主不受影响）。
 */
export function handleTrayAction(deps: SysEventDeps, action: "open" | "pet-toggle" | "settings" | "quit"): void {
  if (action === "open") {
    deps.openPage({});
    return;
  }
  if (action === "settings") {
    deps.openPage({ section: "settings" });
    return;
  }
  if (action === "pet-toggle") {
    togglePet(deps);
    return;
  }
  deps.petHide();
}

/** shortcut-fired 消费（FR-A2）：capture → 打开面板并聚焦收音机快捕；togglePet → 显隐 */
export function handleShortcutFired(deps: SysEventDeps, id: "capture" | "togglePet"): void {
  if (id === "capture") {
    deps.openPage({ section: "panel", focus: "capture" });
    return;
  }
  togglePet(deps);
}

function togglePet(deps: SysEventDeps): void {
  if (deps.petVisible()) {
    deps.petHide();
    return;
  }
  deps.petShow();
}

/** sys 事件消费的装配参数（观测/状态面回调 + SysEventDeps） */
export interface SysEventHandlerArgs extends SysEventDeps {
  /** input-activity 状态面（缺省内建实例；record 后可供 petStatus 投影） */
  inputState?: InputActivityState;
  /** mac-auth 主动变更（授权撤销 granted:false → 设置卡提示重新授权；FR-A9/§4.4） */
  onMacAuthChange?(msg: MacAuthResultMsg): void;
  /** notify-clicked 观测留痕（无动作语义） */
  onNotifyClicked?(msg: NotifyClickedMsg): void;
  /** sys-unsupported → 记诊断 + 提示升级 helper（HELPER_CAPABILITY_MISSING 语义） */
  onSysUnsupported?(msg: SysUnsupportedMsg): void;
}

/**
 * 组装 sys 桥事件处理器（petSection 装配注入——2.7/2.9 接线）：返回 BridgeClientHandlers
 * 的 sys 扩展子集，与既有 onCmd/onFocusSettle 合并。
 */
export function makeSysEventHandlers(args: SysEventHandlerArgs): Partial<BridgeClientHandlers> {
  const inputState = args.inputState ?? new InputActivityState();
  return {
    onTrayAction: (msg) => handleTrayAction(args, msg.action),
    onShortcutFired: (msg) => handleShortcutFired(args, msg.id),
    onInputActivity: (msg) => inputState.record(msg.cps),
    onMacAuthChange: (msg) => args.onMacAuthChange?.(msg),
    onNotifyClicked: (msg) => args.onNotifyClicked?.(msg),
    onSysUnsupported: (msg) => args.onSysUnsupported?.(msg),
  };
}
