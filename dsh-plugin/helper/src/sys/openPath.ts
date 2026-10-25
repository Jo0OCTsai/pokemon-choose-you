/**
 * 打开目录/文件（FR-A6）：shell.openPath（导出目录定位；不存在时 host 先建再下发）。
 * 失败只进诊断不打扰（host 侧有降级提示通道）。headless = no-op 记录器。
 */
import type { SysContext } from "./context.ts";

export interface OpenPathModule {
  open(path: string): void;
}

/** headless 记录器 */
export class HeadlessOpenPath implements OpenPathModule {
  readonly records: string[] = [];

  private readonly ctx: SysContext;

  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  open(path: string): void {
    this.records.push(path);
    this.ctx.diag("sys-open", path);
  }
}

/** Electron 实现（动态 import；openPath 返回错误串——空串 = 成功） */
export async function createElectronOpenPath(ctx: SysContext): Promise<OpenPathModule> {
  const { shell } = await import("electron");
  return {
    open(path: string): void {
      void shell
        .openPath(path)
        .then((err) => {
          if (err) ctx.diag("sys-open", `failed ${path}: ${err}`);
        })
        .catch((e: unknown) => ctx.diag("sys-open", `failed ${path}: ${String(e)}`));
    },
  };
}
