/**
 * 系统通知（FR-A3/A4）：sys-notify 五 kind 送达（三语文案 host 组装）→ 点击上行
 * notify-clicked 观测留痕（无动作语义）。平台不支持时静默降级 + 诊断一次。
 * headless = no-op 记录器（clickLast 模拟点击）。
 */
import type { NotifyKind } from "../bridge/sys-protocol.ts";
import type { SysContext } from "./context.ts";

export interface NotifyModule {
  show(kind: NotifyKind, title: string, body: string): void;
  dispose(): void;
}

/** headless 记录器 */
export class HeadlessNotify implements NotifyModule {
  readonly records: { kind: NotifyKind; title: string; body: string }[] = [];

  private readonly ctx: SysContext;

  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  show(kind: NotifyKind, title: string, body: string): void {
    this.records.push({ kind, title, body });
  }

  /** 模拟点击最近一条通知 → notify-clicked 观测 */
  clickLast(): void {
    const last = this.records.at(-1);
    if (last) this.ctx.emit({ type: "notify-clicked", kind: last.kind });
  }

  dispose(): void {
    /* no-op */
  }
}

/** Electron 实现（动态 import；文本经系统通知面板原生渲染——非 helper HTML 面） */
export async function createElectronNotify(ctx: SysContext): Promise<NotifyModule> {
  const { Notification } = await import("electron");
  const supported = Notification.isSupported();
  if (!supported) ctx.diag("sys-notify", "platform unsupported");

  return {
    show(kind: NotifyKind, title: string, body: string): void {
      if (!supported) return;
      try {
        const n = new Notification({ title, body });
        n.on("click", () => ctx.emit({ type: "notify-clicked", kind }));
        n.show();
      } catch (err) {
        ctx.diag("sys-notify", `show failed: ${String(err)}`);
      }
    },
    dispose(): void {
      /* Notification 自灭，无全局态 */
    },
  };
}
