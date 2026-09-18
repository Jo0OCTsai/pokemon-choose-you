<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import { useTagsStore } from "../stores/tags";
import { useTasksStore } from "../stores/tasks";
import type { TagCheckupReport, Task } from "../types";

/**
 * 每周回顾向导（「训练家复盘」）：
 * 总览 → 路线逐站复盘 → 草丛批量归位 → 标签体检（词表治理）→ 收尾标记本周已复盘。
 * OmniFocus 内置 Review 但无提醒；这里提醒由后端 scheduler 每周触发。
 */
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const categories = useCategoriesStore();
const tasksStore = useTasksStore();
const tagsStore = useTagsStore();

const step = ref(0);
const busy = ref(false);

/** 本周完成的任务（completedAt 距今 7 天内） */
const weekDone = computed(() =>
  tasksStore.done.filter((t) => {
    if (!t.completedAt) return false;
    const d = new Date(t.completedAt.length === 16 ? t.completedAt + ":00" : t.completedAt);
    return Date.now() - d.getTime() < 7 * 86400_000;
  }),
);
const weekFocusMin = computed(() => Math.round(weekDone.value.reduce((s, x) => s + x.focusSeconds, 0) / 60));
const byCategory = computed(() => {
  const map = new Map<string, number>();
  for (const t of weekDone.value) {
    const name = categories.byId.get(t.categoryId)?.name ?? "?";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
});

// ---- 路线逐站复盘 ----
const routeTasks = computed(() =>
  tasksStore.open.filter((t) => t.status === "scheduled" || t.status === "active" || t.status === "paused"),
);
const routeIdx = ref(0);
const routeDoneCount = ref(0);
const current = computed(() => routeTasks.value[routeIdx.value] ?? null);
// 处置后列表缩短：索引夹回末位，避免停在空位而列表还有待复盘项
watch(
  () => routeTasks.value.length,
  (len) => {
    if (len > 0 && routeIdx.value >= len) routeIdx.value = len - 1;
  },
);
const overdue = (t: Task) => Boolean(t.dueAt) && t.dueAt!.slice(0, 10) <= new Date().toISOString().slice(0, 10);

async function routeAction(action: "keep" | "done" | "toGrass" | "escape") {
  const t = current.value;
  if (!t || busy.value) return;
  if (action === "keep") {
    routeIdx.value += 1;
    return;
  }
  busy.value = true;
  try {
    if (action === "done") {
      await api.updateTask({ id: t.id, status: "done" });
      routeDoneCount.value += 1;
    } else if (action === "toGrass") {
      // 清掉截止时间 → 草丛不变量归位 inbox
      await api.updateTask({ id: t.id, dueAt: null });
    } else {
      await api.updateTask({ id: t.id, status: "cancelled" });
    }
    await tasksStore.reload();
    // 列表来自 store 快照：索引不动即指向下一条
  } finally {
    busy.value = false;
  }
}

// ---- 草丛批量归位 ----
const grassSelected = ref(new Set<number>());
const grassTasks = computed(() => tasksStore.open.filter((t) => t.status === "inbox"));
const grassAllSelected = computed(
  () => grassTasks.value.length > 0 && grassTasks.value.every((t) => grassSelected.value.has(t.id)),
);
function toggleGrassAll() {
  grassSelected.value = grassAllSelected.value ? new Set() : new Set(grassTasks.value.map((t) => t.id));
}
function toggleGrassOne(id: number) {
  const next = new Set(grassSelected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  grassSelected.value = next;
}
const releasedCount = ref(0);
async function releaseGrass() {
  if (busy.value || !grassSelected.value.size) return;
  busy.value = true;
  try {
    for (const id of [...grassSelected.value]) {
      await api.deleteTask(id);
      releasedCount.value += 1;
    }
    grassSelected.value = new Set();
    await tasksStore.reload();
  } finally {
    busy.value = false;
  }
}

// ---- 标签体检（词表治理：合并近义 / 放生僵尸 / 采纳新维度） ----
const checkup = ref<TagCheckupReport | null>(null);
const checking = ref(false);
const checkupError = ref("");
const tagBusy = ref(false);

/** 进入体检步自动跑一次（本次打开向导只跑一次，结果缓存在内存里） */
watch(step, (s) => {
  if (s === 3 && !checkup.value && !checking.value) runCheckup();
});

async function runCheckup() {
  checking.value = true;
  checkupError.value = "";
  try {
    await tagsStore.load().catch(() => {});
    checkup.value = await api.tagCheckup();
  } catch (e) {
    checkupError.value = String(e);
  } finally {
    checking.value = false;
  }
}

const dimName = (key: string) => tagsStore.dimByKey.get(key)?.name ?? key;

async function doTagAction(fn: () => Promise<unknown>) {
  if (tagBusy.value) return;
  tagBusy.value = true;
  try {
    await fn();
    await tagsStore.load().catch(() => {});
  } finally {
    tagBusy.value = false;
  }
}

const mergeTagRow = (m: NonNullable<TagCheckupReport["merges"][number]>) =>
  doTagAction(async () => {
    await api.mergeTag(m.fromId, m.intoId);
    checkup.value!.merges = checkup.value!.merges.filter((x) => x !== m);
  });
const ignoreMerge = (m: NonNullable<TagCheckupReport["merges"][number]>) => {
  checkup.value!.merges = checkup.value!.merges.filter((x) => x !== m);
};
const releaseZombie = (z: NonNullable<TagCheckupReport["zombies"][number]>) =>
  doTagAction(async () => {
    await api.deleteTag(z.id);
    checkup.value!.zombies = checkup.value!.zombies.filter((x) => x !== z);
  });
const keepZombie = (z: NonNullable<TagCheckupReport["zombies"][number]>) => {
  checkup.value!.zombies = checkup.value!.zombies.filter((x) => x !== z);
};
/** 采纳新维度：名字转 slug 作 key（非 ascii 回落 dim- 时间戳），标签按名找 id 迁过去 */
const adoptDimension = (d: NonNullable<TagCheckupReport["newDimensions"][number]>) =>
  doTagAction(async () => {
    const ids = d.tags.map((n) => tagsStore.list.find((x) => x.name === n)?.id).filter((v): v is number => v != null);
    if (!ids.length) {
      checkup.value!.newDimensions = checkup.value!.newDimensions.filter((x) => x !== d);
      return;
    }
    const slug = d.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const key = slug || `dim-${Date.now().toString(36)}`;
    await api.moveTagsToDimension(ids, key, d.name);
    checkup.value!.newDimensions = checkup.value!.newDimensions.filter((x) => x !== d);
  });
const ignoreDimension = (d: NonNullable<TagCheckupReport["newDimensions"][number]>) => {
  checkup.value!.newDimensions = checkup.value!.newDimensions.filter((x) => x !== d);
};

// ---- 收尾 ----
async function finish() {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await api.setSetting("review_last_done", date).catch(() => {});
  await tasksStore.reload();
  emit("close");
}

const steps = computed(() => [
  t("review.stepOverview"),
  t("review.stepRoute"),
  t("review.stepGrass"),
  t("review.stepTags"),
  t("review.stepDone"),
]);
function next() {
  step.value = Math.min(step.value + 1, 4);
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="card">
      <h3>🧢 {{ t("review.title") }}</h3>

      <!-- 步骤条 -->
      <div class="steps">
        <span v-for="(label, i) in steps" :key="i" class="step-dot" :class="{ on: i === step, past: i < step }">
          {{ i < step ? "✔" : i + 1 }} {{ label }}
        </span>
      </div>

      <!-- 1. 总览 -->
      <div v-if="step === 0" class="body">
        <div class="stat-row">
          <div class="stat">
            <div class="num">{{ weekDone.length }}</div>
            <div class="lbl">{{ t("review.caughtWeek") }}</div>
          </div>
          <div class="stat">
            <div class="num">{{ weekFocusMin }}</div>
            <div class="lbl">{{ t("review.focusWeek") }}</div>
          </div>
          <div class="stat">
            <div class="num">{{ routeTasks.length }}</div>
            <div class="lbl">{{ t("review.onRoute") }}</div>
          </div>
          <div class="stat">
            <div class="num">{{ grassTasks.length }}</div>
            <div class="lbl">{{ t("review.inGrass") }}</div>
          </div>
        </div>
        <div v-if="byCategory.length" class="cat-bars">
          <div v-for="[name, n] in byCategory" :key="name" class="cat-bar">
            <span class="cat-name">{{ name }}</span>
            <div class="bar"><i :style="{ width: `${Math.min(100, (n / (weekDone.length || 1)) * 100)}%` }"></i></div>
            <span class="cat-n">{{ n }}</span>
          </div>
        </div>
        <p class="tip">{{ t("review.overviewTip") }}</p>
      </div>

      <!-- 2. 路线逐站复盘 -->
      <div v-else-if="step === 1" class="body">
        <template v-if="current">
          <div class="station lcd">
            <div class="st-no px">No.{{ String(current.id).padStart(3, "0") }}</div>
            <div class="st-title">{{ current.title }}</div>
            <div class="st-meta">
              <span v-if="current.dueAt" :class="{ overdue: overdue(current) }">
                🕒 {{ fmtDateTime(current.dueAt) }}{{ overdue(current) ? ` · ${t("review.overdue")}` : "" }}
              </span>
              <span>{{ categories.byId.get(current.categoryId)?.name }}</span>
              <span>{{ t(`priority.${current.priority}`) }}</span>
              <span>{{ t(`status.${current.status}`) }}</span>
            </div>
            <p v-if="current.note" class="st-note">{{ current.note }}</p>
          </div>
          <div class="btn-row">
            <button class="btn" :disabled="busy" @click="routeAction('keep')">{{ t("review.keep") }}</button>
            <button class="btn" :disabled="busy" @click="routeAction('done')">✔ {{ t("review.complete") }}</button>
            <button class="btn ghost" :disabled="busy" @click="routeAction('toGrass')">
              {{ t("review.toGrass") }}
            </button>
            <button class="btn ghost" :disabled="busy" @click="routeAction('escape')">
              🚪 {{ t("review.escape") }}
            </button>
          </div>
          <p class="tip">{{ routeIdx + 1 }} / {{ routeTasks.length }} · {{ t("review.routeTip") }}</p>
        </template>
        <p v-else class="empty">{{ t("review.routeEmpty") }}</p>
      </div>

      <!-- 3. 草丛批量归位 -->
      <div v-else-if="step === 2" class="body">
        <div class="grass-head">
          <label class="batch-check">
            <input type="checkbox" :checked="grassAllSelected" @change="toggleGrassAll" />
            {{ t("review.selectAllGrass") }}（{{ grassTasks.length }}）
          </label>
          <button class="btn ghost" :disabled="!grassSelected.size || busy" @click="releaseGrass">
            🌿 {{ t("review.releaseGrass") }}{{ grassSelected.size ? `（${grassSelected.size}）` : "" }}
          </button>
        </div>
        <ul class="grass-list">
          <li v-if="!grassTasks.length" class="empty">{{ t("review.grassEmpty") }}</li>
          <li v-for="g in grassTasks" :key="g.id" class="grass-item">
            <input type="checkbox" :checked="grassSelected.has(g.id)" @change="toggleGrassOne(g.id)" />
            <span class="g-title">{{ g.title }}</span>
            <span class="g-cat">{{ categories.byId.get(g.categoryId)?.name }}</span>
          </li>
        </ul>
        <p v-if="releasedCount" class="tip">{{ t("review.released", { n: releasedCount }) }}</p>
      </div>

      <!-- 4. 标签体检 -->
      <div v-else-if="step === 3" class="body">
        <p v-if="checking" class="empty">{{ t("review.tagChecking") }}</p>
        <p v-else-if="checkupError" class="empty">
          {{ t("review.tagCheckFailed") }}
          <button class="btn ghost mini" @click="runCheckup">{{ t("review.tagRetry") }}</button>
        </p>
        <template v-else-if="checkup">
          <!-- 合并建议 -->
          <section v-if="checkup.merges.length">
            <h4 class="tg-title">{{ t("review.tagMerges") }}</h4>
            <div v-for="m in checkup.merges" :key="m.fromId" class="tg-row">
              <span class="tg-main">
                「{{ m.fromName }}」→「{{ m.intoName }}」
                <i class="tg-dim">{{ dimName(m.dimension) }} · {{ Math.round(m.similarity * 100) }}%</i>
              </span>
              <span v-if="m.reason" class="tg-reason">💡 {{ m.reason }}</span>
              <button class="btn ghost mini" :disabled="tagBusy" @click="mergeTagRow(m)">
                {{ t("review.tagMerge") }}
              </button>
              <button class="btn ghost mini del" :disabled="tagBusy" @click="ignoreMerge(m)">
                {{ t("review.tagIgnore") }}
              </button>
            </div>
          </section>

          <!-- 僵尸标签 -->
          <section v-if="checkup.zombies.length">
            <h4 class="tg-title">{{ t("review.tagZombies") }}</h4>
            <div v-for="z in checkup.zombies" :key="z.id" class="tg-row">
              <span class="tg-main">
                # {{ z.name }}
                <i class="tg-dim">{{ dimName(z.dimension) }} · {{ t("review.tagOrigin." + z.origin, z.origin) }}</i>
              </span>
              <button class="btn ghost mini del" :disabled="tagBusy" @click="releaseZombie(z)">
                {{ t("review.tagRelease") }}
              </button>
              <button class="btn ghost mini" :disabled="tagBusy" @click="keepZombie(z)">
                {{ t("review.tagKeep") }}
              </button>
            </div>
          </section>

          <!-- 新维度建议 -->
          <section v-if="checkup.newDimensions.length">
            <h4 class="tg-title">{{ t("review.tagNewDims") }}</h4>
            <div v-for="d in checkup.newDimensions" :key="d.name" class="tg-row">
              <span class="tg-main"> {{ d.name }}：{{ d.tags.join("、") }} </span>
              <span v-if="d.reason" class="tg-reason">💡 {{ d.reason }}</span>
              <button class="btn ghost mini" :disabled="tagBusy" @click="adoptDimension(d)">
                {{ t("review.tagAdopt") }}
              </button>
              <button class="btn ghost mini del" :disabled="tagBusy" @click="ignoreDimension(d)">
                {{ t("review.tagIgnore") }}
              </button>
            </div>
          </section>

          <p v-if="!checkup.merges.length && !checkup.zombies.length && !checkup.newDimensions.length" class="empty">
            {{ t("review.tagClean") }}
          </p>
          <p v-if="!checkup.judged" class="tip">{{ t("review.tagUnjudged") }}</p>
          <p v-else class="tip">{{ t("review.tagTip") }}</p>
        </template>
      </div>

      <!-- 5. 收尾 -->
      <div v-else class="body">
        <div class="fin">
          <div class="fin-emoji">🎉</div>
          <p>{{ t("review.finishLine", { n: weekDone.length + routeDoneCount }) }}</p>
          <p class="tip">{{ t("review.finishTip") }}</p>
        </div>
      </div>

      <div class="btn-row foot">
        <button v-if="step < 4" class="btn" :disabled="busy" @click="next">
          {{ step === 1 && current ? t("review.skipRoute") : t("review.next") }}
        </button>
        <button v-if="step === 4" class="btn" @click="finish">{{ t("review.finish") }}</button>
        <button class="btn ghost" @click="emit('close')">{{ t("cancel") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(28, 34, 68, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 6px 6px 0 var(--dex-navy);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}
.card h3 {
  margin: 0;
  font-size: 15px;
}
.steps {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  font-weight: 700;
}
.step-dot {
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--dex-navy);
  background: #fff;
}
.step-dot.on {
  background: var(--poke-yellow);
}
.step-dot.past {
  background: #dff3e4;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}
.stat-row {
  display: flex;
  gap: 8px;
}
.stat {
  flex: 1;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: var(--lcd);
  text-align: center;
  padding: 8px 4px;
}
.stat .num {
  font-size: 22px;
  font-weight: 800;
  color: var(--dex-navy);
}
.stat .lbl {
  font-size: 10px;
  color: #7b7460;
}
.cat-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cat-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.cat-name {
  width: 44px;
  flex: none;
  font-weight: 700;
  color: var(--dex-navy);
}
.bar {
  flex: 1;
  height: 12px;
  border: 2px solid var(--dex-navy);
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--poke-yellow);
}
.cat-n {
  flex: none;
  font-weight: 800;
  color: var(--dex-navy);
}
.tip {
  font-size: 11px;
  color: #9a937f;
  margin: 0;
}
.station {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--lcd);
}
.st-no {
  font-size: 9px;
  letter-spacing: 1px;
}
.st-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--dex-navy);
  margin: 4px 0;
}
.st-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #555;
}
.st-meta .overdue {
  color: var(--dex-red);
  font-weight: 800;
}
.st-note {
  font-size: 12px;
  color: #666;
  margin: 6px 0 0;
}
.btn-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-row.foot {
  border-top: 2px dashed #d8d2c0;
  padding-top: 10px;
}
.empty {
  color: #9a937f;
  text-align: center;
  padding: 40px 0;
  font-size: 13px;
}
.grass-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  cursor: pointer;
}
.grass-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.grass-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 2px solid var(--dex-navy);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
}
.g-title {
  font-weight: 700;
  color: var(--dex-navy);
}
.g-cat {
  margin-left: auto;
  font-size: 11px;
  color: #7b7460;
}
/* 标签体检 */
.tg-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--dex-navy);
}
.tg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 2px solid var(--dex-navy);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  margin-bottom: 6px;
}
.tg-main {
  font-weight: 700;
  color: var(--dex-navy);
}
.tg-dim {
  font-style: normal;
  font-size: 10.5px;
  color: #9a937f;
  margin-left: 4px;
}
.tg-reason {
  font-size: 11px;
  color: #7b7460;
  flex: 1;
  min-width: 120px;
}
.btn.mini {
  padding: 3px 10px;
  min-height: 26px;
  font-size: 11.5px;
}
.btn.mini.del {
  color: var(--dex-red);
}
.fin {
  text-align: center;
  padding: 16px 0;
}
.fin-emoji {
  font-size: 40px;
}
.fin p {
  font-size: 14px;
  font-weight: 800;
  color: var(--dex-navy);
}
</style>
