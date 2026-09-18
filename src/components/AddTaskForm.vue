<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, type NewTaskInput } from "../api";
import { fmtDateTime, useSettingsStore } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import { useTagsStore } from "../stores/tags";
import { parseNlCapture } from "../nlCapture";
import { pokemonName } from "../pokemon";
import DexSelect from "./DexSelect.vue";
import DexDateTime from "./DexDateTime.vue";

const props = defineProps<{ allowSchedule?: boolean }>();
const emit = defineEmits<{
  submit: [input: NewTaskInput];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();

const newTitle = ref("");
const newCategory = ref(1);
const newPriority = ref("normal");
const newDue = ref("");
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
// 只允许选启用中的分类；当前选中被停用时回落到第一个启用分类
const enabledCategories = computed(() => categories.list.filter((c) => c.enabled));
watch(
  () => categories.list.map((c) => `${c.id}:${c.enabled}`).join(","),
  () => {
    if (!enabledCategories.value.some((c) => c.id === newCategory.value)) {
      newCategory.value = enabledCategories.value[0]?.id ?? 1;
    }
  },
  { immediate: true },
);
const categoryOptions = computed(() => enabledCategories.value.map((c) => ({ value: String(c.id), label: c.name })));
/** 输入框占位符跟随选中分类：野生「宝可梦」换成该分类关联的宝可梦名 */
const addPlaceholder = computed(() => {
  const cat = categories.byId.get(newCategory.value);
  const p = cat ? pokemonName(cat.sprite, cat.pokemon) : "";
  return p ? t("add.placeholderNamed", { p }) : t("add.placeholder");
});
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
);

// ---- 自然语言快速捕捉：高亮预览 + 单击取消 + 设置全局可关 ----

/** 本次输入的识别被用户取消；输入变化后自动恢复 */
const nlDismissed = ref(false);
watch(newTitle, () => {
  nlDismissed.value = false;
});

const nlPreview = computed(() => {
  const raw = newTitle.value.trim();
  if (!raw || nlDismissed.value || !settings.bool("nl_capture_enabled")) return null;
  return parseNlCapture(raw, { categories: categories.list, tags: tagsStore.list });
});

async function submit() {
  const raw = newTitle.value.trim();
  if (!raw) return;
  const p = nlPreview.value;
  // 识别出的字段直接生效（预览里看得见）；手动选的时间（newDue）优先于识别。
  // 手动加时间（加入路线）仅在草丛页提供；非草丛页识别出的时间仍生效，避免丢信息
  const dueAt = (props.allowSchedule ? newDue.value : "") || p?.dueAt || "";
  // 词表外的 #新名字：先按 topic 维度建标签（幂等），再一并挂上
  let tagIds = p?.tagIds.length ? [...p.tagIds] : undefined;
  if (p?.newTagNames.length) {
    const created = await Promise.all(p.newTagNames.map((name) => api.createTag(name, "", "topic").catch(() => null)));
    const ids = created.flatMap((x) => (x ? [x.id] : []));
    tagIds = [...(tagIds ?? []), ...ids];
  }
  emit("submit", {
    title: p?.title || raw,
    categoryId: p?.categoryId ?? newCategory.value,
    priority: newPriority.value,
    dueAt: dueAt || undefined,
    // 去向由是否设置时间决定：有时间进路线，没时间进草丛
    scheduled: dueAt !== "",
    tagIds: tagIds?.length ? tagIds : undefined,
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
    <input ref="titleInput" v-model="newTitle" :placeholder="addPlaceholder" />
    <DexSelect v-model="newCategoryStr" :options="categoryOptions" />
    <DexSelect v-model="newPriority" :options="priorityOptions" />
    <DexDateTime v-if="allowSchedule" v-model="newDue" />
    <button class="btn" type="submit">{{ allowSchedule && newDue ? t("add.goRoute") : t("add.goGrass") }}</button>

    <!-- 自然语言识别预览：抽出的标题 + 高亮片段；单击 ✕ 取消本次识别 -->
    <div v-if="nlPreview" class="nl-preview">
      <span class="nl-icon">✨</span>
      <span class="nl-title">「{{ nlPreview.title }}」</span>
      <span v-if="nlPreview.dueAt" class="nl-chip nl-time">🕒 {{ fmtDateTime(nlPreview.dueAt) }}</span>
      <span v-if="nlPreview.categoryName" class="nl-chip nl-cat">🗂 {{ nlPreview.categoryName }}</span>
      <span v-for="n in nlPreview.tagNames" :key="n" class="nl-chip nl-tag"># {{ n }}</span>
      <span v-for="n in nlPreview.newTagNames" :key="'new-' + n" class="nl-chip nl-tag" :title="t('add.nlNewTag')">
        ＋ {{ n }}
      </span>
      <button type="button" class="nl-cancel" @click="nlDismissed = true">✕ {{ t("add.nlCancel") }}</button>
    </div>
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
/* 自然语言识别预览：紧跟标题输入的一行胶囊 */
.nl-preview {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  background: var(--poke-yellow);
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 5px 8px;
  color: var(--dex-navy);
}
.nl-icon {
  flex: none;
}
.nl-title {
  font-weight: 800;
}
.nl-chip {
  flex: none;
  font-weight: 700;
  background: #fff;
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 0 8px;
}
.nl-cancel {
  margin-left: auto;
  flex: none;
  border: 2px dashed var(--dex-navy);
  border-radius: 6px;
  background: transparent;
  color: var(--dex-navy);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 2px 8px;
  cursor: pointer;
}
.nl-cancel:hover {
  background: #fff;
}
</style>
