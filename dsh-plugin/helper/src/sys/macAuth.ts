/**
 * macOS 辅助功能授权（FR-A9）：mac-auth-query → 秒级 mac-auth-ack → mac-auth-result
 * （同型两段语义）。未授权时查询**含直达面板动作**（UIUX 契约收敛：openAccessibilityPane
 * 并入 mac-auth-query——isTrustedAccessibilityClient(prompt=true) 触发系统引导；查询型
 * 轮询面以 30s 节流防面板轰炸）。撤销/恢复检测：systemPreferences.subscribeNotification
 * （AX 分布式通知，best-effort）+ 60s 轮询兜底（watch 开启时——inputCount 运行才轮询）；
 * 中途撤销 → 主动上报 `mac-auth-result {seq:0, granted:false}`（seq 0 约定，host 已支持）。
 * headless = 记录器（granted 可编程 + revoke/grant 模拟变更）。
 */
import type { MacAuthQueryMsg } from "../bridge/protocol.ts";
import type { SysContext } from "./context.ts";

/** 直达面板节流（同因重复查询 30s 内只引导一次） */
const PANE_OPEN_THROTTLE_MS = 30_000;
/** 轮询兜底间隔（AD §4.4） */
const AUTH_POLL_MS = 60_000;

export interface MacAuthModule {
  query(msg: MacAuthQueryMsg): void;
  /** 纯查询（inputCount 开启门槛共用） */
  currentGrant(): Promise<boolean>;
  /** 授权变更回调（inputCount 停启接线） */
  onAuthChange(cb: (granted: boolean) => void): void;
  /** 撤销/恢复巡检开关（inputCount 运行时才开——省电；关闭即停轮询） */
  watch(on: boolean): void;
  dispose(): void;
}

/** headless 记录器（HELPER_HEADLESS_AX=1 起始 granted——子进程集成测试可编程） */
export class HeadlessMacAuth implements MacAuthModule {
  readonly records: { queries: number; reports: boolean[] } = { queries: 0, reports: [] };
  granted: boolean;
  private lastPaneAt = Number.NEGATIVE_INFINITY;
  private authCallbacks: ((granted: boolean) => void)[] = [];

  private readonly ctx: SysContext;

  constructor(ctx: SysContext, opts: { granted?: boolean } = {}) {
    this.ctx = ctx;
    this.granted = opts.granted ?? false;
  }

  query(msg: MacAuthQueryMsg): void {
    this.records.queries++;
    this.ctx.emit({ type: "mac-auth-ack", seq: msg.seq });
    if (!this.granted) this.maybeOpenPane();
    this.ctx.emit({ type: "mac-auth-result", seq: msg.seq, kind: "accessibility", granted: this.granted });
  }

  currentGrant(): Promise<boolean> {
    return Promise.resolve(this.granted);
  }

  onAuthChange(cb: (granted: boolean) => void): void {
    this.authCallbacks.push(cb);
  }

  watch(on: boolean): void {
    if (on) this.ctx.diag("mac-auth", "watch on (headless)");
  }

  /** 模拟系统设置里撤销授权（主动上报 seq 0 + 通知回调） */
  revoke(): void {
    this.setGrant(false);
  }

  /** 模拟重新授权 */
  grant(): void {
    this.setGrant(true);
  }

  dispose(): void {
    this.authCallbacks = [];
  }

  private setGrant(granted: boolean): void {
    if (this.granted === granted) return;
    this.granted = granted;
    this.records.reports.push(granted);
    this.ctx.emit({ type: "mac-auth-result", seq: 0, kind: "accessibility", granted });
    for (const cb of this.authCallbacks) cb(granted);
  }

  private maybeOpenPane(): void {
    const now = this.ctx.now();
    if (now - this.lastPaneAt < PANE_OPEN_THROTTLE_MS) return;
    this.lastPaneAt = now;
    this.ctx.diag("mac-auth", "open accessibility pane");
  }
}

/** electron systemPreferences 最小结构面（mac-auth 消费的两种方法） */
interface SystemPreferencesLike {
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  subscribeNotification(event: string, cb: () => void): unknown;
}

/** electron mac-auth 引擎（变更上报 + 60s 轮询兜底 + 直达面板 30s 节流） */
class ElectronMacAuth implements MacAuthModule {
  private readonly ctx: SysContext;
  private readonly prefs: SystemPreferencesLike;
  private readonly state: { granted: boolean; watching: boolean };
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly callbacks: ((granted: boolean) => void)[] = [];
  private lastPaneAt = Number.NEGATIVE_INFINITY;

  // 显式字段赋值（Node 24 strip-only 不支持参数属性语法）
  constructor(ctx: SysContext, prefs: SystemPreferencesLike) {
    this.ctx = ctx;
    this.prefs = prefs;
    this.state = { granted: prefs.isTrustedAccessibilityClient(false), watching: false };
    // AX 分布式通知（best-effort——名字失配只是永不触发，轮询兜底）
    try {
      prefs.subscribeNotification("com.apple.accessibility.api", () => this.poll());
    } catch {
      /* 订阅不可用 → 仅轮询 */
    }
  }

  query(msg: MacAuthQueryMsg): void {
    this.ctx.emit({ type: "mac-auth-ack", seq: msg.seq });
    const granted = this.prefs.isTrustedAccessibilityClient(false);
    if (!granted) this.openPaneThrottled();
    this.ctx.emit({ type: "mac-auth-result", seq: msg.seq, kind: "accessibility", granted });
  }

  currentGrant(): Promise<boolean> {
    return Promise.resolve(this.prefs.isTrustedAccessibilityClient(false));
  }

  onAuthChange(cb: (granted: boolean) => void): void {
    this.callbacks.push(cb);
  }

  watch(on: boolean): void {
    if (on === this.state.watching) return;
    this.state.watching = on;
    if (on) {
      const t = setInterval(() => this.poll(), AUTH_POLL_MS);
      t.unref?.();
      this.timers.push(t);
      return;
    }
    for (const t of this.timers.splice(0)) clearInterval(t);
  }

  dispose(): void {
    for (const t of this.timers.splice(0)) clearInterval(t);
    this.state.watching = false;
    this.callbacks.length = 0;
  }

  private reportChange(granted: boolean): void {
    if (this.state.granted === granted) return;
    this.state.granted = granted;
    this.ctx.diag("mac-auth", `ax ${granted ? "granted" : "revoked"}`);
    this.ctx.emit({ type: "mac-auth-result", seq: 0, kind: "accessibility", granted });
    for (const cb of this.callbacks) cb(granted);
  }

  private poll(): void {
    try {
      this.reportChange(this.prefs.isTrustedAccessibilityClient(false));
    } catch (err) {
      this.ctx.diag("mac-auth", `poll failed: ${String(err)}`);
    }
  }

  private openPaneThrottled(): void {
    const now = this.ctx.now();
    if (now - this.lastPaneAt < PANE_OPEN_THROTTLE_MS) return;
    this.lastPaneAt = now;
    try {
      // prompt=true：未授权时弹出系统引导（直达辅助功能面板；已授权为 no-op）
      this.prefs.isTrustedAccessibilityClient(true);
      this.ctx.diag("mac-auth", "open accessibility pane");
    } catch (err) {
      this.ctx.diag("mac-auth", `pane failed: ${String(err)}`);
    }
  }
}

/** Electron 实现（动态 import；仅 darwin 装配——非 macOS 不声明 mac-auth 位） */
export async function createElectronMacAuth(ctx: SysContext): Promise<MacAuthModule> {
  const { systemPreferences } = await import("electron");
  return new ElectronMacAuth(ctx, systemPreferences);
}
