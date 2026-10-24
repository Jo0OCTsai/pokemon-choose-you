/**
 * 系统托盘（FR-A1）：Tray 常驻 + tooltip（host 组装经 sys-config 下发）+ 左键打开图鉴机 +
 * 右键四项菜单三语（打开图鉴机 / 显示·隐藏桌宠 / 设置 / 退出[确认一次]）→ 上行 tray-action。
 * 图标用既有精灵剪影资产（dist/renderer/pokemon/pikachu.gif——分发口径单源，NFR-9）。
 * headless = no-op 记录器（可编程：click 模拟动作、pickQuit 模拟退出确认）。
 */
import type { Lang } from "../bridge/protocol.ts";
import type { SysContext } from "./context.ts";
import { defaultTooltip, trayLabels } from "./labels.ts";

export interface TrayModule {
  setTooltip(tooltip: string): void;
  setLang(lang: Lang): void;
  /** 桌宠可见性（「显示/隐藏桌宠」label 翻转；runtime 维护乐观跟踪） */
  setPetVisible(visible: boolean): void;
  dispose(): void;
}

/** headless 记录器（测试可编程） */
export class HeadlessTray implements TrayModule {
  readonly records: { lang: Lang; visible: boolean; actions: string[]; tooltip: string } = {
    tooltip: defaultTooltip("zh-Hans"),
    lang: "zh-Hans",
    visible: true,
    actions: [],
  };
  private explicitTooltip: string | null = null;
  private readonly ctx: SysContext;

  // 显式字段赋值（Node 24 strip-only 不支持参数属性语法）
  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  setTooltip(tooltip: string): void {
    this.explicitTooltip = tooltip;
    this.records.tooltip = tooltip;
  }

  setLang(lang: Lang): void {
    this.records.lang = lang;
    // 显式 tooltip（sys-config 下发）不因 lang 切换丢失；未下发才用缺省回退
    this.records.tooltip = this.explicitTooltip ?? defaultTooltip(lang);
  }

  setPetVisible(visible: boolean): void {
    this.records.visible = visible;
  }

  /** 模拟菜单/左键动作（quit 需确认——pickQuit 单独模拟） */
  click(action: "open" | "pet-toggle" | "settings"): void {
    this.records.actions.push(action);
    this.ctx.emit({ type: "tray-action", action });
  }

  /** 模拟「退出」项的一次确认（confirm=false = 用户取消） */
  pickQuit(confirm: boolean): void {
    if (!confirm) return;
    this.records.actions.push("quit");
    this.ctx.emit({ type: "tray-action", action: "quit" });
  }

  dispose(): void {
    /* no-op */
  }
}

/** 退出一次确认对话框（误点代价高——helper 连同桌宠与托盘退出，宿主不受影响） */
function makeQuitConfirm(
  dialog: (typeof import("electron"))["dialog"],
  langOf: () => Lang,
  emitAction: (action: "quit") => void,
): () => void {
  return () => {
    const set = trayLabels(langOf());
    void dialog
      .showMessageBox({
        type: "question",
        buttons: [set.quitCancel, set.quitOk],
        defaultId: 1,
        cancelId: 0,
        title: set.quitTitle,
        message: set.quitMessage,
      })
      .then((r) => {
        if (r.response === 1) emitAction("quit");
      })
      .catch(() => undefined);
  };
}

/** 右键菜单构建器（lang/visible 当前值驱动重建；每项点击 → tray-action 上行） */
function makeMenuBuilder(
  Menu: (typeof import("electron"))["Menu"],
  state: { lang: Lang; visible: boolean },
  emitAction: (action: "open" | "pet-toggle" | "settings") => void,
  confirmQuit: () => void,
): () => ReturnType<typeof Menu.buildFromTemplate> {
  return () => {
    const set = trayLabels(state.lang);
    return Menu.buildFromTemplate([
      { label: set.open, click: () => emitAction("open") },
      { label: state.visible ? set.hidePet : set.showPet, click: () => emitAction("pet-toggle") },
      { label: set.settings, click: () => emitAction("settings") },
      { type: "separator" },
      { label: set.quit, click: () => confirmQuit() },
    ]);
  };
}

/** Electron 实现（动态 import——headless 主链路零 electron 触碰；Tray 须 app ready 后创建） */
export async function createElectronTray(ctx: SysContext, opts: { lang: Lang }): Promise<TrayModule> {
  const { Tray, Menu, nativeImage, dialog } = await import("electron");
  const image = nativeImage.createFromPath(`${__dirname}/renderer/pokemon/pikachu.gif`).resize({ width: 20 });
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);

  const state = { tooltip: defaultTooltip(opts.lang), lang: opts.lang, visible: true };

  const emitAction = (action: "open" | "pet-toggle" | "settings" | "quit"): void => {
    ctx.emit({ type: "tray-action", action });
  };
  const confirmQuit = makeQuitConfirm(dialog, () => state.lang, emitAction);
  const buildMenu = makeMenuBuilder(Menu, state, emitAction, confirmQuit);

  let menu = buildMenu();
  tray.setToolTip(state.tooltip);
  // 左键 = 打开图鉴机；右键 = 弹菜单（FR-A1）
  tray.on("click", () => emitAction("open"));
  tray.on("right-click", () => tray.popUpContextMenu(menu));

  return {
    setTooltip(tooltip: string): void {
      state.tooltip = tooltip;
      tray.setToolTip(tooltip);
    },
    setLang(lang: Lang): void {
      state.lang = lang;
      menu = buildMenu();
    },
    setPetVisible(visible: boolean): void {
      state.visible = visible;
      menu = buildMenu();
    },
    dispose(): void {
      tray.destroy();
    },
  };
}
