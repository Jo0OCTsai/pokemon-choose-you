/**
 * 装配期排队路由（从 sys/index.ts 拆出——棘轮 max-lines，等量迁移；sys/index.ts
 * 为统一再出口，消费面不变）：electron 形态——hello 先行发送后、electron-app
 * whenReady 挂真模块前，sys 下行入队（封顶 32 满则弃最旧 + 诊断）；attach 后按序
 * 重放并透传最近 lang/可见性；attach 前后能力位有变 → 触发变更回调（runtime 重发
 * hello 校正 host 快照）。
 */
import type { Lang, SysCap } from "../bridge/protocol.ts";
import type { SysDownMsg, SysRouter } from "./index.ts";
import type { NotifyModule } from "./notify.ts";

/** attach 前的 no-op 通知位（装配窗口内无本地通知场景——pomo 到期必然晚于 ready） */
const NOOP_NOTIFY: NotifyModule = {
  show: () => undefined,
  dispose: () => undefined,
};

export class DeferredSys implements SysRouter {
  private queue: SysDownMsg[] = [];
  private target: SysRouter | null = null;
  private readonly capsListeners: (() => void)[] = [];
  private readonly staticCaps: readonly SysCap[];
  private lang: Lang;
  private visible = true;
  private detachCaps: (() => void) | null = null;
  private diagFn: (tag: string, detail: string) => void;

  constructor(diag: (tag: string, detail: string) => void, initialCaps: readonly SysCap[], lang: Lang) {
    this.diagFn = diag;
    this.lang = lang;
    this.staticCaps = [...initialCaps];
  }

  /** runtime 建成后补接诊断出口（emit/now 不经本类——真模块直用 runtime.sysContext） */
  setDiag(diag: (tag: string, detail: string) => void): void {
    this.diagFn = diag;
  }

  private ctxDiag(tag: string, detail: string): void {
    this.diagFn(tag, detail);
  }

  get caps(): readonly SysCap[] {
    return this.target ? this.target.caps : this.staticCaps;
  }

  get notify(): NotifyModule {
    return this.target ? this.target.notify : NOOP_NOTIFY;
  }

  onCapsChange(cb: () => void): () => void {
    this.capsListeners.push(cb);
    if (this.target) this.bindTargetCaps();
    return () => {
      const i = this.capsListeners.indexOf(cb);
      if (i >= 0) this.capsListeners.splice(i, 1);
    };
  }

  handle(msg: SysDownMsg): boolean {
    if (this.target) return this.target.handle(msg);
    this.queue.push(msg);
    if (this.queue.length > 32) {
      this.queue.shift();
      this.ctxDiag("sys-deferred", "queue overflow dropped oldest");
    }
    return true;
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.target?.setLang(lang);
  }

  setPetVisible(visible: boolean): void {
    this.visible = visible;
    this.target?.setPetVisible(visible);
  }

  dispose(): void {
    this.detachCaps?.();
    this.detachCaps = null;
    this.queue = [];
    this.target?.dispose();
    this.target = null;
  }

  /** 挂真模块：重放排队消息 + 透传状态（重复 attach 幂等忽略）；能力位有变发通知 */
  attach(target: SysRouter): void {
    if (this.target) return;
    const capsBefore = this.caps.slice().sort().join(",");
    this.target = target;
    target.setLang(this.lang);
    target.setPetVisible(this.visible);
    for (const msg of this.queue.splice(0)) target.handle(msg);
    this.bindTargetCaps();
    if (target.caps.slice().sort().join(",") !== capsBefore) {
      for (const cb of this.capsListeners) cb();
    }
  }

  private bindTargetCaps(): void {
    if (this.detachCaps || !this.target) return;
    this.detachCaps = this.target.onCapsChange(() => {
      for (const cb of this.capsListeners) cb();
    });
  }
}
