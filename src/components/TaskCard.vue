<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { fmtDateTime, useSettingsStore } from "../stores/settings";
import { catKeyOf, useCategoriesStore } from "../stores/categories";
import { relativeDue } from "../relativeTime";
import type { Task } from "../types";
import { clipWrite, openContextMenu, type ContextMenuItem } from "../contextMenu";
import PokemonSprite from "./PokemonSprite.vue";

const props = defineProps<{ task: Task; allowSchedule?: boolean }>();
const emit = defineEmits<{
  start: [task: Task];
  pause: [];
  complete: [task: Task];
  uncomplete: [task: Task];
  cancel: [task: Task];
  schedule: [task: Task];
  edit: [task: Task];
  remove: [task: Task];
  detail: [task: Task];
}>();

const { t } = useI18n();
const categories = useCategoriesStore();
const settings = useSettingsStore();
const spriteOf = (id: number) => categories.byId.get(id)?.sprite ?? "pikachu";

/** 相对截止时间（时间盲友好）：开关关闭时回绝对时间；title 始终带绝对值便于核对 */
const dueInfo = computed(() => (settings.bool("due_relative") ? relativeDue(props.task.dueAt ?? "") : null));

/** 右键菜单：动作与卡片按钮一一对应（同 emit 复用 TaskTab 的处理器）+ 详情/复制标题 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const task = props.task;
  const items: ContextMenuItem[] = [];
  const editable = task.status !== "done" && task.status !== "cancelled";
  if (editable) {
    if (task.status === "active") {
      items.push({ key: "pause", label: t("entry.pause"), action: () => emit("pause") });
    } else {
      items.push({ key: "start", label: t("entry.start"), action: () => emit("start", task) });
    }
    if (props.allowSchedule) {
      items.push({ key: "route", label: t("entry.route"), action: () => emit("schedule", task) });
    }
    items.push(
      { key: "edit", label: t("entry.edit"), action: () => emit("edit", task) },
      { key: "done", label: t("entry.done"), action: () => emit("complete", task) },
      { key: "escape", label: t("entry.escape"), action: () => emit("cancel", task) },
      { key: "release", label: t("entry.release"), danger: true, action: () => emit("remove", task) },
    );
  } else {
    items.push(
      { key: "undo", label: t("entry.undo"), action: () => emit("uncomplete", task) },
      { key: "edit", label: t("entry.edit"), action: () => emit("edit", task) },
      { key: "release", label: t("entry.release"), danger: true, action: () => emit("remove", task) },
    );
  }
  items.push(
    { key: "detail", label: t("ctx.openDetail"), action: () => emit("detail", task) },
    { key: "copyTitle", label: t("ctx.copyTitle"), action: () => void clipWrite(task.title) },
  );
  openContextMenu(e, items);
}
</script>

<template>
  <li
    class="entry"
    :class="{ active: task.status === 'active', caught: task.status === 'done', escaped: task.status === 'cancelled' }"
    @click="emit('detail', task)"
    @contextmenu="onContextMenu"
  >
    <div class="dex-no px">No.{{ String(task.id).padStart(3, "0") }}</div>
    <PokemonSprite class="sprite" :sprite="spriteOf(task.categoryId)" />
    <div class="info">
      <div class="row1">
        <span class="prio" :class="task.priority" />
        <span class="title">{{ task.title }}</span>
        <span v-if="task.status === 'active'" class="tag-now">{{ t("entry.catching") }}</span>
        <span v-if="task.status === 'paused'" class="tag-paused">{{ t("entry.paused") }}</span>
        <span class="badge" :class="'b-' + catKeyOf(categories.byId, task.categoryId)">
          {{ categories.byId.get(task.categoryId)?.name }}
        </span>
      </div>
      <div class="row2">
        <span
          v-if="task.dueAt"
          class="due"
          :class="dueInfo ? `due-${dueInfo.level}` : ''"
          :title="fmtDateTime(task.dueAt)"
        >
          {{ t("entry.due", { v: dueInfo ? dueInfo.text : fmtDateTime(task.dueAt) }) }}
        </span>
        <span v-if="task.remindAt">{{ t("entry.remind", { v: fmtDateTime(task.remindAt) }) }}</span>
        <span v-if="task.focusSeconds > 0">{{ t("entry.focus", { n: Math.round(task.focusSeconds / 60) }) }}</span>
        <span v-if="task.source !== 'local'">
          {{ t("entry.from", { src: task.source === "feishu" ? t("entry.feishu") : task.source }) }}
        </span>
        <span v-if="task.tags.length" class="tag-list">
          <i
            v-for="r in task.tags"
            :key="r.dimension + ':' + r.name"
            class="tag-chip"
            :class="{ 'chip-project': r.dimension === 'project' }"
            >{{ r.dimension === "project" ? "⛳ " : "# " }}{{ r.name }}</i
          >
        </span>
      </div>
    </div>
    <div class="ops" @click.stop>
      <template v-if="task.status !== 'done' && task.status !== 'cancelled'">
        <button v-if="task.status !== 'active'" class="btn" @click="emit('start', task)">
          {{ t("entry.start") }}
        </button>
        <button v-else class="btn ghost" @click="emit('pause')">{{ t("entry.pause") }}</button>
        <button v-if="allowSchedule" class="btn ghost icon" :title="t('entry.route')" @click="emit('schedule', task)">
          📅
        </button>
        <button class="btn ghost icon" :title="t('entry.edit')" @click="emit('edit', task)">✎</button>
        <button class="btn" :title="t('entry.done')" @click="emit('complete', task)">✔</button>
        <button class="btn ghost icon esc" :title="t('entry.escape')" @click="emit('cancel', task)">🚪</button>
        <button class="btn ghost icon del" :title="t('entry.release')" @click="emit('remove', task)">✕</button>
      </template>
      <template v-else-if="task.status === 'done'">
        <span class="catch-mark">{{ t("entry.caught") }}</span>
        <button class="btn ghost" @click="emit('uncomplete', task)">{{ t("entry.undo") }}</button>
      </template>
      <template v-else>
        <span class="catch-mark escape-mark">{{ t("entry.escaped") }}</span>
        <button class="btn ghost" @click="emit('uncomplete', task)">{{ t("entry.undo") }}</button>
      </template>
    </div>
  </li>
</template>

<style scoped>
/* 图鉴条目卡 */
.entry {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  list-style: none;
  cursor: pointer;
}
.entry.active {
  outline: 3px solid var(--poke-yellow);
  outline-offset: 2px;
}
.dex-no {
  font-size: 9px;
  color: #9a937f;
  align-self: flex-start;
  margin-top: 3px;
  width: 50px;
  flex: none;
}
.sprite {
  width: 52px;
  height: 52px;
  flex: none;
  image-rendering: pixelated;
  object-fit: contain;
}
.entry.active .sprite {
  animation: pk-hop 1.6s ease-in-out infinite;
}
.info {
  flex: 1;
  min-width: 0;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.title {
  font-size: 16px;
  font-weight: 800;
}
.tag-now {
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  background: var(--dex-navy);
  border-radius: 4px;
  padding: 2px 7px;
}
.tag-now::before {
  content: "♪ ";
}
.tag-paused {
  font-size: 11px;
  font-weight: 800;
  color: #a1660a;
  background: var(--type-work);
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 6px;
}
.row2 {
  font-size: 12.5px;
  color: #7b7460;
  margin-top: 4px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.row2 b {
  color: var(--dex-navy);
}
/* 标签徽章 */
.tag-list {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tag-chip {
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #8a97b8;
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 0 7px;
  line-height: 17px;
}
/* 项目维度是主位信息：黄色高亮区别于普通标签 */
.tag-chip.chip-project {
  background: var(--poke-yellow);
  color: var(--dex-navy);
}
.ops {
  display: flex;
  gap: 8px;
  flex: none;
  align-items: center;
}
.ops .btn {
  padding: 8px 12px;
  font-size: 13px;
  min-height: 36px;
}
.ops .btn.icon {
  padding: 8px 10px;
}
.ops .btn.del {
  color: var(--dex-red);
}
.ops .btn.esc {
  color: #a1660a;
}

/* 已捕捉 */
.entry.caught {
  background: var(--lcd);
  box-shadow: 4px 4px 0 var(--lcd-dark);
  border-color: var(--lcd-text);
}
.entry.caught .title {
  text-decoration: line-through;
  color: var(--lcd-text);
}
.entry.caught .sprite {
  filter: grayscale(1) contrast(1.4) brightness(0.8);
}
.entry.caught .badge,
.entry.caught .prio,
.entry.caught .row2 {
  filter: grayscale(0.7);
}
.catch-mark {
  font-size: 14px;
  color: var(--lcd-text);
  font-weight: 800;
}

/* 已逃走（取消）：淡出风格与已捕捉区分 */
.entry.escaped {
  background: #f3efe6;
  box-shadow: 4px 4px 0 #b9b09a;
  border-color: #9a937f;
  opacity: 0.85;
}
.entry.escaped .title {
  text-decoration: line-through;
  color: #7b7460;
}
.entry.escaped .sprite {
  filter: grayscale(1) brightness(1.1) opacity(0.6);
}
.escape-mark {
  color: #a1660a;
}

/* 相对截止时间分档配色：逾期/紧急红 · 临近琥珀 · 常规默认 · 遥远灰 */
.due.due-overdue,
.due.due-urgent {
  color: var(--dex-red);
  font-weight: 800;
}
.due.due-hours {
  color: #a1660a;
  font-weight: 700;
}
.due.due-far {
  color: #9a937f;
}
</style>
