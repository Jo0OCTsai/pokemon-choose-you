/** ContextMenu（UIUX §3.2）：右键 ≤6 项（换目标 / 💬 对话[agentConfigured 才现] / 打开图鉴机页面 / 隐藏桌宠） */
import { isAgentConfigured } from "./chatbox.ts";
import { lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

export interface MenuActions {
  /** 「⇄ 换目标」= 打开快捷图鉴屏（渲染层内部动作，经注入避免模块耦合） */
  onSwitchTarget: () => void;
  /** 「💬 对话」= ChatBox 原位展开（注入避免与 chatbox 模块循环耦合） */
  onOpenChat: () => void;
}

let actions: MenuActions | null = null;

export function initMenu(deps: MenuActions): void {
  actions = deps;
}

export function showCtx(x: number, y: number): void {
  const set = lines(mirror.lang);
  const items: { label: string; action: () => void }[] = [
    { label: set.menuSwitch, action: () => actions?.onSwitchTarget() },
  ];
  // 条件项：配了 agent 才出现（快捷屏打开时不叠加——ChatBox 展开会被 openChat 拒绝，菜单直接不列）
  if (isAgentConfigured() && !mirror.quickOpen && !mirror.chatOpen) {
    items.push({ label: set.menuChat, action: () => actions?.onOpenChat() });
  }
  items.push(
    { label: set.menuOpenPage, action: () => void bridge.cmd("open-page") },
    { label: set.menuHide, action: () => void bridge.cmd("hide") },
  );
  refs.ctxMenu.replaceChildren(...items.map(ctxItem));
  refs.ctxMenu.style.left = `${String(Math.min(x, 180))}px`;
  refs.ctxMenu.style.top = `${String(Math.min(y, 220))}px`;
  refs.ctxMenu.classList.add("on");
}

function ctxItem(it: { label: string; action: () => void }): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = "ctx-item hit";
  el.textContent = it.label;
  el.addEventListener("click", () => {
    hideCtx();
    it.action();
  });
  return el;
}

function hideCtx(): void {
  refs.ctxMenu.classList.remove("on");
}

// 点击菜单外任意处收起（ChatBox 收起走 Esc/✕ 专径——桌面同款）
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest("#ctx-menu")) hideCtx();
});
