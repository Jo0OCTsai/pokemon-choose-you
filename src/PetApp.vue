<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { openContextMenu, type ContextMenuItem } from "./contextMenu";
import PokemonSprite from "./components/PokemonSprite.vue";
import DexContextMenu from "./components/DexContextMenu.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();

const petWindow = getCurrentWindow();

// ---- 桌宠状态机：idle / working / paused / urgent / asleep（PET_INTERACTION_DESIGN §4.2） ----
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
const bubble = ref(t("pet.welcome"));
const bubbleNew = ref(false);
const switching = ref(false);
const quickOpen = ref(false);

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
    bubble.value = trialDone ? t("pet.trialDone") : t("pet.pomoDone", { t: title, p: currentCat.value?.pokemon ?? "" });
  },
  onBreakStart: () => say(t("pet.breakStart"), false, true),
  onBreakEnd: () => {
    petState.value = "working";
    say(t("pet.breakEnd"));
  },
});

/** 「先试 5 分钟」：卡在启动上时的零挫败入场券 */
function startTrial() {
  if (!current.value) return;
  pomo.startTrial();
  say(t("pet.trialStart"), false);
}

function bubbleText() {
  if (!current.value) {
    petState.value = "idle";
    bubble.value = t("pet.idle");
    return;
  }
  petState.value = pomo.running.value ? "working" : "paused";
  bubble.value = pomo.running.value
    ? t("pet.working", { p: currentCat.value?.pokemon ?? "", t: current.value.title })
    : t("pet.paused", { p: currentCat.value?.pokemon ?? "" });
}

async function refreshCurrent() {
  const prevId = current.value?.id ?? null;
  current.value = await api.getCurrentTask();
  if (!current.value) {
    pomo.stop();
  } else if (current.value.id !== prevId && pomo.enabled()) {
    // 活动任务换了（本窗口切换，或主程序开始/完成、外部同步）→ 番茄钟跟随新任务
    pomo.start();
  }
  bubbleText();
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
  const before = (await api.dexStats().catch(() => null))?.caught;
  await api.updateTask({ id: task.id, status: "done" });
  await refreshCurrent();
  const after = (await api.dexStats().catch(() => null))?.caught;
  const openCount = await api
    .listTasks("open")
    .then((l) => l.length)
    .catch(() => 1);
  const milestone = milestoneCrossed(before, after);
  const allDone = !current.value && openCount === 0;
  await runCatchScene({ pokemon, title: task.title, milestone, allDone });
}

/** 里程碑档位：累计捕捉跨过任一阈值时返回该阈值 */
function milestoneCrossed(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || after <= before) return null;
  for (const m of [10, 50, 100, 200, 500, 1000]) {
    if (before < m && after >= m) return m;
  }
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

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
function say(text: string, thenRestore = true, isNew = false) {
  bubble.value = text;
  if (isNew) {
    // ▼ 只在「有新事」时闪 3 次后回归静态（注意力红线：不永久占用闪烁名额）
    bubbleNew.value = false;
    requestAnimationFrame(() => {
      bubbleNew.value = true;
    });
  }
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (thenRestore) {
    bubbleTimer = setTimeout(bubbleText, 2000);
  }
}

async function toggleQuick() {
  quickOpen.value = !quickOpen.value;
  // 展开前先回应一跳（juice：让它知道你点了它）
  runMicro("hop");
  if (quickOpen.value) {
    await loadQuickList();
    quickSel.value = current.value?.id ?? null;
    // 一半概率出引导，一半概率出随机撸宠台词（当前展示的宝可梦有自定义台词则优先）
    say(Math.random() < 0.5 ? t("pet.quickPick") : randomQuote(petSprite.value), false, true);
  } else {
    say(randomQuote(petSprite.value));
  }
  // 展开时把窗口调高，收起恢复（透明窗口，多余高度不可见）
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  await petWindow.setSize(new LogicalSize(300, quickOpen.value ? 590 : 330));
}
async function quickStart(id: number) {
  const taskTitle = candidates.value.find((x) => x.id === id)?.title;
  await api.startTask(id);
  await refreshCurrent();
  if (pomo.enabled()) pomo.start();
  say(t("pet.gotcha", { t: taskTitle ?? "" }), true, true);
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

// ---- 单击/双击/长按三分（长按 600ms = 撸宠，与单击快捷屏、拖拽互不干扰） ----
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let lastPetAt = 0;
function onSpriteClick() {
  // 长按撸宠刚触发过 → 抬手这次 click 不再展开快捷屏
  if (Date.now() - lastPetAt < 800) return;
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    void toggleQuick();
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
  say(t("pet.petted", { p: currentCat.value?.pokemon ?? "" }), true, true);
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
  onDragStart(e);
}
function onStageDragMove(e: MouseEvent) {
  if (pressPt && dragPhys.value === null && Math.abs(e.screenX - pressPt.x) + Math.abs(e.screenY - pressPt.y) > 6) {
    dragPhys.value = "hold";
    say(t("pet.beingCarried"), false);
  }
  onDragMove(e);
}
function onStageDragEnd() {
  onDragEnd();
  pressPt = null;
  if (dragPhys.value === "hold") {
    dragPhys.value = "release";
    say(t("pet.dropped"), true, true);
    setTimeout(() => {
      if (dragPhys.value === "release") dragPhys.value = null;
    }, 420);
  }
}

/** 演出进行中任意按下 = 跳过（回应不打扰：演出永不绑架用户时间） */
function onStagePointerDownCapture() {
  if (sceneBusy.value) skipScene = true;
}

// ---- 生命感调度器：idle 低频微动作（PET_INTERACTION_DESIGN §4.4） ----
const microCls = ref<string | null>(null);
let microTimer: ReturnType<typeof setTimeout> | null = null;
const MICRO_DUR: Record<string, number> = { blink: 240, look: 1000, flip: 1200, yawn: 900, wake: 650, hop: 550 };
function runMicro(action: PetMicroAction | "wake" | "hop") {
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

/** 精灵类：微动作/演出期间替换状态循环动画（JS 层互斥，避免 CSS 优先级缠斗） */
const spriteClass = computed(() => {
  const cls: Record<string, boolean> = {
    petted: petted.value,
    anxious: anxious.value && microCls.value === null && !sceneBusy.value,
    holding: dragPhys.value === "hold",
    released: dragPhys.value === "release",
    "catch-prep": catchPhase.value === "prep",
    "catch-hide": catchPhase.value === "hide",
  };
  if (microCls.value) cls[microCls.value] = true;
  else cls[petState.value] = true;
  return cls;
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
    say(t("pet.wakeUp", { p: currentCat.value?.pokemon ?? "" }), true, true);
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
  bubble.value = t("pet.asleepHint");
}

// ---- 捕捉演出（juice 三段式：预备 → 掷球 → 三摇 → 星星，≤1.5s 可跳过） ----
const sceneBusy = ref(false);
const catchPhase = ref<null | "prep" | "hide">(null);
const catchBall = ref<null | "fly" | "land" | "shake">(null);
let skipScene = false;
const spriteHitRef = ref<HTMLElement | null>(null);
const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, motionReduced() ? 0 : ms));

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

async function runCatchScene(opts: { pokemon: string; title: string; milestone: number | null; allDone: boolean }) {
  sceneBusy.value = true;
  skipScene = false;
  catchPhase.value = "prep";
  say(t("pet.throwing", { p: opts.pokemon }), true, true);
  await waitMs(120);
  if (!skipScene) {
    catchBall.value = "fly";
    catchPhase.value = "hide";
  }
  await waitMs(300);
  if (!skipScene) catchBall.value = "land";
  await waitMs(350);
  if (!skipScene) catchBall.value = "shake";
  await waitMs(600);
  const finish = () => {
    catchBall.value = null;
    catchPhase.value = null;
    sceneBusy.value = false;
  };
  if (skipScene) {
    finish();
  } else {
    burstStars(opts.milestone ? 12 : 6);
    finish();
  }
  if (opts.allDone) {
    say(t("pet.allDone", { p: opts.pokemon }), false, true);
    runMicro("hop");
  } else if (opts.milestone) {
    say(t("pet.milestone", { p: opts.pokemon, n: opts.milestone }), false, true);
  } else {
    say(t("pet.catchOk", { p: opts.pokemon, t: opts.title }), false, true);
  }
}

// ---- 桌宠右键菜单：低频操作收纳处（⇄ 切换自药丸移入） ----
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
    say(t("pet.reminderDone", { t: r.title, p: r.pokemon ?? "" }), true, true);
  } catch {
    bubbleText();
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
    bubbleText();
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
  setTimeout(() => say(line, false, true), 800);
}

// 透明区域点击穿透：精灵两侧/快捷屏下方的空白放行给下层应用（见 composable 注释）
let disposeClickThrough: (() => void) | null = null;

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  disposeClickThrough = usePetClickThrough();
  await Promise.all([categories.load(), settings.load()]);
  await refreshCurrent();
  greetOnce();
  idleCtl.start();
  // 睡眠检测：窗口内任何交互都算「还醒着」
  window.addEventListener("pointermove", markActivity, { passive: true });
  window.addEventListener("pointerdown", markActivity, { passive: true });
  window.addEventListener("keydown", markActivity);
  sleepTimer = setInterval(checkSleep, 15_000);

  unlisteners.push(
    await listen<{ id: number; title: string; urgent: boolean; pokemon?: string | null }>(EVENTS.taskReminder, (e) => {
      const p = e.payload.pokemon ?? "";
      petState.value = e.payload.urgent ? "urgent" : "working";
      bubble.value = e.payload.urgent
        ? t("pet.remindUrgent", { t: e.payload.title, p })
        : t("pet.remindNormal", { t: e.payload.title, p });
      bubbleNew.value = false;
      requestAnimationFrame(() => {
        bubbleNew.value = true;
      });
      // 就近可操作：提醒气泡直接带「完成 / 推迟 10 分钟」，不打开主面板也能消化
      reminderTask.value = e.payload;
      clearTimeout(reminderTimer);
      reminderTimer = setTimeout(() => {
        reminderTask.value = null;
        bubbleText();
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
        bubbleText();
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
  window.removeEventListener("pointermove", markActivity);
  window.removeEventListener("pointerdown", markActivity);
  window.removeEventListener("keydown", markActivity);
  idleCtl.stop();
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
      <PokemonSprite class="pet-sprite" :class="spriteClass" :sprite="petSprite" draggable="false" />
      <!-- 睡觉 zzz -->
      <div v-if="petState === 'asleep'" class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></div>
      <!-- 捕捉演出：精灵球（抛物线由 wrap X + ball Y 双层组合） -->
      <div v-if="catchBall" class="ball-wrap" :class="catchBall" aria-hidden="true"><div class="ball"></div></div>
    </div>

    <!-- 全宽对话框在下（cat-tag 已按信息极简裁决移除：分类由气泡 {p} 与精灵图承载） -->
    <div class="dialog" :class="{ alert: petState === 'urgent', 'is-new': bubbleNew }">
      <div class="dialog-inner">
        <span class="dialog-text">{{ bubble }}</span>
        <span class="dialog-next">▼</span>
      </div>
    </div>

    <!-- 就近可操作提醒：提醒气泡旁直接完成 / 推迟，无需打开主面板 -->
    <div v-if="reminderTask" class="reminder-actions">
      <button class="btn" @click="completeFromReminder">✔ {{ t("pet.reminderDo") }}</button>
      <button class="btn ghost" @click="snoozeFromReminder">⇨ {{ t("pet.reminderSnooze") }}</button>
    </div>

    <!-- 番茄钟（信息极简 v2：运行中 ⏸✔；暂停态 ▶🍦✔；⇄ 切换移入右键菜单） -->
    <div v-if="current && pomo.enabled()" class="pomo-pill" :class="{ break: pomo.phase.value === 'break' }">
      <span class="px">{{ pomo.phase.value === "break" ? "☕" : "🍅" }} {{ pomo.mmss.value }}</span>
      <button v-if="pomo.running.value" class="pomo-btn" :title="t('pet.menuPause')" @click="pauseTask">⏸</button>
      <template v-else>
        <button class="pomo-btn" :title="t('pet.trialStart')" @click="startTrial">🍦</button>
        <button class="pomo-btn" :title="t('pet.menuResume')" @click="resume">▶</button>
      </template>
      <button class="pomo-btn" :title="t('pet.menuDone')" @click="doneTask">✔</button>
    </div>

    <!-- 快捷图鉴屏：点精灵展开 -->
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

/* 初代对话框：白底 + 双线框，全宽在精灵下方 */
.dialog {
  width: 100%;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  margin-top: 10px;
}
.dialog.alert {
  animation: pk-shake var(--t-act) 3;
}
.dialog-inner {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  margin: 3px;
  padding: 8px 10px;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dialog-text {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
  color: var(--dex-navy);
}
/* 初代"继续"箭头 v2：默认静态（存在即语义），仅新事件闪 3 次后停——
   把「同屏唯一闪烁」名额让给真正的紧急信息 */
.dialog-next {
  flex: none;
  align-self: flex-end;
  font-size: 11px;
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
