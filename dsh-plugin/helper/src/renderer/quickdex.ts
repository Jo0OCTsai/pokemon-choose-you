/** QuickDexScreen（UIUX §3.2）：悬停 ☰ 唤出 LCD 待捕列表（300↔590 宽翻转，精灵居左区不遮），点选「▶ 出发」 */
import type { QuickTask } from "../bridge/protocol.ts";
import { closeChat, isChatOpen } from "./chatbox.ts";
import { showDialog } from "./dialog.ts";
import { lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

/** 换目标模式（桌面 switcher 口径：滤掉当前任务、取前 8；浏览模式 = host open 前 12） */
let switching = false;

export function refreshQuick(): void {
  const set = lines(mirror.lang);
  const list = switching ? mirror.todayTasks.filter((t) => t.status !== "active").slice(0, 8) : mirror.todayTasks;
  refs.quickEmpty.textContent = set.quickEmpty;
  refs.quickEmpty.classList.toggle("on", list.length === 0);
  refs.quickList.replaceChildren(...list.map((t) => quickRow(t, set.menuSwitch)));
}

function quickRow(t: QuickTask, switchTitle: string): HTMLButtonElement {
  const row = document.createElement("button");
  row.className = `q-item hit${t.status === "active" ? " active" : ""}`;
  row.title = switchTitle;
  row.append(cursorEl(), titleEl(t.title), noEl(t.id));
  row.addEventListener("click", () => {
    void bridge.cmd("switch", { taskId: t.id });
    // 本地即时开场（宿主 ≤2s 回推 task-state 后 runtime 再发「{p}正在捕捉：{t}」）
    showDialog(lines(mirror.lang).chooseYou, { tone: "event" });
    toggleQuick(false);
  });
  return row;
}

function cursorEl(): HTMLElement {
  const cursor = document.createElement("span");
  cursor.className = "cursor px";
  cursor.textContent = "▶";
  return cursor;
}

function titleEl(title: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "q-title";
  el.textContent = title;
  return el;
}

function noEl(id: number | string): HTMLElement {
  const el = document.createElement("span");
  el.className = "px q-no";
  el.textContent = String(id).padStart(3, "0");
  return el;
}

export function toggleQuick(open?: boolean, opts: { switching?: boolean } = {}): void {
  switching = Boolean(opts.switching);
  const next = open ?? !refs.quickDex.classList.contains("on");
  if (next && isChatOpen()) closeChat(); // 与 ChatBox 互斥（菜单已挡，fab 路径兜底）
  refs.quickDex.classList.toggle("on", next);
  mirror.quickOpen = next;
  void bridge.quickSize(next); // 300 ↔ 590 宽翻转（主进程 setSize，左缘不动）
  if (next) refreshQuick();
}

refs.quickFab.addEventListener("click", () => toggleQuick());
refs.quickClose.addEventListener("click", () => toggleQuick(false));
