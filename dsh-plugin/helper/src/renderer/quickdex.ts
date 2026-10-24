/** QuickDexScreen（UIUX §3.2）：悬停 ☰ 唤出 LCD 今日列表（300↔590 宽翻转），点选「▶ 出发」 */
import type { QuickTask } from "../bridge/protocol.ts";
import { showDialog } from "./dialog.ts";
import { lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

export function refreshQuick(): void {
  const set = lines(mirror.lang);
  refs.quickEmpty.textContent = set.quickEmpty;
  refs.quickEmpty.classList.toggle("on", mirror.todayTasks.length === 0);
  refs.quickList.replaceChildren(...mirror.todayTasks.map((t) => quickRow(t, set.menuSwitch)));
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

export function toggleQuick(open?: boolean): void {
  const next = open ?? !refs.quickDex.classList.contains("on");
  refs.quickDex.classList.toggle("on", next);
  mirror.quickOpen = next;
  void bridge.quickSize(next); // 300 ↔ 590 宽翻转（主进程 setSize，左缘不动）
}

refs.quickFab.addEventListener("click", () => toggleQuick());
refs.quickClose.addEventListener("click", () => toggleQuick(false));
