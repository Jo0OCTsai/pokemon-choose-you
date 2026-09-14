import { reactive } from "vue";
import { t } from "./i18n";

/** 菜单项：action 在菜单关闭后才执行，组件无需自理关闭时机 */
export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  action?: () => void;
}

/** 全局唯一菜单实例状态（App 壳与桌宠窗口各挂一个 DexContextMenu 渲染） */
export const ctxMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuItem[],
});

export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]) {
  if (!items.length) return;
  ctxMenu.x = e.clientX;
  ctxMenu.y = e.clientY;
  ctxMenu.items = items;
  ctxMenu.open = true;
}

export function closeContextMenu() {
  ctxMenu.open = false;
}

// ---- 剪贴板：优先 tauri 插件（WebView 里 navigator.clipboard 读取常被权限卡住），失败回落 Web API ----

export async function clipWrite(text: string): Promise<boolean> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

async function clipRead(): Promise<string | null> {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  } catch {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
}

/** 程序化改写输入框选中区：setRangeText + 补发 input 事件，v-model 跟随 */
function replaceSelection(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.focus();
  el.setRangeText(text, start, end, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 文本类输入控件才给编辑菜单（checkbox/radio/file 等无选区概念） */
function editableOf(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const el = target.closest("input, textarea");
  if (el instanceof HTMLInputElement) {
    const texty = ["text", "search", "number", "password", "email", "url", "tel", "date", "time", "datetime-local"];
    return texty.includes(el.type) && !el.disabled ? el : null;
  }
  return el instanceof HTMLTextAreaElement && !el.disabled ? el : null;
}

/**
 * 挂在 window 上的默认 contextmenu 处理：文本输入框弹「剪切/复制/粘贴/全选」。
 * 组件自带右键菜单的地方用 @contextmenu.prevent 抢先，这里检查 defaultPrevented 让位。
 */
export function openEditableContextMenu(e: MouseEvent) {
  if (e.defaultPrevented) return;
  const el = editableOf(e.target);
  if (!el) return;
  e.preventDefault();
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const selected = end > start;
  const ro = el.readOnly; // 只读框允许复制，剪切/粘贴禁用
  openContextMenu(e, [
    {
      key: "cut",
      label: t("ctx.cut"),
      disabled: !selected || ro,
      action: () => {
        void clipWrite(el.value.slice(start, end)).then((ok) => {
          if (ok) replaceSelection(el, "");
        });
      },
    },
    {
      key: "copy",
      label: t("ctx.copy"),
      disabled: !selected,
      action: () => void clipWrite(el.value.slice(start, end)),
    },
    {
      key: "paste",
      label: t("ctx.paste"),
      disabled: ro,
      action: () => {
        void clipRead().then((text) => {
          if (text != null) replaceSelection(el, text);
        });
      },
    },
    { key: "selectAll", label: t("ctx.selectAll"), action: () => el.select() },
  ]);
}
