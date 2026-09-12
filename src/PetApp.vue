<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { spriteUrl, spriteFallback, type Category, type Task } from "./types";
import { sget, sgetNum, loadSettings } from "./settings";
import { useI18n } from "vue-i18n";
import { randomQuote } from "./i18n";

const { t } = useI18n();

const petWindow = getCurrentWindow();

// ---- 桌宠状态机：idle / working / paused / urgent ----
const current = ref<Task | null>(null);
const categories = ref<Category[]>([]);
const petState = ref<"idle" | "working" | "paused" | "urgent">("idle");
const bubble = ref(t("pet.welcome"));
const switching = ref(false);
const quickOpen = ref(false);

const currentCat = computed(
  () => categories.value.find((c) => c.id === current.value?.categoryId) ?? categories.value[0],
);

// ---- 番茄钟（时长/开关/休息/通知均由设置中心控制） ----
const remainSec = ref(25 * 60);
const pomoPhase = ref<"focus" | "break">("focus");
const timerRunning = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
let reported = 0;

function pomoEnabled() {
  return sget("pomodoro_enabled") === "true";
}
function pomoMinutes() {
  return sgetNum("pomodoro_minutes", 25);
}
function breakMinutes() {
  return sgetNum("break_minutes", 5);
}

function bubbleText() {
  if (!current.value) {
    petState.value = "idle";
    bubble.value = t("pet.idle");
    return;
  }
  petState.value = timerRunning.value ? "working" : "paused";
  bubble.value = timerRunning.value
    ? t("pet.working", { p: currentCat.value?.pokemon ?? "", t: current.value.title })
    : t("pet.paused", { p: currentCat.value?.pokemon ?? "" });
}

async function refreshCurrent() {
  const prevId = current.value?.id ?? null;
  current.value = await api.getCurrentTask();
  if (!current.value) {
    stopTimerTick();
    timerRunning.value = false;
  } else if (current.value.id !== prevId && pomoEnabled()) {
    // 活动任务换了（本窗口切换，或主程序开始/完成、外部同步）→ 番茄钟跟随新任务
    startTimer();
  }
  bubbleText();
  if (quickOpen.value) await loadQuickList();
}

async function sendNotification(title: string, body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) {
      granted = (await n.requestPermission()) === "granted";
    }
    if (granted) n.sendNotification({ title, body });
  } catch {
    /* 通知不可用时静默，桌宠气泡兜底 */
  }
}

function startTimer() {
  if (!current.value) return;
  stopTimerTick();
  pomoPhase.value = "focus";
  remainSec.value = pomoMinutes() * 60;
  reported = 0;
  timerRunning.value = true;
  timer = setInterval(onTick, 1000);
  bubbleText();
}

function startBreak() {
  stopTimerTick();
  pomoPhase.value = "break";
  remainSec.value = breakMinutes() * 60;
  timerRunning.value = true;
  timer = setInterval(onTick, 1000);
  say(t("pet.breakStart"), false);
}

function onTick() {
  remainSec.value -= 1;
  if (pomoPhase.value === "focus") {
    const total = pomoMinutes() * 60;
    const elapsed = total - remainSec.value;
    if (elapsed - reported >= 60) {
      api.addFocusSeconds(current.value!.id, elapsed - reported).catch(() => {});
      reported = elapsed;
    }
  }
  if (remainSec.value <= 0) {
    stopTimerTick();
    if (pomoPhase.value === "focus") {
      petState.value = "urgent";
      bubble.value = t("pet.pomoDone", { t: current.value?.title ?? "" });
      if (sget("pomodoro_notify") === "true") {
        sendNotification(t("pet.pomoNotifTitle"), t("pet.pomoNotifBody", { t: current.value?.title ?? "" }));
      }
      if (breakMinutes() > 0) {
        startBreak();
      }
    } else {
      timerRunning.value = false;
      petState.value = "working";
      say(t("pet.breakEnd"));
    }
  }
}

function stopTimerTick() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function pauseTask() {
  stopTimerTick();
  timerRunning.value = false;
  await api.pauseCurrentTask();
  await refreshCurrent();
}

async function doneTask() {
  if (current.value) {
    stopTimerTick();
    timerRunning.value = false;
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
    if (pomoEnabled()) startTimer();
  }
}

const mmss = computed(() => {
  const m = Math.floor(remainSec.value / 60);
  const s = remainSec.value % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
});

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
    // 一半概率出引导，一半概率出随机撸宠台词
    say(Math.random() < 0.5 ? t("pet.quickPick") : randomQuote(), false);
  } else {
    say(randomQuote());
  }
  // 展开时把窗口调高，收起恢复（透明窗口，多余高度不可见）
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  await petWindow.setSize(new LogicalSize(300, quickOpen.value ? 590 : 330));
}
async function quickStart(id: number) {
  const taskTitle = candidates.value.find((x) => x.id === id)?.title;
  await api.startTask(id);
  await refreshCurrent();
  if (pomoEnabled()) startTimer();
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
// 移动超过阈值才算拖拽，否则视为点击——避免拖拽吞掉精灵的 click 事件
let pressX = 0;
let pressY = 0;
let dragging = false;
let dragStarted = false;
const dragWindow = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.closest("button") || target.closest(".quick-dex") || target.closest(".switcher")) return;
  if (e.button !== 0) return;
  pressX = e.screenX;
  pressY = e.screenY;
  dragging = true;
  dragStarted = false;
};
const dragMove = (e: MouseEvent) => {
  if (!dragging || dragStarted) return;
  if (Math.abs(e.screenX - pressX) > 4 || Math.abs(e.screenY - pressY) > 4) {
    dragStarted = true;
    petWindow.startDragging();
  }
};
const dragEnd = () => {
  dragging = false;
};

let unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  categories.value = await api.listCategories();
  await loadSettings();
  await refreshCurrent();

  unlisteners.push(
    await listen<{ id: number; title: string; urgent: boolean }>("task-reminder", (e) => {
      petState.value = e.payload.urgent ? "urgent" : "working";
      bubble.value = e.payload.urgent
        ? t("pet.remindUrgent", { t: e.payload.title })
        : t("pet.remindNormal", { t: e.payload.title });
      setTimeout(bubbleText, 15000);
    }),
  );
  // 主程序或外部同步改动数据时跟随刷新，保持两窗口状态一致
  unlisteners.push(await listen<null>("tasks-changed", refreshCurrent));
  unlisteners.push(
    await listen<null>("categories-changed", async () => {
      categories.value = await api.listCategories();
    }),
  );
  let settingsDebounce: ReturnType<typeof setTimeout> | null = null;
  unlisteners.push(
    await listen<null>("settings-changed", () => {
      // 设置保存是逐键写入，去抖后统一重载（语言经 i18n watchEffect 即时切换）
      if (settingsDebounce) clearTimeout(settingsDebounce);
      settingsDebounce = setTimeout(async () => {
        await loadSettings();
        if (!pomoEnabled()) {
          stopTimerTick();
          timerRunning.value = false;
        }
        bubbleText();
      }, 200);
    }),
  );
});
onUnmounted(() => {
  unlisteners.forEach((u) => u());
  if (clickTimer) clearTimeout(clickTimer);
});
</script>

<template>
  <div class="pet-stage" @mousedown="dragWindow" @mousemove="dragMove" @mouseup="dragEnd" @mouseleave="dragEnd">
    <!-- 初代战斗布局：精灵在上。命中区固定不动（蹦跳动画在 img 上），保证双击稳定触发 -->
    <div class="sprite-hit" @click="onSpriteClick" @dblclick="onSpriteDblClick">
      <img
        class="pet-sprite"
        :class="[petState, { petted }]"
        :src="spriteUrl(currentCat?.sprite ?? 'pikachu')"
        :data-sprite="currentCat?.sprite ?? 'pikachu'"
        @error="spriteFallback"
        draggable="false"
        :title="t('pet.spriteTitle')"
      />
    </div>
    <div class="cat-tag" v-if="current">
      {{ currentCat?.name }} · {{ currentCat?.pokemon }}
    </div>

    <!-- 全宽对话框在下 -->
    <div class="dialog" :class="{ alert: petState === 'urgent' }">
      <div class="dialog-inner">
        <span class="dialog-text">{{ bubble }}</span>
        <span class="dialog-next">▼</span>
      </div>
    </div>

    <!-- 番茄钟 -->
    <div v-if="current && pomoEnabled()" class="pomo-pill" :class="{ break: pomoPhase === 'break' }">
      <span class="px">{{ pomoPhase === "break" ? "☕" : "🍅" }} {{ mmss }}</span>
      <button class="pomo-btn" v-if="timerRunning" @click="pauseTask">⏸</button>
      <button class="pomo-btn" v-else @click="resume">▶</button>
      <button class="pomo-btn" @click="doneTask">✔</button>
      <button class="pomo-btn" @click="openSwitcher">⇄</button>
    </div>

    <!-- 快捷图鉴屏：点精灵展开 -->
    <div v-if="quickOpen" class="quick-dex">
      <div class="hinge"></div>
      <div class="lcd screen">
        <h4 class="px">ADVENTURE</h4>
        <div
          v-for="t in candidates"
          :key="t.id"
          class="q-item"
          :class="{ sel: quickSel === t.id, active: t.status === 'active' }"
          @click="quickSel = t.id"
          @dblclick="quickStart(t.id)"
        >
          <span class="cursor">▶</span>
          <span class="q-title">{{ t.title }}</span>
          <span class="px q-no">{{ String(t.id).padStart(3, "0") }}</span>
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
      <button v-for="t in candidates" :key="t.id" class="switch-item" @click="switchTo(t)">
        {{ t.title }}
      </button>
      <button class="switch-item cancel" @click="switching = false">{{ t("pet.switchCancel") }}</button>
    </div>
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
.dialog.alert { animation: pk-shake 0.4s 3; }
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
.pet-sprite.working { animation: pk-hop 1.6s ease-in-out infinite; }
.pet-sprite.paused { filter: grayscale(0.6); }
.pet-sprite.idle { animation: pk-hop 3s ease-in-out infinite; }
/* 撸宠反馈：快速弹跳 */
.pet-sprite.petted { animation: pk-petted 0.45s ease-out 2; }
@keyframes pk-petted {
  0% { transform: scale(1); }
  40% { transform: scale(1.18) rotate(-4deg); }
  70% { transform: scale(0.95) rotate(3deg); }
  100% { transform: scale(1); }
}

/* 番茄钟药丸 */
.pomo-pill {
  margin-top: 8px;
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 3px solid var(--dex-navy); border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy); padding: 5px 10px;
}
.pomo-pill .px { font-size: 12px; color: var(--dex-red); }
.pomo-pill.break { border-color: #3c5aa6; box-shadow: 4px 4px 0 #3c5aa6; }
.pomo-pill.break .px { color: #3c5aa6; }
.pomo-btn {
  width: 30px; height: 30px; border: 3px solid var(--dex-navy); border-radius: 6px;
  background: var(--poke-yellow); cursor: pointer; font-size: 13px;
  box-shadow: 2px 2px 0 var(--dex-navy); font-family: inherit;
}
.pomo-btn:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 var(--dex-navy); }

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
  position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
  width: 46px; height: 14px; background: var(--dex-red-dark);
  border: 3px solid var(--dex-navy); border-radius: 6px;
}
.screen { padding: 10px; max-height: 220px; overflow-y: auto; }
.screen h4 { font-size: 9px; letter-spacing: 1px; margin-bottom: 8px; }
.q-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700;
  padding: 6px 5px; border-radius: 4px; cursor: pointer;
  color: var(--lcd-text);
}
.q-item .cursor { opacity: 0; font-size: 9px; flex: none; }
.q-item.sel .cursor { opacity: 1; }
.q-item.sel { background: rgba(58, 74, 50, 0.15); outline: 2px solid var(--lcd-text); }
.q-item.active .q-title::after { content: " ♪"; }
.q-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-no { font-size: 8px; opacity: 0.8; }
.q-empty { font-size: 12px; padding: 12px 4px; }
.quick-dex .ops { display: flex; gap: 6px; margin-top: 12px; }
.quick-dex .ops .btn { flex: 1; text-align: center; font-size: 12px; padding: 8px 2px; min-height: 36px; }

/* 切换浮层 */
.switcher {
  position: absolute;
  top: 0; left: 0; right: 0;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 6px;
  display: flex; flex-direction: column; gap: 4px;
  z-index: 20;
}
.switcher-title { font-size: 12px; color: #9a937f; text-align: center; }
.switch-item {
  border: 3px solid var(--dex-navy); border-radius: 6px;
  background: var(--poke-yellow);
  padding: 6px; font-size: 12px; font-weight: 700; text-align: left; cursor: pointer;
  font-family: inherit;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.switch-item.cancel { background: #fff; text-align: center; color: #999; }
</style>
