/**
 * headless sys 组合根（从 sys/index.ts 拆出——棘轮 max-lines，等量迁移；
 * sys/index.ts 为统一再出口，消费面不变）：no-op 记录器全家
 * （HELPER_HEADLESS=1 / 进程内测试；可编程结果）。
 */
import type { SysConfigMsg } from "../bridge/protocol.ts";
import type { SysContext } from "./context.ts";
import type { HeadlessSys, SysDownMsg } from "./index.ts";
import { HeadlessDialogs } from "./dialogs.ts";
import { HeadlessInputCount } from "./inputCount.ts";
import { HeadlessMacAuth } from "./macAuth.ts";
import { HeadlessNotify } from "./notify.ts";
import { HeadlessOpenPath } from "./openPath.ts";
import { HeadlessShortcuts } from "./shortcuts.ts";
import { HeadlessTray } from "./tray.ts";
import { HeadlessTts } from "./tts.ts";

/** headless 能力位恒定全集（八能力全声明——记录器永不缺位） */
const ALL_SYS_CAPS: readonly HeadlessSys["caps"][number][] = [
  "sys-tray",
  "sys-shortcut",
  "sys-notify",
  "sys-tts",
  "sys-dialog",
  "sys-open",
  "input-count",
  "mac-auth",
];

/** headless 下行分派器（七消息 → 各记录器面；未认识类型 = false） */
function headlessRouterHandle(
  mods: Pick<HeadlessSys, "tray" | "shortcuts" | "notify" | "tts" | "dialogs" | "openPath" | "macAuth" | "inputCount">,
): (msg: SysDownMsg) => boolean {
  return (msg) => {
    switch (msg.type) {
      case "sys-config":
        headlessSysConfig(mods, msg);
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
        mods.macAuth.query(msg);
        return true;
      default:
        return false;
    }
  };
}

/** headless sys-config 应用（tray/shortcuts/inputResponse/tts 各在位即配） */
function headlessSysConfig(
  mods: Pick<HeadlessSys, "tray" | "shortcuts" | "inputCount" | "macAuth" | "tts">,
  msg: SysConfigMsg,
): void {
  if (msg.tray) mods.tray.setTooltip(msg.tray.tooltip);
  if (msg.shortcuts) mods.shortcuts.configure(msg.shortcuts);
  if (msg.inputResponse) {
    mods.inputCount.configure(msg.inputResponse);
    mods.macAuth.watch(msg.inputResponse.enabled);
  }
  if (msg.tts) mods.tts.setEnabled(msg.tts.enabled);
}

export function createHeadlessSys(ctx: SysContext, opts: { axGranted?: boolean } = {}): HeadlessSys {
  const tray = new HeadlessTray(ctx);
  const shortcuts = new HeadlessShortcuts(ctx);
  const notify = new HeadlessNotify(ctx);
  const tts = new HeadlessTts(ctx);
  const dialogs = new HeadlessDialogs(ctx);
  const openPath = new HeadlessOpenPath(ctx);
  const macAuth = new HeadlessMacAuth(ctx, { granted: opts.axGranted });
  const inputCount = new HeadlessInputCount(ctx, { granted: opts.axGranted });
  macAuth.onAuthChange((granted) => inputCount.onAuthChange(granted));

  const sys: HeadlessSys = {
    tray,
    shortcuts,
    notify,
    tts,
    dialogs,
    openPath,
    macAuth,
    inputCount,
    caps: ALL_SYS_CAPS,
    onCapsChange: () => () => undefined, // headless 能力位恒定（返回退订 no-op）
    setLang: (lang) => tray.setLang(lang),
    setPetVisible: (visible) => tray.setPetVisible(visible),
    handle: headlessRouterHandle({ tray, shortcuts, notify, tts, dialogs, openPath, macAuth, inputCount }),
    dispose: () => {
      tray.dispose();
      shortcuts.dispose();
      inputCount.dispose();
      macAuth.dispose();
    },
  };
  return sys;
}
