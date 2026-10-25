/**
 * electron sys 组合根（从 sys/index.ts 拆出——棘轮 max-lines，等量迁移；
 * sys/index.ts 为统一再出口，消费面不变）：app ready 后装配真实现（各模块动态
 * import electron/uiohook——headless 主链路零 electron 触碰）；mac-auth/input-count
 * 仅 darwin 装配（D32）；uiohook 探测结果决定 input-count 位（能力位与实现不得失配）。
 */
import type { BrowserWindow } from "electron";
import type { Lang, SysCap, SysConfigMsg } from "../bridge/protocol.ts";
import type { SysContext } from "./context.ts";
import type { SysDownMsg, SysRouter } from "./index.ts";
import { createElectronDialogs } from "./dialogs.ts";
import { createElectronInputCount, type InputCountModule } from "./inputCount.ts";
import { createElectronMacAuth, type MacAuthModule } from "./macAuth.ts";
import { createElectronNotify } from "./notify.ts";
import { createElectronOpenPath } from "./openPath.ts";
import { createElectronShortcuts } from "./shortcuts.ts";
import { createElectronTray } from "./tray.ts";
import { createElectronTts } from "./tts.ts";

/** electron 装配完成的模块面（mac-auth/input-count 仅 darwin 在位，否则 null） */
interface ElectronSysModules {
  readonly darwin: boolean;
  readonly tray: Awaited<ReturnType<typeof createElectronTray>>;
  readonly shortcuts: Awaited<ReturnType<typeof createElectronShortcuts>>;
  readonly notify: Awaited<ReturnType<typeof createElectronNotify>>;
  readonly tts: Awaited<ReturnType<typeof createElectronTts>>;
  readonly dialogs: Awaited<ReturnType<typeof createElectronDialogs>>;
  readonly openPath: Awaited<ReturnType<typeof createElectronOpenPath>>;
  readonly macAuth: MacAuthModule | null;
  readonly inputCount: (InputCountModule & { readonly available: boolean }) | null;
}

/** electron 七模块装配（前六并行；mac-auth/input-count 仅 darwin——D32） */
async function loadElectronModules(
  ctx: SysContext,
  opts: { lang: Lang; getWindow: () => BrowserWindow | null },
): Promise<ElectronSysModules> {
  const [tray, shortcuts, notify, tts, dialogs, openPath] = await Promise.all([
    createElectronTray(ctx, { lang: opts.lang }),
    createElectronShortcuts(ctx),
    createElectronNotify(ctx),
    createElectronTts(),
    createElectronDialogs(ctx, opts.getWindow),
    createElectronOpenPath(ctx),
  ]);
  const darwin = process.platform === "darwin"; // D32：非 macOS 整面隐藏
  const macAuth: MacAuthModule | null = darwin ? await createElectronMacAuth(ctx) : null;
  const inputCount: (InputCountModule & { readonly available: boolean }) | null = darwin
    ? await createElectronInputCount(ctx, {
        currentGrant: () => (macAuth ? macAuth.currentGrant() : Promise.resolve(false)),
        onAuthChange: (cb) => macAuth?.onAuthChange(cb),
      })
    : null;
  if (macAuth && inputCount) {
    macAuth.onAuthChange((granted) => inputCount.onAuthChange(granted));
  }
  return { darwin, tray, shortcuts, notify, tts, dialogs, openPath, macAuth, inputCount };
}

/** electron 能力位（六基础 + darwin 的 mac-auth + uiohook 探测成功的 input-count） */
function electronSysCaps(mods: ElectronSysModules): SysCap[] {
  const caps: SysCap[] = ["sys-tray", "sys-shortcut", "sys-notify", "sys-tts", "sys-dialog", "sys-open"];
  if (mods.darwin) caps.push("mac-auth");
  if (mods.inputCount?.available) caps.push("input-count"); // 探测成功才声明（不失配）
  return caps;
}

/** electron sys-config 应用（inputCount 探测失败的能力位失配 → 计错进诊断） */
function electronSysConfig(ctx: SysContext, mods: ElectronSysModules, msg: SysConfigMsg): void {
  if (msg.tray) mods.tray.setTooltip(msg.tray.tooltip);
  if (msg.shortcuts) mods.shortcuts.configure(msg.shortcuts);
  if (msg.inputResponse) {
    if (mods.inputCount) {
      mods.inputCount.configure(msg.inputResponse);
      mods.macAuth?.watch(msg.inputResponse.enabled); // 计数运行才开授权巡检（省电）
    } else {
      // uiohook 探测失败的能力位失配：计错进诊断（caps 快照已收窄，host 门控自愈）
      ctx.diag("input-count", "cap mismatch: inputResponse ignored");
    }
  }
  if (msg.tts) mods.tts.setEnabled(msg.tts.enabled);
}

/** electron 下行分派器（七消息 → 各真实现；mac-auth-query 非 darwin = false 兜底上报） */
function electronRouterHandle(ctx: SysContext, mods: ElectronSysModules): (msg: SysDownMsg) => boolean {
  return (msg) => {
    switch (msg.type) {
      case "sys-config":
        electronSysConfig(ctx, mods, msg);
        return true;
      case "sys-notify":
        mods.notify.show(msg.kind, msg.title, msg.body);
        return true;
      case "tts-speak":
        mods.tts.speak(msg.text);
        return true;
      case "dialog-request":
        mods.dialogs.request(msg);
        return true;
      case "dialog-cancel":
        mods.dialogs.cancel(msg.seq);
        return true;
      case "open-path":
        mods.openPath.open(msg.path);
        return true;
      case "mac-auth-query":
        if (!mods.macAuth) return false; // 非 darwin：类型在位面缺失 → runtime 兜底上报
        mods.macAuth.query(msg);
        return true;
      default:
        return false;
    }
  };
}

/** Electron 组合根（app ready 后调用；内部动态 import 各模块实现） */
export async function createElectronSys(
  ctx: SysContext,
  opts: { lang: Lang; getWindow: () => BrowserWindow | null },
): Promise<SysRouter> {
  const mods = await loadElectronModules(ctx, opts);
  const capsListeners: (() => void)[] = [];
  const router: SysRouter = {
    get caps(): readonly SysCap[] {
      return electronSysCaps(mods);
    },
    onCapsChange(cb: () => void): () => void {
      capsListeners.push(cb);
      return () => {
        const i = capsListeners.indexOf(cb);
        if (i >= 0) capsListeners.splice(i, 1);
      };
    },
    setLang(lang: Lang): void {
      mods.tray.setLang(lang);
    },
    setPetVisible(visible: boolean): void {
      mods.tray.setPetVisible(visible);
    },
    notify: mods.notify,
    handle: electronRouterHandle(ctx, mods),
    dispose: () => {
      mods.tray.dispose();
      mods.shortcuts.dispose();
      mods.dialogs.dispose();
      mods.macAuth?.dispose();
      mods.inputCount?.dispose();
    },
  };
  return router;
}

/** DeferredSys 初始能力位（electron 形态静态集——真集在 attach 后由 target.caps 呈现） */
export function electronDeferredCaps(): SysCap[] {
  const caps: SysCap[] = ["sys-tray", "sys-shortcut", "sys-notify", "sys-tts", "sys-dialog", "sys-open"];
  if (process.platform === "darwin") caps.push("mac-auth", "input-count");
  return caps;
}
