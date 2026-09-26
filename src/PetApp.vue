<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { EVENTS } from "./events";
import type { Task } from "./types";
import { useI18n } from "vue-i18n";
import { pokemonName, randomQuote } from "./pokemon";
import { useSettingsStore } from "./stores/settings";
import { useCategoriesStore } from "./stores/categories";
import { usePomodoro } from "./composables/usePomodoro";
import { usePetDrag } from "./composables/usePetDrag";
import { usePetClickThrough } from "./composables/usePetClickThrough";
import { motionReduced, usePetIdle, type PetMicroAction } from "./composables/usePetIdle";
import { shouldPerch } from "./composables/usePerch";
import { lineDedupKey, pickTimeLine } from "./composables/useTimeLines";
import { usePetBubble } from "./composables/usePetBubble";
import { usePetChat } from "./composables/usePetChat";
import { useCatchScene } from "./composables/useCatchScene";
import { useInputResponse } from "./composables/useInputResponse";
import { openContextMenu, type ContextMenuItem } from "./contextMenu";
import PokemonSprite from "./components/PokemonSprite.vue";
import DexContextMenu from "./components/DexContextMenu.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();

const petWindow = getCurrentWindow();

// ---- 桌宠状态机：idle / working / paused / urgent / asleep（PET_INTERACTION_DESIGN §3.2） ----
const current = ref<Task | null>(null);
const petState = ref<"idle" | "working" | "paused" | "urgent" | "asleep">("idle");

// ---- 环境化倒计时：随剩余时间渐变的色环 + 尾段焦急小动作（时间盲友好） ----
/** 剩余比例（专注运行中 0~1；非运行态为 null 隐藏色环） */
const ringPct = computed(() => {
  if (!pomo.running.value || pomo.phase.value !== "focus" || pomo.totalSec.value <= 0) return null;
  return Math.max(0, Math.min(1, pomo.remainSec.value / pomo.totalSec.value));
});
const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R;
const ringColor = computed(() => {
  const p = ringPct.value ?? 1;
  // 全部走令牌：绿=LED 高亮绿 · 琥珀=优先级高橙 · 红=行动红
  if (p > 0.5) return "var(--ok-bright)";
  if (p > 0.25) return "var(--p-high)";
  return "var(--danger)";
});
/** 尾段（剩 ≤5 分钟或 ≤20%）精灵焦急：蹦跳加速 */
const anxious = computed(() => {
  if (ringPct.value == null) return false;
  return pomo.remainSec.value <= Math.max(300, pomo.totalSec.value * 0.2);
});
// ---- 瞬态台词气泡（VPet 范式）：说完自动淡出，悬停暂停、点击收起；状态不占常驻文字（usePetBubble） ----
const switching = ref(false);
const quickOpen = ref(false);
const {
  bubble,
  bubbleVisible,
  bubbleFading,
  bubbleNew,
  showBubble,
  say,
  flashNew,
  dismissBubble,
  pauseBubbleCountdown,
  resumeBubbleCountdown,
  hideBubble,
} = usePetBubble({
  isChatOpen: () => chatOpen.value,
  isQuickOpen: () => quickOpen.value,
  // 点击收起时顺带消化钉住的提醒（提醒域留在组件内）
  onDismiss: () => {
    if (reminderTask.value) {
      reminderTask.value = null;
      clearTimeout(reminderTimer);
    }
  },
});

const currentCat = computed(() => categories.byId.get(current.value?.categoryId ?? -1) ?? categories.list[0]);
/** 桌宠当前精灵：进行中用任务分类的宝可梦；空闲用主宝可梦（只换精灵图，不进文案；未设置跟随第一个分类） */
const petSprite = computed(() => {
  if (current.value) return currentCat.value?.sprite ?? "pikachu";
  return settings.sget("main_pokemon") || currentCat.value?.sprite || "pikachu";
});

// ---- 番茄钟（时长/开关/休息/通知均由设置中心控制） ----
const pomo = usePomodoro({
  currentId: () => current.value?.id ?? null,
  currentTitle: () => current.value?.title ?? "",
  // 系统通知正文带上当前分类的宝可梦名（任务相关文案个性化）
  currentPokemon: () => currentCat.value?.pokemon ?? "",
  onFocusDone: (title, trialDone) => {
    petState.value = "urgent";
    // 「先试 5 分钟」到期：零挫败出口——继续或收工都被肯定
    say(trialDone ? t("pet.trialDone") : t("pet.pomoDone", { t: title, p: currentCat.value?.pokemon ?? "" }), true);
  },
  onBreakStart: () => say(t("pet.breakStart"), true),
  onBreakEnd: () => {
    petState.value = "working";
    say(t("pet.breakEnd"));
  },
});

/** 「先试 5 分钟」：卡在启动上时的零挫败入场券 */
function startTrial() {
  if (!current.value) return;
  pomo.startTrial();
  say(t("pet.trialStart"));
}

/** 状态切换播报：只在状态或任务变化时说一次；日常状态由精灵动画与番茄药丸承载 */
function announceState(state: "idle" | "working" | "paused") {
  if (chatOpen.value) return;
  if (state === "idle") say(t("pet.idle"));
  else if (state === "working")
    say(t("pet.working", { p: currentCat.value?.pokemon ?? "", t: current.value?.title ?? "" }), true);
  else say(t("pet.paused", { p: currentCat.value?.pokemon ?? "" }));
}

async function refreshCurrent() {
  const prevId = current.value?.id ?? null;
  const prevState = petState.value;
  current.value = await api.getCurrentTask();
  if (!current.value) {
    pomo.stop();
  } else if (current.value.id !== prevId && pomo.enabled()) {
    // 活动任务换了（本窗口切换，或主程序开始/完成、外部同步）→ 番茄钟跟随新任务
    pomo.start();
  }
  const state = !current.value ? "idle" : pomo.running.value ? "working" : "paused";
  petState.value = state;
  // 状态或任务切换才播报一次（urgent 等演出态由下一次刷新收敛）
  if (state !== prevState || (current.value != null && current.value.id !== prevId)) {
    announceState(state);
  }
  if (quickOpen.value) await loadQuickList();
}

async function pauseTask() {
  pomo.stop();
  await api.pauseCurrentTask();
  await refreshCurrent();
}

async function doneTask() {
  if (!current.value || sceneBusy.value) return;
  const task = current.value;
  const pokemon = currentCat.value?.pokemon ?? "";
  pomo.stop();
  sceneBusy.value = true; // 先占住防连点，演出接管后统一释放
  const [statsBefore, streakBefore] = await Promise.all([
    api.dexStats().catch(() => null),
    api.taskStreak().catch(() => null),
  ]);
  await api.updateTask({ id: task.id, status: "done" });
  await refreshCurrent();
  const [statsAfter, streakAfter] = await Promise.all([
    api.dexStats().catch(() => null),
    api.taskStreak().catch(() => null),
  ]);
  const openCount = await api
    .listTasks("open")
    .then((l) => l.length)
    .catch(() => 1);
  const milestone = milestoneCrossed(statsBefore?.caught, statsAfter?.caught);
  const allDone = !current.value && openCount === 0;
  const streak = streakToShow(milestone, streakBefore, streakAfter);
  await runCatchScene({ pokemon, title: task.title, milestone, allDone, streak });
}

/** 里程碑档位：累计捕捉跨过任一阈值时返回该阈值 */
function milestoneCrossed(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || after <= before) return null;
  for (const m of [10, 50, 100, 200, 500, 1000]) {
    if (before < m && after >= m) return m;
  }
  return null;
}

/** 语音（F5）：只接四类「郑重时刻」，默认静音；失败静默（锦上添花不阻塞气泡） */
function speak(text: string) {
  if (settings.bool("pet_voice")) void api.petSpeak(text).catch(() => {});
}

/** 连胜演出触发（F7）：连胜 ≥3 天且这次捕捉是今天的第一只（里程碑优先，互不叠加） */
function streakToShow(
  milestone: number | null,
  before: { days: number; todayCount: number } | null,
  after: { days: number; todayCount: number } | null,
): number | null {
  if (milestone != null || !before || !after) return null;
  if (before.todayCount === 0 && after.todayCount > 0 && after.days >= 3) return after.days;
  return null;
}

async function switchTo(task: Task) {
  await api.startTask(task.id);
  switching.value = false;
  await refreshCurrent();
}

async function resume() {
  if (current.value) {
    await api.startTask(current.value.id);
    if (pomo.enabled()) pomo.start();
  }
}

// ---- 待切换任务列表 ----
const candidates = ref<Task[]>([]);
async function openSwitcher() {
  await loadQuickList();
  candidates.value = candidates.value.filter((t) => t.id !== current.value?.id).slice(0, 8);
  switching.value = true;
}
async function loadQuickList() {
  candidates.value = (await api.listTasks("open")).slice(0, 12);
}
const quickSel = ref<number | null>(null);

async function toggleQuick() {
  quickOpen.value = !quickOpen.value;
  // 展开前先回应一跳（juice：让它知道你点了它）
  runMicro("hop");
  if (quickOpen.value) {
    await loadQuickList();
    quickSel.value = current.value?.id ?? null;
    // 一半概率出引导，一半概率出随机撸宠台词（当前展示的宝可梦有自定义台词则优先）
    say(Math.random() < 0.5 ? t("pet.quickPick") : randomQuote(petSprite.value), true);
  } else {
    say(randomQuote(petSprite.value));
  }
  // 展开时把窗口调高，收起恢复（透明窗口，多余高度不可见；快捷屏优先于对话态）
  await resizePetWindow();
}
async function quickStart(id: number) {
  const taskTitle = candidates.value.find((x) => x.id === id)?.title;
  await api.startTask(id);
  await refreshCurrent();
  if (pomo.enabled()) pomo.start();
  say(t("pet.gotcha", { t: taskTitle ?? "" }), true);
}
function quickStartSel() {
  if (quickSel.value != null) {
    quickStart(quickSel.value);
  } else {
    // 没选中目标时给出提示，而不是无声无息
    say(t("pet.quickPick"));
  }
}

const openPanel = async () => {
  try {
    // 已存在则恢复置前（含最小化），被关闭过则由后端重建
    await api.openMainWindow();
  } catch {
    /* 打开失败时静默，双击重试即可 */
  }
};

// ---- 单击/双击/长按三分（单击=随机搭话，双击=图鉴机，长按 600ms=撸宠；快捷屏由悬停 ☰ 钮唤出） ----
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let lastPetAt = 0;
function onSpriteClick() {
  // 长按撸宠刚触发过 → 抬手这次 click 不再搭话
  if (Date.now() - lastPetAt < 800) return;
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    say(randomQuote(petSprite.value));
  }, 250);
}
async function onSpriteDblClick() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  await openPanel();
}

// ---- 长按撸宠：按住 600ms 未移动 → 纯情绪交互，不打开任何面板 ----
const petted = ref(false);
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdStart: { x: number; y: number } | null = null;
function petTheSprite() {
  lastPetAt = Date.now();
  onStageDragEnd(); // 长按期间取消窗口拖拽预备
  petted.value = true;
  setTimeout(() => (petted.value = false), 900);
  say(t("pet.petted", { p: currentCat.value?.pokemon ?? "" }), true);
}
function onSpritePointerDown(e: PointerEvent) {
  markActivity();
  if (e.button !== 0) return;
  holdStart = { x: e.clientX, y: e.clientY };
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (holdStart === null) return;
    holdStart = null;
    petTheSprite();
  }, 600);
}
function onSpritePointerMove(e: PointerEvent) {
  if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 6) {
    holdStart = null;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }
}
function onSpritePointerUp() {
  holdStart = null;
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

// ---- 手动拖拽（Linux/WebKit 下 data-tauri-drag-region 不可靠）+ 悬挂物理 ----
const { onDragStart, onDragMove, onDragEnd } = usePetDrag(petWindow);
/** 拖拽物理态：hold（悬挂小碎步）→ release（落地挤压回弹） */
const dragPhys = ref<null | "hold" | "release">(null);
let pressPt: { x: number; y: number } | null = null;
function onStageDragStart(e: MouseEvent) {
  markActivity();
  pressPt = { x: e.screenX, y: e.screenY };
  perched.value = false; // 拎起来即离开栖息姿态
  onDragStart(e);
}
function onStageDragMove(e: MouseEvent) {
  if (pressPt && dragPhys.value === null && Math.abs(e.screenX - pressPt.x) + Math.abs(e.screenY - pressPt.y) > 6) {
    dragPhys.value = "hold";
    say(t("pet.beingCarried"));
  }
  onDragMove(e);
}
function onStageDragEnd() {
  onDragEnd();
  pressPt = null;
  if (dragPhys.value === "hold") {
    dragPhys.value = "release";
    say(t("pet.dropped"), true);
    setTimeout(() => {
      if (dragPhys.value === "release") dragPhys.value = null;
    }, 420);
    // 松手落定后判栖息：窗口底边进了任务栏 / Dock 一带（≤72px）就坐下
    setTimeout(() => void checkPerch(false), 480);
  }
}

// ---- 屏幕边缘栖息（F4）：底缘一带切坐/趴（动画幅度减半），拖离自动恢复 ----
const perched = ref(false);
async function checkPerch(announce: boolean) {
  try {
    const mon = await currentMonitor();
    if (!mon) return;
    const [pos, size] = await Promise.all([petWindow.outerPosition(), petWindow.outerSize()]);
    const scale = mon.scaleFactor || 1;
    const wasPerched = perched.value;
    perched.value = shouldPerch(pos.y + size.height, mon.workArea.position.y + mon.workArea.size.height, 72 * scale);
    if (perched.value && !wasPerched) {
      runMicro("sit");
      if (announce) say(t("pet.perched"), true);
      else setTimeout(() => say(t("pet.perched"), true), 600);
    }
  } catch {
    /* 非桌面 / 测试环境静默 */
  }
}

/** 演出进行中任意按下 = 跳过（回应不打扰：演出永不绑架用户时间） */
function onStagePointerDownCapture() {
  requestSkip();
}

// ---- 生命感调度器：idle 低频微动作（PET_INTERACTION_DESIGN §3.4） ----
const microCls = ref<string | null>(null);
let microTimer: ReturnType<typeof setTimeout> | null = null;
const MICRO_DUR: Record<string, number> = {
  blink: 240,
  look: 1000,
  flip: 1200,
  yawn: 900,
  wake: 650,
  hop: 550,
  earwig: 120, // 输入响应微抖（F1）
  sit: 420, // 落座挤压回弹（F4）
};
function runMicro(action: PetMicroAction | "wake" | "hop" | "earwig" | "sit") {
  if (sceneBusy.value || microCls.value !== null || dragPhys.value !== null || petState.value === "asleep") return;
  microCls.value = `ma-${action}`;
  if (microTimer) clearTimeout(microTimer);
  microTimer = setTimeout(
    () => {
      microCls.value = null;
    },
    motionReduced() ? 0 : (MICRO_DUR[action] ?? 400),
  );
}
const idleCtl = usePetIdle({
  isBusy: () =>
    sceneBusy.value ||
    microCls.value !== null ||
    petted.value ||
    dragPhys.value !== null ||
    quickOpen.value ||
    switching.value ||
    petState.value === "asleep",
  isWorking: () => petState.value === "working" || petState.value === "urgent",
  trigger: (a) => runMicro(a),
});

// ---- 输入响应（F1）：消费全局活动强度事件（Rust 侧只发每秒计数） ----
const hopScale = ref<number | null>(null);
const irCtl = useInputResponse({
  isEnabled: () => settings.bool("pet_input_response"),
  isWorking: () => petState.value === "working" || petState.value === "urgent",
  isWorkingCoupled: () => settings.bool("pet_input_response_working"),
  isBusy: () =>
    sceneBusy.value ||
    microCls.value !== null ||
    dragPhys.value !== null ||
    petted.value ||
    quickOpen.value ||
    switching.value ||
    chatOpen.value ||
    petState.value === "asleep",
  onWiggle: () => runMicro("earwig"),
  onNotice: () => runMicro("look"),
  onDoze: () => runMicro(Math.random() < 0.5 ? "yawn" : "look"),
  onHopScale: (s) => (hopScale.value = s),
});

// ---- 时刻台词（F3）：整点/深夜/周五晚/精灵生日，每类每周期只说一次 ----
let metAt = Date.now();
try {
  const first = localStorage.getItem("pet.metOn");
  if (first) metAt = Number(first) || Date.now();
  else localStorage.setItem("pet.metOn", String(Date.now()));
} catch {
  /* 存储不可用时跳过生日台词 */
}
const birthday = (() => {
  const d = new Date(metAt);
  return Number.isFinite(metAt) && metAt > 0 ? { month: d.getMonth() + 1, day: d.getDate() } : null;
})();
let lineTimer: ReturnType<typeof setInterval> | null = null;
function checkTimeLines() {
  if (
    petState.value === "asleep" ||
    petState.value === "urgent" ||
    chatOpen.value ||
    sceneBusy.value ||
    quickOpen.value ||
    switching.value ||
    reminderTask.value ||
    dragPhys.value !== null
  )
    return;
  const now = new Date();
  const key = pickTimeLine(now, { birthday });
  if (!key) return;
  const dk = lineDedupKey(key, now);
  try {
    if (localStorage.getItem(dk) !== null) return;
    localStorage.setItem(dk, "1");
  } catch {
    return;
  }
  if (key === "birthday") {
    const days = Math.max(1, Math.floor((Date.now() - metAt) / 86_400_000));
    const line = t("pet.birthdayLine", { n: days });
    say(line, true);
    runMicro("hop");
    burstStars(3);
    speak(line);
  } else if (key === "night") {
    say(t("pet.nightLine"), true);
  } else if (key === "friday") {
    say(t("pet.fridayLine"), true);
  } else {
    say(t("pet.hourLine"), true);
  }
}

// ---- 陪跑精灵（F6）：专注满 25 分钟一位客人来旁陪坐（默认关；零台词零闪烁零数值） ----
const mate = ref<null | { sprite: string; phase: "walk" | "sit" | "wave" }>(null);
let mateShownThisSession = false;
const focusElapsedSec = computed(() =>
  pomo.running.value && pomo.phase.value === "focus" ? pomo.totalSec.value - pomo.remainSec.value : 0,
);
watch(focusElapsedSec, (s) => {
  if (mate.value || mateShownThisSession || s < 25 * 60) return;
  if (!settings.bool("pet_mate") || petState.value !== "working") return;
  mateShownThisSession = true; // 一次会话最多一位、只出现一次
  void inviteMate();
});
watch(
  () => pomo.running.value,
  (run, was) => {
    if (!run && was) mateShownThisSession = false; // 会话结束重置，下一场专注可再请
  },
);
async function inviteMate() {
  let pool: string[] = [];
  try {
    pool = (await api.dexStats()).sprites ?? [];
  } catch {
    /* 图鉴不可用 → 回退伊布 */
  }
  const exclude = new Set([petSprite.value, settings.sget("main_pokemon")]);
  const candidates = pool.filter((s) => s && !exclude.has(s));
  const sprite = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : "eevee";
  mate.value = { sprite, phase: motionReduced() ? "sit" : "walk" };
  if (!motionReduced()) {
    setTimeout(() => {
      if (mate.value?.phase === "walk") mate.value.phase = "sit";
    }, 650);
  }
}
function onMateLeave() {
  if (!mate.value || mate.value.phase === "wave") return;
  mate.value.phase = "wave";
  setTimeout(() => (mate.value = null), motionReduced() ? 0 : 620);
}

// ---- AI 对话（F2）：右键菜单入口（配了 agent 才出现），对话框原位展开 ≤4 行（usePetChat） ----
// 输入行模板 ref 由 usePetChat 内 useTemplateRef("chatInputRef") 接管
const { chatOpen, chatLog, chatThinking, chatInput, agentConfigured, resizePetWindow, openChat, closeChat, sendChat } =
  usePetChat({
    petWindow,
    isSceneBusy: () => sceneBusy.value,
    isQuickOpen: () => quickOpen.value,
    hideBubble,
    flashNew,
    speak,
  });

/** 精灵类：微动作/演出期间替换状态循环动画（JS 层互斥，避免 CSS 优先级缠斗） */
const spriteClass = computed(() => {
  const cls: Record<string, boolean> = {
    petted: petted.value,
    anxious: anxious.value && microCls.value === null && !sceneBusy.value,
    holding: dragPhys.value === "hold",
    released: dragPhys.value === "release",
    "catch-prep": catchPhase.value === "prep",
    "catch-hide": catchPhase.value === "hide",
    perched: perched.value && dragPhys.value === null,
    listening: chatOpen.value,
  };
  if (microCls.value) cls[microCls.value] = true;
  else cls[petState.value] = true;
  return cls;
});

/** working 态输入响应的节奏耦合（F1）：hop 时长轻缩放（≤+10%），非专注/焦急态恢复默认 */
const hopStyle = computed(() => {
  if (hopScale.value == null || petState.value !== "working" || anxious.value || microCls.value !== null) return {};
  return { animationDuration: `${(1.6 * hopScale.value).toFixed(3)}s` };
});

// ---- 睡觉与醒来（P3 简化版：无进行中任务且窗口 5 分钟无交互 → 打盹） ----
const SLEEP_AFTER_MS = 5 * 60_000;
let lastActive = Date.now();
let sleepTimer: ReturnType<typeof setInterval> | null = null;
function markActivity() {
  lastActive = Date.now();
  if (petState.value === "asleep") {
    petState.value = "idle";
    runMicro("wake");
    say(t("pet.wakeUp", { p: currentCat.value?.pokemon ?? "" }), true);
  }
}
function checkSleep() {
  if (
    petState.value !== "idle" ||
    current.value ||
    quickOpen.value ||
    switching.value ||
    sceneBusy.value ||
    Date.now() - lastActive < SLEEP_AFTER_MS
  )
    return;
  petState.value = "asleep";
  bubbleNew.value = false;
  say(t("pet.asleepHint"));
}

/** keydown 统一入口：算作「还醒着」+ Esc 收起对话 */
function onWindowKeydown(e: KeyboardEvent) {
  markActivity();
  if (e.key === "Escape" && chatOpen.value) closeChat();
}

// ---- 捕捉演出（juice 三段式：预备 → 掷球 → 三摇 → 星星，≤1.5s 可跳过；连胜为双球变体 ≤2s） ----
const spriteHitRef = ref<HTMLElement | null>(null);

function burstStars(n: number) {
  if (motionReduced()) return;
  const host = spriteHitRef.value;
  if (!host) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "pk-star" + (n > 6 && i % 3 === 0 ? " big" : "");
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = 46 + Math.random() * 26;
    s.style.setProperty("--dx", `${Math.round(Math.cos(ang) * d)}px`);
    s.style.setProperty("--dy", `${Math.round(Math.sin(ang) * d - 14)}px`);
    host.appendChild(s);
    setTimeout(() => s.remove(), 450);
  }
}

const { sceneBusy, catchPhase, catchBalls, streakScene, runCatchScene, requestSkip } = useCatchScene({
  say,
  speak,
  burstStars,
  runMicro,
  hasMate: () => mate.value != null,
  onMateLeave,
});

// ---- 桌宠右键菜单：低频操作收纳处（⇄ 切换自药丸移入；💬 对话跟随 agent 配置） ----
function onPetContextMenu(e: MouseEvent) {
  e.preventDefault();
  const items: ContextMenuItem[] = [
    { key: "dex", label: t("pet.menuDex"), action: () => void openPanel() },
    {
      key: "quick",
      label: quickOpen.value ? t("pet.quickClose") : t("pet.menuQuick"),
      action: () => void toggleQuick(),
    },
  ];
  if (agentConfigured.value && !quickOpen.value) {
    items.push({ key: "chat", label: t("pet.menuChat"), action: openChat });
  }
  if (current.value) {
    items.push({ key: "switch", label: t("pet.menuSwitch"), action: () => void openSwitcher() });
    items.push({ key: "pause", label: t("pet.menuPause"), action: () => void pauseTask() });
  }
  items.push({ key: "hide", label: t("pet.menuHide"), action: () => void petWindow.hide() });
  openContextMenu(e, items);
}

// ---- 就近可操作提醒：气泡旁直接给动作，消化「提醒→完成」链路的第二步流失 ----
const reminderTask = ref<{ id: number; title: string; urgent: boolean; pokemon?: string | null } | null>(null);
let reminderTimer: ReturnType<typeof setTimeout> | undefined;

/** 就近完成：不打断当前专注（只有提醒的任务本身在进行中才切换气泡状态） */
async function completeFromReminder() {
  const r = reminderTask.value;
  if (!r) return;
  reminderTask.value = null;
  clearTimeout(reminderTimer);
  try {
    await api.updateTask({ id: r.id, status: "done" });
    burstStars(6);
    await refreshCurrent();
    // 刷新会把气泡重置为当前任务状态，确认文案放在刷新之后
    say(t("pet.reminderDone", { t: r.title, p: r.pokemon ?? "" }), true);
  } catch {
    hideBubble();
  }
}

/** 就近推迟 10 分钟：回写 remind_at（后端会重置 reminded，到点再敲一次门） */
async function snoozeFromReminder() {
  const r = reminderTask.value;
  if (!r) return;
  reminderTask.value = null;
  clearTimeout(reminderTimer);
  const d = new Date(Date.now() + 10 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  try {
    await api.updateTask({ id: r.id, remindAt: at });
    await refreshCurrent();
    say(t("pet.reminderSnoozed"));
  } catch {
    hideBubble();
  }
}

// ---- 时段问候：每天窗口首次出现说一次，只此一次（不打扰原则的例外清单） ----
function mainPokemonName() {
  return pokemonName(settings.sget("main_pokemon"), currentCat.value?.pokemon ?? "");
}
function greetOnce() {
  const key = "pet.greetedOn";
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch {
    return; // 存储不可用（如测试环境）→ 直接放弃问候
  }
  const h = new Date().getHours();
  const line =
    h >= 5 && h < 11
      ? t("pet.greetMorning", { p: mainPokemonName() })
      : h < 17
        ? t("pet.greetDay", { p: mainPokemonName() })
        : h < 23
          ? t("pet.greetEvening", { p: mainPokemonName() })
          : t("pet.greetNight", { p: mainPokemonName() });
  setTimeout(() => say(line, true), 800);
}

// 透明区域点击穿透：精灵两侧/快捷屏下方的空白放行给下层应用（见 composable 注释）
let disposeClickThrough: (() => void) | null = null;

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  disposeClickThrough = usePetClickThrough();
  await Promise.all([categories.load(), settings.load()]);
  await refreshCurrent();
  // 启动播报：无任务时欢迎一次（有任务已由状态切换播报 working）；日常无常驻文字
  if (!current.value) say(t("pet.welcome"), true);
  greetOnce();
  idleCtl.start();
  if (settings.bool("pet_input_response")) irCtl.start();
  setTimeout(() => void checkPerch(false), 600); // 启动时窗口记忆位置可能就在底缘
  lineTimer = setInterval(checkTimeLines, 30_000);
  setTimeout(checkTimeLines, 2500); // 问候之后不久补一次时刻检查
  // 睡眠检测：窗口内任何交互都算「还醒着」；Esc 收起对话
  window.addEventListener("pointermove", markActivity, { passive: true });
  window.addEventListener("pointerdown", markActivity, { passive: true });
  window.addEventListener("keydown", onWindowKeydown);
  sleepTimer = setInterval(checkSleep, 15_000);

  // 输入响应：后端每秒喂一次活动强度（只计数不取内容）
  unlisteners.push(await listen<{ cps: number }>(EVENTS.inputActivity, (e) => irCtl.feed(e.payload?.cps ?? 0)));

  unlisteners.push(
    await listen<{ id: number; title: string; urgent: boolean; pokemon?: string | null }>(EVENTS.taskReminder, (e) => {
      const p = e.payload.pokemon ?? "";
      petState.value = e.payload.urgent ? "urgent" : "working";
      // 就近可操作提醒：钉住不自动倒计时（悬停暂停不适用），点击气泡或动作按钮消化
      showBubble(
        e.payload.urgent
          ? t("pet.remindUrgent", { t: e.payload.title, p })
          : t("pet.remindNormal", { t: e.payload.title, p }),
        { isNew: true, pinned: true },
      );
      reminderTask.value = e.payload;
      clearTimeout(reminderTimer);
      reminderTimer = setTimeout(() => {
        reminderTask.value = null;
        hideBubble();
      }, 60_000);
    }),
  );
  // 主程序或外部同步改动数据时跟随刷新，保持两窗口状态一致
  unlisteners.push(await listen<null>(EVENTS.tasksChanged, refreshCurrent));
  unlisteners.push(await listen<null>(EVENTS.categoriesChanged, () => categories.load()));
  let settingsDebounce: ReturnType<typeof setTimeout> | null = null;
  unlisteners.push(
    await listen<null>(EVENTS.settingsChanged, () => {
      // 设置保存是逐键写入，去抖后统一重载（语言经 i18n watchEffect 即时切换）
      if (settingsDebounce) clearTimeout(settingsDebounce);
      settingsDebounce = setTimeout(async () => {
        await settings.load();
        if (!pomo.enabled()) {
          pomo.stop();
        }
        if (settings.bool("pet_input_response")) {
          irCtl.start();
        } else {
          irCtl.stop();
        }
      }, 200);
    }),
  );
});
onUnmounted(() => {
  unlisteners.forEach((u) => u());
  if (clickTimer) clearTimeout(clickTimer);
  if (microTimer) clearTimeout(microTimer);
  if (holdTimer) clearTimeout(holdTimer);
  if (sleepTimer) clearInterval(sleepTimer);
  if (lineTimer) clearInterval(lineTimer);
  if (reminderTimer) clearTimeout(reminderTimer);
  window.removeEventListener("pointermove", markActivity);
  window.removeEventListener("pointerdown", markActivity);
  window.removeEventListener("keydown", onWindowKeydown);
  idleCtl.stop();
  irCtl.stop();
  disposeClickThrough?.();
});
</script>

<template>
  <div
    class="pet-stage"
    @pointerdown.capture="onStagePointerDownCapture"
    @mousedown="onStageDragStart"
    @mousemove="onStageDragMove"
    @mouseup="onStageDragEnd"
    @mouseleave="onStageDragEnd"
  >
    <!-- 初代战斗布局：精灵在上。命中区固定不动（蹦跳动画在 img 上），保证双击稳定触发 -->
    <div
      ref="spriteHitRef"
      class="sprite-hit"
      @pointerdown="onSpritePointerDown"
      @pointermove="onSpritePointerMove"
      @pointerup="onSpritePointerUp"
      @pointercancel="onSpritePointerUp"
      @click="onSpriteClick"
      @dblclick="onSpriteDblClick"
      @contextmenu="onPetContextMenu"
    >
      <!-- 剩余时间色环：绿 → 琥珀 → 红，尾段精灵焦急加速 -->
      <svg v-if="ringPct != null" class="pomo-ring" viewBox="0 0 112 112" aria-hidden="true">
        <circle class="ring-bg" cx="56" cy="56" :r="RING_R" />
        <circle
          class="ring-fg"
          cx="56"
          cy="56"
          :r="RING_R"
          :style="{ stroke: ringColor }"
          :stroke-dasharray="RING_C"
          :stroke-dashoffset="RING_C * (1 - ringPct)"
        />
      </svg>
      <PokemonSprite class="pet-sprite" :class="spriteClass" :style="hopStyle" :sprite="petSprite" draggable="false" />
      <!-- 快捷图鉴屏唤出钮：悬停精灵时浮现（单击精灵改为随机搭话，防误触展开大面板） -->
      <button
        v-if="!quickOpen"
        class="quick-fab"
        :title="t('pet.menuQuick')"
        :aria-label="t('pet.menuQuick')"
        @pointerdown.stop
        @click.stop.prevent="toggleQuick()"
      >
        ☰
      </button>
      <!-- 睡觉 zzz -->
      <div v-if="petState === 'asleep'" class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></div>
      <!-- 捕捉演出：精灵球（抛物线由 wrap X + ball Y 双层组合；连胜为双球左右交替） -->
      <div
        v-for="(b, i) in catchBalls"
        :key="i"
        class="ball-wrap"
        :class="[b.phase, { 'side-l': b.side < 0, 'side-r': b.side > 0, fast: streakScene }]"
        aria-hidden="true"
      >
        <div class="ball"></div>
      </div>
    </div>

    <!-- 陪跑精灵（F6）：客人在精灵旁坐下安静陪伴；点它挥手离开 -->
    <div
      v-if="mate"
      class="pet-mate"
      :class="mate.phase"
      :title="t('pet.mateHint')"
      aria-hidden="true"
      @pointerdown.stop.prevent="onMateLeave"
    >
      <PokemonSprite :sprite="mate.sprite" />
    </div>

    <!-- 番茄钟（信息极简 v2：运行中 ⏸✔；暂停态 ▶🍦✔；⇄ 切换移入右键菜单）——
         常驻状态由药丸承载（台词瞬态化后不再有常驻状态文字），置于气泡前避免被顶动 -->
    <div v-if="current && pomo.enabled()" class="pomo-pill" :class="{ break: pomo.phase.value === 'break' }">
      <span class="px">{{ pomo.phase.value === "break" ? "☕" : "🍅" }} {{ pomo.mmss.value }}</span>
      <button v-if="pomo.running.value" class="pomo-btn" :title="t('pet.menuPause')" @click="pauseTask">⏸</button>
      <template v-else>
        <button class="pomo-btn" :title="t('pet.trialStart')" @click="startTrial">🍦</button>
        <button class="pomo-btn" :title="t('pet.menuResume')" @click="resume">▶</button>
      </template>
      <button class="pomo-btn" :title="t('pet.menuDone')" @click="doneTask">✔</button>
    </div>

    <!-- 瞬态台词气泡（VPet 范式）：说完自动淡出，悬停暂停、点击收起；不说话时完全让位（cat-tag 已按信息极简裁决移除） -->
    <div
      v-if="chatOpen || bubbleVisible"
      class="dialog"
      :class="{
        alert: petState === 'urgent' && !chatOpen,
        'is-new': bubbleNew && !chatOpen,
        fading: bubbleFading && !chatOpen,
        dismissible: !chatOpen,
        chat: chatOpen,
      }"
      :title="chatOpen ? undefined : t('pet.bubbleClose')"
      @click="dismissBubble"
      @mouseenter="pauseBubbleCountdown"
      @mouseleave="resumeBubbleCountdown"
    >
      <div v-if="!chatOpen" class="dialog-inner">
        <span class="dialog-text">{{ bubble }}</span>
        <span class="dialog-next">▼</span>
      </div>
      <!-- 对话态（F2）：原位展开 ≤4 行——最近回答 + 思考点 + 输入行；Esc/✕ 收起 -->
      <div v-else class="chat-box">
        <div class="chat-log">
          <div v-for="(m, i) in chatLog" :key="i" class="chat-msg" :class="m.role">{{ m.text }}</div>
          <div v-if="chatThinking" class="chat-msg bot thinking"><i></i><i></i><i></i></div>
        </div>
        <div class="chat-chips">
          <button
            class="chat-chip"
            :disabled="chatThinking"
            @click="
              chatInput = t('pet.chatQ1');
              sendChat();
            "
          >
            {{ t("pet.chatQ1") }}
          </button>
          <button
            class="chat-chip"
            :disabled="chatThinking"
            @click="
              chatInput = t('pet.chatQ2');
              sendChat();
            "
          >
            {{ t("pet.chatQ2") }}
          </button>
        </div>
        <div class="chat-row">
          <input
            ref="chatInputRef"
            v-model="chatInput"
            class="chat-input"
            :placeholder="t('pet.chatPh')"
            :disabled="chatThinking"
            @keydown.enter.prevent="sendChat"
          />
          <button class="pomo-btn" :title="t('pet.chatSend')" :disabled="chatThinking" @click="sendChat">▶</button>
          <button class="pomo-btn" :title="t('pet.chatClose')" @click="closeChat">✕</button>
        </div>
      </div>
    </div>

    <!-- 就近可操作提醒：提醒气泡旁直接完成 / 推迟，无需打开主面板 -->
    <div v-if="reminderTask" class="reminder-actions">
      <button class="btn" @click="completeFromReminder">✔ {{ t("pet.reminderDo") }}</button>
      <button class="btn ghost" @click="snoozeFromReminder">⇨ {{ t("pet.reminderSnooze") }}</button>
    </div>

    <!-- 快捷图鉴屏：悬停精灵出 ☰ 钮展开 -->
    <div v-if="quickOpen" class="quick-dex">
      <div class="hinge"></div>
      <div class="lcd screen">
        <h4 class="px">ADVENTURE</h4>
        <div
          v-for="tk in candidates"
          :key="tk.id"
          class="q-item"
          :class="{ sel: quickSel === tk.id, active: tk.status === 'active' }"
          @click="quickSel = tk.id"
          @dblclick="quickStart(tk.id)"
        >
          <span class="cursor">▶</span>
          <span class="q-title">{{ tk.title }}</span>
          <span class="px q-no">{{ String(tk.id).padStart(3, "0") }}</span>
        </div>
        <div v-if="!candidates.length" class="q-empty">{{ t("pet.quickEmpty") }}</div>
      </div>
      <div class="ops">
        <button class="btn" @click="quickStartSel">{{ t("pet.quickStart") }}</button>
        <button class="btn ghost" @click="pauseTask">{{ t("pet.quickPause") }}</button>
        <button class="btn ghost" @click="quickOpen = false">{{ t("pet.quickClose") }}</button>
      </div>
    </div>

    <!-- 切换任务浮层 -->
    <div v-if="switching" class="switcher">
      <div class="switcher-title">{{ t("pet.switchTitle") }}</div>
      <button v-for="tk in candidates" :key="tk.id" class="switch-item" @click="switchTo(tk)">
        {{ tk.title }}
      </button>
      <button class="switch-item cancel" @click="switching = false">{{ t("pet.switchCancel") }}</button>
    </div>

    <!-- 桌宠右键菜单 -->
    <DexContextMenu />
  </div>
</template>

<style scoped>
.pet-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px 0 8px;
  height: 100vh;
  position: relative;
  font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  /* 空白区不接鼠标：事件与点击穿透的命中检测都只看实体子元素
     （子元素恢复 auto；事件仍会冒泡到 stage 的拖拽处理器） */
  pointer-events: none;
}
.pet-stage > * {
  pointer-events: auto;
}

/* 紧凑对白气泡（瞬态后不再需要控制台的固定全宽框）：宽随内容、单层描边、
   顶部小尾巴指向精灵；白底 + 藏青框 + 硬投影保留初代语感 */
.dialog {
  position: relative;
  width: fit-content;
  max-width: 100%;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 2px 2px 0 var(--dex-navy);
  margin-top: 14px; /* 给尾巴让出高度 */
  transition: opacity 220ms var(--e-snap);
  animation: pk-bubble-in 240ms var(--e-pop);
}
/* 尾巴：双色三角（藏青描边 + 白芯），白芯底边穿过边框区探入内部（y≈4px），
   与气泡白色连通成「开口」而非实心箭头；藏青只留两条斜边——标准气球尾巴画法。
   伪元素是 content-box（全局 * reset 不匹配伪元素），零尺寸 + 纯 border 的三角画法不受影响，
   且最深点 4px < 文字顶 8px，任何字体度量下都不会再遮字 */
.dialog:not(.chat)::before,
.dialog:not(.chat)::after {
  content: "";
  position: absolute;
  left: 50%;
  width: 0;
  height: 0;
  border-style: solid;
  border-color: transparent;
}
.dialog:not(.chat)::before {
  top: -6px;
  margin-left: -7px;
  border-width: 0 7px 9px;
  border-bottom-color: var(--dex-navy);
}
.dialog:not(.chat)::after {
  top: -5px;
  margin-left: -4px;
  border-width: 0 4px 9px;
  border-bottom-color: #fff;
}
/* 对话态是展开的控制台：恢复全宽、无尾巴 */
.dialog.chat {
  width: 100%;
  margin-top: 10px;
}
.dialog.dismissible {
  cursor: pointer;
}
.dialog.fading {
  opacity: 0;
  pointer-events: none;
}
@keyframes pk-bubble-in {
  0% {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}
.dialog.alert {
  animation: pk-shake var(--t-act) 3;
}
.dialog-inner {
  padding: 5px 12px 5px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dialog-text {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--dex-navy);
}
/* 初代"继续"箭头 v2：默认静态（存在即语义），仅新事件闪 3 次后停——
   把「同屏唯一闪烁」名额让给真正的紧急信息 */
.dialog-next {
  flex: none;
  align-self: flex-end;
  font-size: 10px;
  color: var(--dex-red);
  opacity: 0.9;
}
.dialog.is-new .dialog-next {
  animation: pk-blink3 1.8s steps(1) forwards;
}
@keyframes pk-blink3 {
  0%,
  20% {
    opacity: 1;
  }
  10%,
  30% {
    opacity: 0.15;
  }
  40%,
  60% {
    opacity: 1;
  }
  50%,
  70% {
    opacity: 0.15;
  }
  100% {
    opacity: 0.9;
  }
}

/* 精灵（初代布局：居中在上）。规则顺序即优先级：状态循环 → 修饰 → 拖拽 → 微动作 → 演出 */
.sprite-hit {
  position: relative; /* 色环/精灵球/星星绝对定位的锚 */
  width: 104px;
  height: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
}
.pet-sprite {
  width: 104px;
  height: 104px;
  image-rendering: pixelated;
}
/* 快捷图鉴屏唤出钮：平时隐身（不挡点击穿透），悬停精灵才浮现——两段式防误触 */
.quick-fab {
  position: absolute;
  right: -40px;
  top: 36px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--dex-navy);
  background: var(--poke-yellow);
  box-shadow: 2px 2px 0 var(--dex-navy);
  color: var(--dex-navy);
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--t-tap),
    transform var(--t-tap);
}
.sprite-hit:hover .quick-fab,
.quick-fab:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.quick-fab:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
.pet-sprite.working {
  animation: pk-hop 1.6s var(--e-sway) infinite;
}
.pet-sprite.paused {
  filter: grayscale(0.6);
}
.pet-sprite.idle {
  animation: pk-hop 3s var(--e-sway) infinite;
}
.pet-sprite.asleep {
  filter: grayscale(0.35) brightness(0.92);
  animation: pk-sleep-breathe 3.2s var(--e-sleep) infinite;
}
/* 撸宠反馈：蹲下蓄力 → 弹起过冲（可爱三律） */
.pet-sprite.petted {
  animation: pk-petted 0.9s var(--e-pop);
}
/* 拖拽物理：悬挂小碎步 → 松手挤压回弹 */
.pet-sprite.holding {
  animation: pk-drag-hang 0.3s var(--e-sway) infinite;
}
.pet-sprite.released {
  animation: pk-release-squash 420ms var(--e-pop);
}
@keyframes pk-drag-hang {
  0%,
  100% {
    transform: rotate(5deg);
  }
  50% {
    transform: rotate(11deg);
  }
}
/* 生命感微动作（一次性事件；由 usePetIdle 调度，与演出互斥） */
.pet-sprite.ma-blink {
  animation: pk-blink-eye 240ms var(--e-sway);
}
.pet-sprite.ma-look {
  animation: pk-look 1s var(--e-sway);
}
.pet-sprite.ma-flip {
  animation: pk-flip 1.2s var(--e-sway);
}
.pet-sprite.ma-yawn {
  animation: pk-yawn 900ms var(--e-sleep);
}
.pet-sprite.ma-wake {
  animation: pk-wake 650ms var(--e-pop);
}
.pet-sprite.ma-hop {
  animation: pk-hop-one 550ms var(--e-pop);
}
@keyframes pk-hop-one {
  0% {
    transform: translateY(0) scale(1, 1);
  }
  18% {
    transform: translateY(2px) scale(1.05, 0.88);
  }
  55% {
    transform: translateY(-9px) scale(0.96, 1.06);
  }
  85% {
    transform: translateY(1px) scale(1.04, 0.92);
  }
  100% {
    transform: translateY(0) scale(1, 1);
  }
}
/* 捕捉演出：预备蹲 → 罩住（精灵隐去） */
.pet-sprite.catch-prep {
  animation: none;
  transform: scale(0.9, 0.86);
}
.pet-sprite.catch-hide {
  animation: none;
  opacity: 0;
}
/* 尾段焦急：蹦跳加速（选择器加长以覆盖 idle/working 的时长） */
.pet-sprite.anxious.idle {
  animation: pk-hop 0.8s var(--e-sway) infinite;
}
.pet-sprite.anxious.working {
  animation: pk-hop 0.6s var(--e-sway) infinite;
}
/* 栖息姿态（F4）：重心下沉、幅度减半——它坐着（可叠加 idle/working/paused） */
.pet-sprite.perched {
  translate: 0 4px;
}
.pet-sprite.perched.idle {
  animation: pk-sit-breathe 4.2s var(--e-sleep) infinite;
}
.pet-sprite.perched.working {
  animation: pk-sit-bounce 1.6s var(--e-sway) infinite;
}
.pet-sprite.perched.paused {
  filter: grayscale(0.6);
  animation: pk-sit-breathe 5s var(--e-sleep) infinite;
}
@keyframes pk-sit-breathe {
  0%,
  100% {
    transform: scale(1, 0.92);
  }
  50% {
    transform: scale(1.008, 0.935);
  }
}
@keyframes pk-sit-bounce {
  0%,
  100% {
    transform: scale(1, 0.92) translateY(0);
  }
  50% {
    transform: scale(1, 0.92) translateY(-3px);
  }
}
/* 输入响应微抖（F1）：±2°/120ms 的「跟着你打字」 */
.pet-sprite.ma-earwig {
  animation: pk-earwig 120ms linear;
}
@keyframes pk-earwig {
  0%,
  100% {
    transform: rotate(0);
  }
  30% {
    transform: rotate(-2deg);
  }
  60% {
    transform: rotate(2deg);
  }
}
/* 落座（F4）：挤压回弹一次 */
.pet-sprite.ma-sit {
  animation: pk-sit-down 420ms var(--e-pop);
}
@keyframes pk-sit-down {
  0% {
    transform: scale(1.06, 0.82) translateY(4px);
  }
  45% {
    transform: scale(0.95, 1) translateY(-3px);
  }
  100% {
    transform: scale(1, 0.92);
  }
}
/* 对话态（F2）：侧耳倾听 */
.pet-sprite.listening {
  animation: none;
  transform: rotate(2deg);
}

/* 睡觉 zzz */
.zzz {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 30px;
  height: 40px;
  pointer-events: none;
}
.zzz i {
  position: absolute;
  font-style: normal;
  font-family: "Press Start 2P", monospace;
  color: var(--dex-navy);
  opacity: 0;
}
.zzz i:nth-child(1) {
  font-size: 8px;
  animation: pk-z-float 3s var(--e-sleep) infinite;
}
.zzz i:nth-child(2) {
  font-size: 10px;
  animation: pk-z-float 3s var(--e-sleep) 1s infinite;
}
.zzz i:nth-child(3) {
  font-size: 12px;
  animation: pk-z-float 3s var(--e-sleep) 2s infinite;
}
@keyframes pk-z-float {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  20% {
    opacity: 0.85;
  }
  100% {
    transform: translate(12px, -26px);
    opacity: 0;
  }
}

/* 捕捉演出：精灵球（wrap 管 X 匀速、ball 管 Y 过冲 = 抛物线） */
.ball-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 34px;
  height: 34px;
  margin: -17px 0 0 -17px;
  pointer-events: none;
  z-index: 5;
}
.ball {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 3px solid var(--dex-navy);
  overflow: hidden;
  background: linear-gradient(180deg, var(--dex-red) 0 48%, #fff 48% 100%);
  box-shadow: 2px 2px 0 var(--dex-navy);
  position: relative;
}
.ball::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 50%;
}
.ball-wrap.fly {
  animation: pk-ball-x var(--t-act) linear forwards;
}
.ball-wrap.fly .ball {
  animation: pk-ball-y var(--t-act) var(--e-pop) forwards;
}
.ball-wrap.land .ball {
  animation: pk-ball-land 350ms var(--e-pop) forwards;
}
.ball-wrap.shake .ball {
  animation: pk-ball-shake var(--t-scene) var(--e-sway);
}
/* 连胜双球（F7）：左右站位 + 交替快摇 350ms */
.ball-wrap.side-l {
  margin-left: -43px;
}
.ball-wrap.side-r {
  margin-left: 9px;
}
.ball-wrap.shake.fast .ball {
  animation-duration: 350ms;
}

/* 捕捉星星粒子 */
.pk-star {
  position: absolute;
  left: calc(50% - 5px);
  top: 40%;
  width: 10px;
  height: 10px;
  background: var(--poke-yellow);
  border: 2px solid var(--dex-navy);
  animation: pk-star-fly var(--t-act) var(--e-pop) forwards;
  pointer-events: none;
  z-index: 6;
}
.pk-star.big {
  width: 14px;
  height: 14px;
  background: #fff;
}

/* 番茄钟药丸 */
.pomo-pill {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 5px 10px;
}
.pomo-pill .px {
  font-size: 16px;
  color: var(--danger);
}
.pomo-pill.break {
  border-color: var(--rest-blue);
  box-shadow: 4px 4px 0 var(--rest-blue);
}
.pomo-pill.break .px {
  color: var(--rest-blue);
}
.pomo-btn {
  width: 32px;
  height: 32px;
  border: 3px solid var(--dex-navy);
  border-radius: 4px;
  background: var(--poke-yellow);
  cursor: pointer;
  font-size: 13px;
  box-shadow: 2px 2px 0 var(--dex-navy);
  font-family: inherit;
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap);
}
.pomo-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}

/* 快捷图鉴屏 */
.quick-dex {
  width: 250px;
  margin-top: 12px;
  background: linear-gradient(180deg, var(--dex-red) 0%, var(--dex-red) 80%, var(--dex-red-dark) 100%);
  border: 4px solid var(--dex-navy);
  border-radius: 16px;
  padding: 12px;
  position: relative;
  z-index: 10;
}
.hinge {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  width: 46px;
  height: 14px;
  background: var(--dex-red-dark);
  border: 3px solid var(--dex-navy);
  border-radius: 4px;
}
.screen {
  padding: 10px;
  max-height: 220px;
  overflow-y: auto;
}
.screen h4 {
  font-size: 8px;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
.q-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 5px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--lcd-text);
}
.q-item .cursor {
  opacity: 0;
  font-size: 10px;
  flex: none;
}
.q-item.sel .cursor {
  opacity: 1;
}
.q-item.sel {
  background: rgba(58, 74, 50, 0.15);
  outline: 2px solid var(--lcd-text);
}
.q-item.active .q-title::after {
  content: " ♪";
}
.q-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-no {
  font-size: 8px;
  opacity: 0.8;
}
.q-empty {
  font-size: 12px;
  padding: 12px 4px;
}
.quick-dex .ops {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.quick-dex .ops .btn {
  flex: 1;
  text-align: center;
  font-size: 12px;
  padding: 8px 2px;
  min-height: 38px;
}

/* 切换浮层 */
.switcher {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 20;
}
.switcher-title {
  font-size: 12px;
  color: var(--ink-soft);
  text-align: center;
}
.switch-item {
  border: 3px solid var(--dex-navy);
  border-radius: 4px;
  background: #fff;
  padding: 6px;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switch-item.cancel {
  border-style: dashed;
  text-align: center;
  color: var(--ink-soft);
}

/* 提醒就近动作条 */
.reminder-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 6px;
}
.reminder-actions .btn {
  min-height: 32px;
  font-size: 13px;
  padding: 4px 12px;
}

/* 陪跑精灵（F6）：客人在主精灵左侧，走入→坐下呼吸→挥手离开；零台词零闪烁 */
.pet-mate {
  position: absolute;
  left: 2px;
  top: 16px;
  width: 84px;
  height: 84px;
  cursor: pointer;
}
.pet-mate .pk-sprite {
  width: 100%;
  height: 100%;
}
.pet-mate.walk .pk-sprite {
  animation: pk-mate-walk 650ms var(--e-snap);
}
.pet-mate.sit .pk-sprite {
  animation: pk-sit-breathe 4.2s var(--e-sleep) infinite;
}
.pet-mate.wave .pk-sprite {
  animation: pk-mate-wave 600ms var(--e-sway);
}
@keyframes pk-mate-walk {
  0% {
    transform: translateX(-90px) translateY(0);
    opacity: 0;
  }
  25% {
    opacity: 1;
  }
  50% {
    transform: translateX(-45px) translateY(-5px);
  }
  100% {
    transform: translateX(0) translateY(0);
  }
}
@keyframes pk-mate-wave {
  0%,
  100% {
    transform: scaleX(1);
  }
  50% {
    transform: scaleX(-1);
  }
}

/* 对话态（F2）：对话框原位展开 ≤4 行（历史 ≤3 条 + 输入行） */
.chat-box {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  margin: 3px;
  padding: 7px;
}
.chat-log {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 44px;
  max-height: 118px;
  overflow: hidden;
}
.chat-msg {
  font-size: 12px;
  line-height: 1.55;
  padding: 4px 8px;
  border: 2px solid var(--dex-navy);
  border-radius: 8px;
  max-width: 94%;
  overflow-wrap: anywhere;
}
.chat-msg.user {
  align-self: flex-end;
  background: var(--poke-yellow);
  font-weight: 700;
}
.chat-msg.bot {
  align-self: flex-start;
  background: #fff;
  font-weight: 500;
}
.chat-msg.thinking {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  background: #f2f2ec;
}
.chat-msg.thinking i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink-faint, #9a937f);
  animation: pk-tdot 1s var(--e-sway) infinite;
}
.chat-msg.thinking i:nth-child(2) {
  animation-delay: 0.2s;
}
.chat-msg.thinking i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes pk-tdot {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}
.chat-chips {
  display: flex;
  gap: 5px;
  margin: 6px 0;
}
.chat-chip {
  font-size: 10.5px;
  font-weight: 700;
  border: 2px solid var(--dex-navy);
  border-radius: 6px;
  background: #fff;
  padding: 3px 7px;
  cursor: pointer;
  font-family: inherit;
}
.chat-chip:hover {
  background: var(--hover, #fff3c4);
}
.chat-chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.chat-row {
  display: flex;
  gap: 5px;
}
.chat-input {
  flex: 1;
  min-width: 0;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 6px 7px;
  font-size: 12px;
  font-family: inherit;
}
.chat-input:focus {
  outline: 2px solid var(--poke-yellow);
}
/* 番茄剩余时间色环 */
.pomo-ring {
  position: absolute;
  inset: 0;
  width: 104px;
  height: 104px;
  pointer-events: none;
}
.pomo-ring circle {
  fill: none;
  stroke-width: 5;
}
.pomo-ring .ring-bg {
  stroke: rgba(28, 34, 68, 0.15);
}
.pomo-ring .ring-fg {
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 56px 56px;
  transition:
    stroke-dashoffset var(--t-act) var(--e-snap),
    stroke var(--t-act);
}
</style>
