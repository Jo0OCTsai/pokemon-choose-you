<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { EVENTS } from "./events";
import type { Task } from "./types";
import { useI18n } from "vue-i18n";
import { randomQuote } from "./pokemon";
import { useSettingsStore } from "./stores/settings";
import { useCategoriesStore } from "./stores/categories";
import { usePomodoro } from "./composables/usePomodoro";
import { usePetDrag } from "./composables/usePetDrag";
import { usePetClickThrough } from "./composables/usePetClickThrough";
import { openContextMenu, type ContextMenuItem } from "./contextMenu";
import PokemonSprite from "./components/PokemonSprite.vue";
import DexContextMenu from "./components/DexContextMenu.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();

const petWindow = getCurrentWindow();

// ---- 桌宠状态机：idle / working / paused / urgent ----
const current = ref<Task | null>(null);
const petState = ref<"idle" | "working" | "paused" | "urgent">("idle");

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
  if (p > 0.5) return "#5be36b";
  if (p > 0.25) return "#f5a623";
  return "#e3350d";
});
/** 尾段（剩 ≤5 分钟或 ≤20%）精灵焦急：蹦跳加速 */
const anxious = computed(() => {
  if (ringPct.value == null) return false;
  return pomo.remainSec.value <= Math.max(300, pomo.totalSec.value * 0.2);
});
const bubble = ref(t("pet.welcome"));
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
  onBreakStart: () => say(t("pet.breakStart"), false),
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
  if (current.value) {
    pomo.stop();
    await api.updateTask({ id: current.value.id, status: "done" });
  }
  await refreshCurrent();
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
const petted = ref(false);

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
function say(text: string, thenRestore = true) {
  bubble.value = text;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (thenRestore) {
    bubbleTimer = setTimeout(bubbleText, 2000);
  }
}

async function toggleQuick() {
  quickOpen.value = !quickOpen.value;
  petted.value = true;
  setTimeout(() => (petted.value = false), 500);
  if (quickOpen.value) {
    await loadQuickList();
    quickSel.value = current.value?.id ?? null;
    // 一半概率出引导，一半概率出随机撸宠台词（当前展示的宝可梦有自定义台词则优先）
    say(Math.random() < 0.5 ? t("pet.quickPick") : randomQuote(petSprite.value), false);
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
  say(t("pet.gotcha", { t: taskTitle ?? "" }));
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

// 单击/双击区分：单击延迟触发，双击取消单击，避免双击时快捷屏闪开闪关
let clickTimer: ReturnType<typeof setTimeout> | null = null;
function onSpriteClick() {
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    toggleQuick();
  }, 250);
}
async function onSpriteDblClick() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  await openPanel();
}

// 手动拖拽（Linux/WebKit 下 data-tauri-drag-region 不可靠）
const { onDragStart, onDragMove, onDragEnd } = usePetDrag(petWindow);

// 透明区域点击穿透：精灵两侧/快捷屏下方的空白放行给下层应用（见 composable 注释）
let disposeClickThrough: (() => void) | null = null;

/** 桌宠右键菜单：无桌宠操作按钮悬浮提示后的常驻入口（图鉴机/快捷屏/暂停/隐藏） */
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
    await refreshCurrent();
    // 刷新会把气泡重置为当前任务状态，确认文案放在刷新之后
    say(t("pet.reminderDone", { t: r.title, p: r.pokemon ?? "" }));
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

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  disposeClickThrough = usePetClickThrough();
  await Promise.all([categories.load(), settings.load()]);
  await refreshCurrent();

  unlisteners.push(
    await listen<{ id: number; title: string; urgent: boolean; pokemon?: string | null }>(EVENTS.taskReminder, (e) => {
      const p = e.payload.pokemon ?? "";
      petState.value = e.payload.urgent ? "urgent" : "working";
      bubble.value = e.payload.urgent
        ? t("pet.remindUrgent", { t: e.payload.title, p })
        : t("pet.remindNormal", { t: e.payload.title, p });
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
  disposeClickThrough?.();
});
</script>

<template>
  <div class="pet-stage" @mousedown="onDragStart" @mousemove="onDragMove" @mouseup="onDragEnd" @mouseleave="onDragEnd">
    <!-- 初代战斗布局：精灵在上。命中区固定不动（蹦跳动画在 img 上），保证双击稳定触发 -->
    <div class="sprite-hit" @click="onSpriteClick" @dblclick="onSpriteDblClick" @contextmenu="onPetContextMenu">
      <!-- 剩余时间色环：绿 → 琥珀 → 红，尾段精灵焦急加速 -->
      <svg v-if="ringPct != null" class="pomo-ring" viewBox="0 0 112 112" aria-hidden="true">
        <circle class="ring-bg" cx="56" cy="56" :r="RING_R" />
        <circle
          class="ring-fg"
          cx="56"
          cy="56"
          :r="RING_R"
          :stroke="ringColor"
          :stroke-dasharray="RING_C"
          :stroke-dashoffset="RING_C * (1 - ringPct)"
        />
      </svg>
      <PokemonSprite
        class="pet-sprite"
        :class="[petState, { petted, anxious }]"
        :sprite="petSprite"
        draggable="false"
      />
    </div>
    <div v-if="current" class="cat-tag">{{ currentCat?.name }} · {{ currentCat?.pokemon }}</div>

    <!-- 全宽对话框在下 -->
    <div class="dialog" :class="{ alert: petState === 'urgent' }">
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

    <!-- 番茄钟 -->
    <div v-if="current && pomo.enabled()" class="pomo-pill" :class="{ break: pomo.phase.value === 'break' }">
      <span class="px">{{ pomo.phase.value === "break" ? "☕" : "🍅" }} {{ pomo.mmss.value }}</span>
      <button v-if="pomo.running.value" class="pomo-btn" @click="pauseTask">⏸</button>
      <template v-else>
        <button class="pomo-btn" @click="startTrial">🍦</button>
        <button class="pomo-btn" @click="resume">▶</button>
      </template>
      <button class="pomo-btn" @click="doneTask">✔</button>
      <button class="pomo-btn" @click="openSwitcher">⇄</button>
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
  border-radius: 6px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  margin-top: 10px;
}
.dialog.alert {
  animation: pk-shake 0.4s 3;
}
.dialog-inner {
  border: 2px solid var(--dex-navy);
  border-radius: 3px;
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
/* 初代"继续"箭头：右下角闪烁 */
.dialog-next {
  flex: none;
  align-self: flex-end;
  font-size: 11px;
  color: var(--dex-red);
  animation: pk-blink 1s infinite;
}

/* 分类小标签 */
.cat-tag {
  margin-top: 4px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid var(--dex-navy);
  padding: 1px 8px;
  border-radius: 8px;
  color: var(--dex-navy);
  font-weight: 700;
}

/* 精灵（初代布局：居中在上） */
.sprite-hit {
  position: relative; /* 色环绝对定位的锚 */
  width: 104px;
  height: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pet-sprite {
  width: 104px;
  height: 104px;
  image-rendering: pixelated;
}
.pet-sprite.working {
  animation: pk-hop 1.6s ease-in-out infinite;
}
.pet-sprite.paused {
  filter: grayscale(0.6);
}
.pet-sprite.idle {
  animation: pk-hop 3s ease-in-out infinite;
}
/* 撸宠反馈：快速弹跳 */
.pet-sprite.petted {
  animation: pk-petted 0.45s ease-out 2;
}
@keyframes pk-petted {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.18) rotate(-4deg);
  }
  70% {
    transform: scale(0.95) rotate(3deg);
  }
  100% {
    transform: scale(1);
  }
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
  font-size: 12px;
  color: var(--dex-red);
}
.pomo-pill.break {
  border-color: #3c5aa6;
  box-shadow: 4px 4px 0 #3c5aa6;
}
.pomo-pill.break .px {
  color: #3c5aa6;
}
.pomo-btn {
  width: 30px;
  height: 30px;
  border: 3px solid var(--dex-navy);
  border-radius: 6px;
  background: var(--poke-yellow);
  cursor: pointer;
  font-size: 13px;
  box-shadow: 2px 2px 0 var(--dex-navy);
  font-family: inherit;
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
  border-radius: 14px;
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
  border-radius: 6px;
}
.screen {
  padding: 10px;
  max-height: 220px;
  overflow-y: auto;
}
.screen h4 {
  font-size: 9px;
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
  font-size: 9px;
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
  min-height: 36px;
}

/* 切换浮层 */
.switcher {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 20;
}
.switcher-title {
  font-size: 12px;
  color: #9a937f;
  text-align: center;
}
.switch-item {
  border: 3px solid var(--dex-navy);
  border-radius: 6px;
  background: var(--poke-yellow);
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
  background: #fff;
  text-align: center;
  color: #999;
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
    stroke-dashoffset 1s linear,
    stroke 0.5s;
}
/* 尾段焦急：蹦跳加速 + 轻微晃动 */
/* 焦急档位：相同关键帧、时长加速（选择器加长以覆盖 idle/working 的时长） */
.pet-sprite.anxious.idle {
  animation: pk-hop 0.8s ease-in-out infinite;
}
.pet-sprite.anxious.working {
  animation: pk-hop 0.6s ease-in-out infinite;
}
</style>
