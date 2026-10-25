/**
 * 文件对话框（FR-A5，seq 两段语义 AD §4.3）：dialog-request 到达即秒级回 dialog-ack
 * （回执级——host 10s 超时判能力在位）→ 用户选完回 dialog-result（完成级，不设短超时）。
 * dialog-cancel：Electron 无编程关闭系统文件对话框的 API——本模块按协议语义标记该 seq
 * 已取消并**丢弃迟到结果**（对话框由用户在系统面自行关闭）。
 * headless = 记录器 + 可编程结果（默认 canceled 即时收口——子进程集成测试确定性）。
 */
import type { BrowserWindow, OpenDialogOptions } from "electron";
import type { DialogRequestMsg } from "../bridge/protocol.ts";
import type { SysContext } from "./context.ts";

export interface DialogResultInput {
  canceled: boolean;
  paths?: string[];
}

export interface DialogsModule {
  request(msg: DialogRequestMsg): void;
  cancel(seq: number): void;
  dispose(): void;
}

/** headless 记录器（nextResult 可编程；默认 canceled） */
export class HeadlessDialogs implements DialogsModule {
  readonly records: { seq: number; filters: number }[] = [];
  readonly cancels: number[] = [];
  /** 下一次 request 的结果（测试注入；每消费一次重置回默认 canceled） */
  nextResult: DialogResultInput | null = null;

  private readonly ctx: SysContext;

  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  request(msg: DialogRequestMsg): void {
    this.records.push({ seq: msg.seq, filters: msg.filters?.length ?? 0 });
    this.ctx.emit({ type: "dialog-ack", seq: msg.seq });
    const result = this.nextResult ?? { canceled: true };
    this.nextResult = null;
    this.ctx.emit({
      type: "dialog-result",
      seq: msg.seq,
      canceled: result.canceled,
      ...(result.paths ? { paths: result.paths } : {}),
    });
  }

  cancel(seq: number): void {
    this.cancels.push(seq);
  }

  dispose(): void {
    /* no-op */
  }
}

/** 对话框结果上行（迟到取消丢弃；异常按 canceled 收口 + 诊断） */
function forwardDialogResult(
  ctx: SysContext,
  seq: number,
  pending: Set<number>,
  canceledSeqs: Set<number>,
  shown: Promise<{ canceled: boolean; filePaths: string[] }>,
): void {
  shown
    .then((r) => {
      pending.delete(seq);
      if (canceledSeqs.delete(seq)) return; // host 已取消——迟到结果丢弃（AD §4.3）
      ctx.emit({
        type: "dialog-result",
        seq,
        canceled: r.canceled,
        ...(r.filePaths.length > 0 ? { paths: r.filePaths } : {}),
      });
    })
    .catch((err: unknown) => {
      pending.delete(seq);
      canceledSeqs.delete(seq);
      ctx.diag("sys-dialog", `open failed seq=${seq}: ${String(err)}`);
      ctx.emit({ type: "dialog-result", seq, canceled: true });
    });
}

/** Electron 实现（动态 import；窗口存活时以宠物窗为父——模态落点不悬空） */
export async function createElectronDialogs(
  ctx: SysContext,
  getWindow: () => BrowserWindow | null,
): Promise<DialogsModule> {
  const { dialog } = await import("electron");
  const pending = new Set<number>();
  const canceledSeqs = new Set<number>();

  return {
    request(msg: DialogRequestMsg): void {
      // 回执级 ack 即发（host 10s 判能力；与用户交互时长解耦）
      ctx.emit({ type: "dialog-ack", seq: msg.seq });
      if (pending.has(msg.seq)) return; // 重复 seq 防重
      pending.add(msg.seq);
      const win = getWindow();
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        ...(msg.filters ? { filters: msg.filters } : {}),
      };
      const shown = win && !win.isDestroyed() ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
      forwardDialogResult(ctx, msg.seq, pending, canceledSeqs, shown);
    },

    cancel(seq: number): void {
      if (!pending.delete(seq)) return;
      // host 侧已自行收口（sysRequests.cancelDialog）——此处只负责丢弃迟到结果
      canceledSeqs.add(seq);
    },

    dispose(): void {
      pending.clear();
      canceledSeqs.clear();
    },
  };
}
