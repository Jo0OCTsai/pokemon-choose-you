/**
 * ChatBox（FR-A8，语义移植 composables/usePetChat）：右键菜单「💬 对话」展开 ≤4 行
 * （标题行 + 最近回答 + 思考点 + 输入行(≤200 字) + 快捷 chips）；展开调高（窗体底缘不动
 * 向上长——精灵不动，面板悬在精灵上方）、Esc/✕ 收起；问题经桥 cmd.pet-chat 上行
 * （host onPetChat 执行）→ chat-reply 下发（回答截前 2 句 host 侧完成）；失败气泡回退；
 * 历史内存 3 条不持久化。文本渲染一律 textContent（桥文本不视为可信——纵深防御红线）。
 */
import { CHAT_HISTORY_MAX, CHAT_MAX_QUESTION, chatQuestion, pushChatEntry, type ChatEntry } from "../state/chatLog.ts";
import { fill, lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";
import { hideDialog } from "./dialog.ts";

const bridge = window.petBridge;

/** agentConfigured 条件（FR-A8：配了 agent 才出现）——sys-config.pet.agentConfigured 下行投影 */
export function isAgentConfigured(): boolean {
  return mirror.petConfig.agentConfigured;
}

let log: ChatEntry[] = [];
let thinking = false;

export function isChatOpen(): boolean {
  return mirror.chatOpen;
}

export function openChat(): void {
  if (mirror.chatOpen || mirror.sceneBusy || mirror.quickOpen) return; // 演出/快捷屏优先
  mirror.chatOpen = true;
  refs.chatBox.classList.add("on");
  refs.pill.classList.remove("on"); // 药丸位让给聊天面板（收起后由秒级快照 tick 依 chatOpen 恢复）
  void bridge.chatSize(true);
  if (log.length === 0) appendEntry({ role: "bot", text: lines(mirror.lang).chatGreet });
  renderLog();
  refs.chatInput.focus();
}

export function closeChat(): void {
  if (!mirror.chatOpen) return;
  mirror.chatOpen = false;
  refs.chatBox.classList.remove("on");
  void bridge.chatSize(false);
  hideBubbleLeftover();
}

/** 收起对话时顺带清掉残留气泡（桌面 usePetChat.closeChat 同款） */
function hideBubbleLeftover(): void {
  hideDialog();
}

export function handleChatReply(text: string, ok: boolean): void {
  thinking = false;
  const set = lines(mirror.lang);
  appendEntry(ok && text ? { role: "bot", text } : { role: "bot", text: fill(set.chatFail, { p: pokemonHe() }) });
  renderLog();
}

function pokemonHe(): string {
  return mirror.lastTask?.categoryPokemon ? mirror.lastTask.categoryPokemon : "皮卡丘";
}

function appendEntry(entry: ChatEntry): void {
  log = pushChatEntry(log, entry);
}

function renderLog(): void {
  const rows: HTMLElement[] = log.map(entryEl);
  if (thinking) rows.push(thinkingEl());
  refs.chatLog.replaceChildren(...rows);
  refs.chatLog.scrollTop = refs.chatLog.scrollHeight;
}

function entryEl(entry: ChatEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `chat-entry ${entry.role}`;
  el.textContent = entry.text; // 红线：textContent——chat-reply 文本不视为可信
  return el;
}

function thinkingEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "chat-entry bot thinking";
  el.textContent = fill(lines(mirror.lang).chatThinking, { p: pokemonHe() });
  const dots = document.createElement("span");
  dots.className = "chat-dots";
  dots.setAttribute("aria-hidden", "true");
  el.append(dots);
  return el;
}

function sendChat(): void {
  const q = chatQuestion(refs.chatInput.value);
  if (q === null || thinking) return; // 空/超 200 字（maxlength 兜底 + 校验双闸）
  refs.chatInput.value = "";
  appendEntry({ role: "user", text: q });
  thinking = true;
  renderLog();
  void bridge.cmd("pet-chat", { text: q });
}

export function initChatBox(): void {
  refs.chatSend.addEventListener("click", () => sendChat());
  refs.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
  });
  refs.chatClose.addEventListener("click", () => closeChat());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mirror.chatOpen) closeChat();
  });
  // 快捷 chips：预填输入行（≤200 校验在 send 闸）——UIUX §8「连胜几天了？/接下来做什么？/今天辛苦了」
  for (const chip of refs.chatChips) {
    chip.addEventListener("click", () => {
      refs.chatInput.value = chip.textContent ?? "";
      refs.chatInput.focus();
    });
  }
  // 静态文案三语（lang 切换时由 renderer.ts 调 refreshChatStatic 重刷）
  refs.chatInput.maxLength = CHAT_MAX_QUESTION;
  refreshChatStatic();
}

export function refreshChatStatic(): void {
  const set = lines(mirror.lang);
  refs.chatTitle.textContent = set.menuChat; // 面板标题与右键菜单入口同文
  refs.chatInput.placeholder = set.chatPh;
  refs.chatSend.title = set.chatSend;
  refs.chatSend.textContent = set.chatSend;
  refs.chatClose.title = set.chatClose;
  const chips = set.chatChips;
  refs.chatChips.forEach((el, i) => {
    if (chips[i]) el.textContent = chips[i];
  });
}

export function chatDebugState(): { logLength: number; thinking: boolean; historyCap: number } {
  return { logLength: log.length, thinking, historyCap: CHAT_HISTORY_MAX };
}
