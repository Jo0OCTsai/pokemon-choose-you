<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { useCategoriesStore } from "../stores/categories";
import { useTagsStore } from "../stores/tags";
import type { Tag, Task } from "../types";
import DexSelect from "./DexSelect.vue";
import DexDateTime from "./DexDateTime.vue";

/** 任务全字段编辑弹窗：属性编辑 + 标签（跟进记录/操作历史在详情抽屉，状态由动作驱动不在此编辑） */
const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { t } = useI18n();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();

/** 每条待办标签总数上限（防碎片化，与 AI 打标规则同口径） */
const MAX_TAGS = 3;

// ---- 可编辑字段（全部；状态不提供手动修改） ----
const title = ref(props.task.title);
const note = ref(props.task.note ?? "");
const categoryStr = ref(String(props.task.categoryId));
const priority = ref(props.task.priority);
const dueAt = ref(props.task.dueAt ?? "");
const remindAt = ref(props.task.remindAt ?? "");
const selectedTagIds = ref<number[]>([]);
const saving = ref(false);
const error = ref("");

function syncSelectedFromTask() {
  selectedTagIds.value = props.task.tags
    .map((r) => tagsStore.refToId(r.name, r.dimension))
    .filter((v): v is number => v != null);
}

// 打开期间标签/分类可能在别的窗口被更新，拉一次保证 name → id 映射完整
onMounted(async () => {
  await tagsStore.load().catch(() => {});
  syncSelectedFromTask();
});

// 分类选项：只列启用中的分类；任务自身所属分类若已停用则保留（否则下拉显示不出名字）
const categoryOptions = computed(() => {
  const list = categories.list.filter((c) => c.enabled || c.id === props.task.categoryId);
  return list.map((c) => ({ value: String(c.id), label: c.name }));
});
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
);

/** 标签选择器分组：按启用维度（项目在前），单选维度的 chips 互斥 */
const tagGroups = computed(() =>
  tagsStore.enabledDimensions.map((d) => ({
    key: d.key,
    name: d.name,
    single: d.cardinality === "single",
    tags: tagsStore.tagsByDimension.get(d.key) ?? [],
  })),
);

function toggleTag(g: Tag, single: boolean) {
  const i = selectedTagIds.value.indexOf(g.id);
  if (i >= 0) {
    selectedTagIds.value.splice(i, 1);
    return;
  }
  if (single) {
    // 单选维度（项目）：先清掉同维度的其它标签
    const sameDim = new Set(tagsStore.list.filter((x) => x.dimension === g.dimension).map((x) => x.id));
    selectedTagIds.value = selectedTagIds.value.filter((x) => !sameDim.has(x));
  }
  if (selectedTagIds.value.length >= MAX_TAGS) return;
  selectedTagIds.value.push(g.id);
}

async function save() {
  if (!title.value.trim()) {
    error.value = t("edit.titleRequired");
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.updateTask({
      id: props.task.id,
      title: title.value.trim(),
      note: note.value || null,
      categoryId: Number(categoryStr.value),
      priority: priority.value,
      // DexDateTime 空串转 null 表示清空；状态不手动改，由后端不变量归位
      dueAt: dueAt.value || null,
      remindAt: remindAt.value || null,
      tagIds: selectedTagIds.value,
    });
    emit("saved");
    emit("close");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="card">
      <h3>✎ No.{{ String(task.id).padStart(3, "0") }} {{ t("edit.title") }}</h3>

      <div class="form">
        <label class="row title-row">
          <span class="lbl">{{ t("edit.taskTitle") }}</span>
          <input v-model="title" />
        </label>
        <label class="row">
          <span class="lbl">{{ t("edit.note") }}</span>
          <textarea v-model="note" rows="2" />
        </label>
        <div class="row">
          <span class="lbl">{{ t("edit.category") }}</span>
          <DexSelect v-model="categoryStr" :options="categoryOptions" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.priority") }}</span>
          <DexSelect v-model="priority" :options="priorityOptions" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.due") }}</span>
          <DexDateTime v-model="dueAt" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.remind") }}</span>
          <DexDateTime v-model="remindAt" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.tags") }}</span>
          <div class="tag-pick">
            <div v-for="group in tagGroups" :key="group.key" class="tag-dim">
              <span class="dim-name">{{ group.name }}</span>
              <template v-if="group.tags.length">
                <button
                  v-for="g in group.tags"
                  :key="g.id"
                  type="button"
                  class="tag-chip"
                  :class="{ on: selectedTagIds.includes(g.id), dim: group.key !== 'project' }"
                  :title="g.description || group.name"
                  @click="toggleTag(g, group.single)"
                >
                  {{ g.name }}
                </button>
              </template>
              <span v-else class="no-tags">—</span>
            </div>
            <span v-if="!tagGroups.length" class="no-tags">{{ t("edit.noTags") }}</span>
            <span class="tag-count">{{ selectedTagIds.length }}/{{ MAX_TAGS }}</span>
          </div>
        </div>
      </div>

      <p v-if="error" class="err">❌ {{ error }}</p>
      <div class="btn-row">
        <button class="btn" :disabled="saving" @click="save">{{ t("save2") }}</button>
        <button class="btn ghost" @click="emit('close')">{{ t("cancel") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(28, 34, 68, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}
.card h3 {
  margin: 0;
  font-size: 16px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-soft);
}
.lbl {
  flex: none;
  font-weight: 700;
}
.row input,
.row textarea {
  width: 100%;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-sizing: border-box;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.row textarea {
  resize: vertical;
}
.tag-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.tag-dim {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dim-name {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  margin-right: 2px;
}
.tag-chip {
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  background: #fff;
  color: var(--dex-navy);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  transition:
    background var(--t-tap),
    transform var(--t-tap),
    box-shadow var(--t-tap);
}
.tag-chip.on {
  background: var(--poke-yellow);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.tag-chip:active {
  transform: translate(1px, 1px);
}
.tag-chip.dim.on {
  /* 非项目维度的选中态用浅绿区分（项目是主位信息，保持黄色高亮） */
  background: var(--ok-soft);
}
.no-tags {
  font-size: 12px;
  color: var(--ink-soft);
}
.tag-count {
  font-size: 11px;
  color: var(--ink-soft);
  margin-left: auto;
  align-self: flex-end;
}
.err {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--danger);
}
.btn-row {
  display: flex;
  gap: 10px;
}
</style>
