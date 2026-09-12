<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fmtDate, fmtTime } from "../stores/settings";
import DexSelect from "./DexSelect.vue";

/** 图鉴风日期时间选择器：原生 datetime-local 在 WebKitGTK 下缺时间、英文界面、弹层失控 */
const model = defineModel<string>({ default: "" });
const { t, locale } = useI18n();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

// 日历视图状态
const now = new Date();
const viewY = ref(now.getFullYear());
const viewM = ref(now.getMonth());

const intlLocale = computed(
  () => ({ "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", en: "en-US" })[locale.value as string] ?? "zh-CN",
);

const monthTitle = computed(() =>
  new Intl.DateTimeFormat(intlLocale.value, { year: "numeric", month: "long" }).format(
    new Date(viewY.value, viewM.value, 1),
  ),
);
/** 周一开头的星期标题 */
const weekdays = computed(() => {
  const fmt = new Intl.DateTimeFormat(intlLocale.value, { weekday: "narrow" });
  // 2026-09-07 是周一
  return [...Array(7)].map((_, i) => fmt.format(new Date(2026, 8, 7 + i)));
});

const todayStr = computed(() => toKey(now.getFullYear(), now.getMonth(), now.getDate()));
const selDateStr = computed(() => (model.value ? model.value.slice(0, 10) : ""));

/** 日历格子：前置留白 + 当月天数 */
const cells = computed(() => {
  const days = new Date(viewY.value, viewM.value + 1, 0).getDate();
  const firstDay = new Date(viewY.value, viewM.value, 1).getDay();
  const lead = (firstDay + 6) % 7; // 周一为一周开始
  return [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
});

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function prevMonth() {
  viewM.value -= 1;
  if (viewM.value < 0) {
    viewM.value = 11;
    viewY.value -= 1;
  }
}
function nextMonth() {
  viewM.value += 1;
  if (viewM.value > 11) {
    viewM.value = 0;
    viewY.value += 1;
  }
}
function pickDay(d: number) {
  const date = toKey(viewY.value, viewM.value, d);
  model.value = `${date}T${hourPart.value}:${minutePart.value}`;
}

// ---- 时间部分 ----
function parts(): [string, string] {
  const m = model.value || "";
  const time = m.includes("T") ? m.split("T")[1] : "";
  const seg = time.split(":");
  return [seg[0] || "09", seg[1] || "00"];
}
const hourPart = computed(() => parts()[0]);
const minutePart = computed(() => parts()[1]);
const hourOptions = [...Array(24)].map((_, h) => ({
  value: String(h).padStart(2, "0"),
  label: String(h).padStart(2, "0"),
}));
const minuteOptions = [...Array(12)].map((_, i) => {
  const v = String(i * 5).padStart(2, "0");
  return { value: v, label: v };
});
function setTime(which: "h" | "m", v: string) {
  const date = selDateStr.value || toKey(now.getFullYear(), now.getMonth(), now.getDate());
  const [h, mi] = parts();
  model.value = `${date}T${which === "h" ? v : h}:${which === "m" ? v : mi}`;
}
function clearAll() {
  model.value = "";
  open.value = false;
}

const display = computed(() => (model.value ? `${fmtDate(model.value)} ${fmtTime(model.value)}` : t("dt.none")));

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="dex-dt">
    <button type="button" class="dt-btn" :class="{ open, none: !model }" @click="open = !open">
      <span class="dt-label">🕐 {{ display }}</span>
      <span class="ds-arrow">▼</span>
    </button>

    <div v-if="open" class="dt-pop">
      <!-- 月份导航 -->
      <div class="dt-nav">
        <button type="button" class="nav-btn" @click="prevMonth">◀</button>
        <span class="dt-title">{{ monthTitle }}</span>
        <button type="button" class="nav-btn" @click="nextMonth">▶</button>
      </div>
      <!-- 日历 -->
      <div class="dt-grid">
        <span v-for="(w, i) in weekdays" :key="'w' + i" class="dt-week">{{ w }}</span>
        <template v-for="(c, i) in cells" :key="'c' + i">
          <span v-if="c === 0" class="dt-day blank" />
          <button
            v-else
            type="button"
            class="dt-day"
            :class="{
              sel: toKey(viewY, viewM, c) === selDateStr,
              today: toKey(viewY, viewM, c) === todayStr,
            }"
            @click="pickDay(c)"
          >
            {{ c }}
          </button>
        </template>
      </div>
      <!-- 时间 -->
      <div class="dt-time">
        <DexSelect :model-value="hourPart" :options="hourOptions" @update:model-value="setTime('h', $event)" />
        <span class="colon">:</span>
        <DexSelect :model-value="minutePart" :options="minuteOptions" @update:model-value="setTime('m', $event)" />
        <button type="button" class="clear-btn" @click="clearAll">{{ t("dt.clear") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dex-dt {
  position: relative;
}
.dt-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  color: var(--dex-navy);
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  padding: 7px 10px;
  min-height: 38px;
  min-width: 176px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.dt-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.dt-btn.open {
  background: var(--poke-yellow);
}
/* 文字占满剩余宽度，箭头固定贴选择框右缘（短文案时也不会紧贴文字） */
.dt-label {
  flex: 1;
  text-align: left;
}
.dt-btn.none .dt-label {
  color: #9a937f;
}
.ds-arrow {
  font-size: 9px;
}

.dt-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px;
  width: 268px;
}
.dt-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dt-title {
  font-size: 13px;
  font-weight: 800;
}
.nav-btn {
  border: 3px solid var(--dex-navy);
  border-radius: 6px;
  background: var(--dex-body);
  width: 26px;
  height: 26px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.nav-btn:active {
  transform: translate(1px, 1px);
}
.dt-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.dt-week {
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  color: #9a937f;
  padding: 2px 0;
}
.dt-day {
  border: 2px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  color: var(--dex-navy);
  height: 28px;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
}
.dt-day.blank {
  pointer-events: none;
}
.dt-day:hover {
  background: #fff3c4;
}
.dt-day.today {
  border-color: var(--dex-navy);
}
.dt-day.sel {
  background: var(--poke-yellow);
  border-color: var(--dex-navy);
}
.dt-time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
/* 内嵌的时/分下拉收窄，避免撑爆弹层 */
.dt-time :deep(.ds-btn) {
  min-width: 0;
  width: 80px;
  padding: 7px 6px;
}
.dt-time :deep(.ds-label) {
  justify-content: center;
}
.colon {
  font-weight: 800;
}
.clear-btn {
  margin-left: auto;
  border: 3px solid var(--dex-navy);
  border-radius: 6px;
  background: #fff;
  color: var(--dex-red);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 8px;
  cursor: pointer;
  font-family: inherit;
}
</style>
