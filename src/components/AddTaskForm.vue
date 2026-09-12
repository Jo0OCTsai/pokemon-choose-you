<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { NewTaskInput } from "../api";
import { useSettingsStore } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import DexSelect from "./DexSelect.vue";
import DexToggle from "./DexToggle.vue";
import DexDateTime from "./DexDateTime.vue";

const emit = defineEmits<{
  submit: [input: NewTaskInput];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();

const newTitle = ref("");
const newCategory = ref(1);
const newPriority = ref("normal");
const newDue = ref("");
// 默认值由设置 default_to_inbox 决定（设置异步加载后跟随刷新）
const toInbox = ref(true);
watch(
  () => settings.sget("default_to_inbox"),
  (v) => {
    toInbox.value = v === "true";
  },
  { immediate: true },
);
watch(
  () => settings.sget("default_priority"),
  (v) => {
    if (v) newPriority.value = v;
  },
  { immediate: true },
);

const titleInput = ref<HTMLInputElement | null>(null);

// DexSelect 以字符串为值，分类 id 数字需要桥接
const newCategoryStr = computed({
  get: () => String(newCategory.value),
  set: (v: string) => {
    newCategory.value = Number(v);
  },
});
const categoryOptions = computed(() => categories.list.map((c) => ({ value: String(c.id), label: c.name })));
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
);

function submit() {
  const title = newTitle.value.trim();
  if (!title) return;
  emit("submit", {
    title,
    categoryId: newCategory.value,
    priority: newPriority.value,
    dueAt: newDue.value || undefined,
    scheduled: !toInbox.value,
  });
  newTitle.value = "";
  newDue.value = "";
}

/** 快捷键"快速捕捉"：切到本页后聚焦标题输入框 */
function focus() {
  titleInput.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <form class="add" @submit.prevent="submit">
    <input ref="titleInput" v-model="newTitle" :placeholder="t('add.placeholder')" />
    <DexSelect v-model="newCategoryStr" :options="categoryOptions" />
    <DexSelect v-model="newPriority" :options="priorityOptions" />
    <DexDateTime v-model="newDue" />
    <DexToggle v-model="toInbox" :on-label="t('add.goGrass')" :off-label="t('add.goRoute')" />
    <button class="btn" type="submit">{{ t("add.submit") }}</button>
  </form>
</template>

<style scoped>
.add {
  display: flex;
  gap: 8px;
  margin: 0 20px 14px;
  flex-wrap: wrap;
  align-items: center;
}
.add input {
  /* 标题输入独占第一行 */
  flex: 1 1 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  min-height: 38px;
}
.add .btn {
  min-height: 38px;
  padding: 6px 14px;
}
</style>
