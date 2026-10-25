/** PomoPill（UIUX §3.2）：番茄药丸 ⏸/▶/✔/🍦 + ☕ 休息态 + 倒计时（定宽防跳动） */
import { lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

export function refreshPill(
  task: { id: number | string; title: string } | null,
  pomo: { kind: string; msLeft: number } | null,
): void {
  const { pill, pillText, pillPause, pillResume, pillTrial } = refs;
  // 开关判定（主应用 parity）：pomodoro_enabled=false 时整个胶囊不显示，与有无任务无关；
  // ChatBox 展开时隐藏——药丸位（精灵头顶）被聊天面板占用，进度仍有色环传达
  pill.classList.toggle("on", !!task && mirror.pomoEnabled && !mirror.chatOpen);
  if (!task || !mirror.pomoEnabled || mirror.chatOpen) return;
  const paused = mirror.petState.base === "paused";
  pill.classList.toggle("paused", paused);
  pill.classList.toggle("break", pomo?.kind === "break");
  pillPause.classList.toggle("on", !paused);
  pillResume.classList.toggle("on", paused);
  pillTrial.classList.toggle("on", paused && !pomo);
  pillText.textContent = pomo ? pomoText(pomo) : "🍅";
  applyTitles();
}

function pomoText(pomo: { kind: string; msLeft: number }): string {
  const total = Math.ceil(pomo.msLeft / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${pomo.kind === "break" ? "☕" : "🍅"} ${mm}:${ss}`;
}

function applyTitles(): void {
  const set = lines(mirror.lang);
  refs.pillPause.title = set.pillPause;
  refs.pillResume.title = set.pillResume;
  refs.pillDone.title = set.pillDone;
  refs.pillTrial.title = set.pillTrial;
}

refs.pillPause.addEventListener("click", () => void bridge.cmd("pause"));
refs.pillResume.addEventListener("click", () => void bridge.cmd("resume"));
refs.pillDone.addEventListener("click", () => void bridge.complete());
refs.pillTrial.addEventListener("click", () => void bridge.pomo("trial"));
