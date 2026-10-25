/**
 * 全局快捷键（FR-A2）：⌘⇧K 快捕 / ⌘⇧D 显隐桌宠（加速键字符串由 sys-config 下发，
 * 默认注册失败降级——不发 shortcut-fired，提示经 host 诊断面）。dispose 注销全量。
 * headless = no-op 记录器（failNext 可编程模拟注册占用）。
 */
import type { SysContext } from "./context.ts";

export interface ShortcutConfig {
  capture: string;
  togglePet: string;
}

export interface ShortcutsModule {
  /** sys-config.shortcuts 分节到达（重注册；缺省分节 = 维持现状） */
  configure(cfg: ShortcutConfig): void;
  /** 最近一次注册是否成功（失败时模块静默——事件不会发出） */
  readonly registered: boolean;
  dispose(): void;
}

/** headless 记录器 */
export class HeadlessShortcuts implements ShortcutsModule {
  registered = false;
  readonly records: { attempts: ShortcutConfig[]; fired: string[] } = { attempts: [], fired: [] };
  /** 预置下一次 configure 注册失败（模拟被占用） */
  failNext = false;

  private readonly ctx: SysContext;

  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  configure(cfg: ShortcutConfig): void {
    this.records.attempts.push(cfg);
    this.registered = !this.failNext;
    this.failNext = false;
    if (this.registered) this.ctx.diag("sys-shortcut", `registered ${cfg.capture}/${cfg.togglePet}`);
    else this.ctx.diag("sys-shortcut", `register failed ${cfg.capture}/${cfg.togglePet}`);
  }

  /** 模拟按下已注册的快捷键 */
  fire(id: "capture" | "togglePet"): void {
    if (!this.registered) return; // 注册失败不发（降级经诊断面）
    this.records.fired.push(id);
    this.ctx.emit({ type: "shortcut-fired", id });
  }

  dispose(): void {
    this.registered = false;
  }
}

/** Electron 实现（动态 import；注册失败 = 两个都注销回干净态） */
export async function createElectronShortcuts(ctx: SysContext): Promise<ShortcutsModule> {
  const { globalShortcut } = await import("electron");
  const state = { cfg: null as ShortcutConfig | null, ok: false };

  const unregisterAll = (): void => {
    if (!state.cfg) return;
    globalShortcut.unregister(state.cfg.capture);
    globalShortcut.unregister(state.cfg.togglePet);
  };

  return {
    configure(cfg: ShortcutConfig): void {
      unregisterAll();
      state.cfg = cfg;
      const onFire = (id: "capture" | "togglePet") => () => ctx.emit({ type: "shortcut-fired", id });
      const capOk = globalShortcut.register(cfg.capture, onFire("capture"));
      const togOk = globalShortcut.register(cfg.togglePet, onFire("togglePet"));
      state.ok = capOk && togOk;
      if (!state.ok) {
        // 任一失败：全注销回干净态，整体降级（不发事件；host 诊断面呈现「可能被占用」）
        unregisterAll();
        ctx.diag("sys-shortcut", `register failed ${cfg.capture}/${cfg.togglePet}`);
        return;
      }
      ctx.diag("sys-shortcut", `registered ${cfg.capture}/${cfg.togglePet}`);
    },
    get registered(): boolean {
      return state.ok;
    },
    dispose(): void {
      unregisterAll();
      state.ok = false;
    },
  };
}
