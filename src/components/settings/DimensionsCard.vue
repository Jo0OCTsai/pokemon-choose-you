<script setup lang="ts">
import { inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../../api";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useTagsStore } from "../../stores/tags";
import DexToggle from "../DexToggle.vue";

/**
 * 维度管理卡（自 SettingsTab 拆出）：改名 / 上限 / 停用，key 与单多选建后不可改，新维度名转 slug。
 * 编辑缓冲由父级持有（跨分区保留未保存编辑），CRUD 后经 reloadTags/reloadDims 回调重拉
 * （维度变化会合并/迁移标签，两个编辑缓冲都要重克隆——与原实现一致）。
 */
const props = defineProps<{
  rows: { id: number; key: string; name: string; maxTags: number; enabled: boolean }[];
  reloadTags: () => void;
  reloadDims: () => void;
}>();

const { t } = useI18n();
const tagsStore = useTagsStore();
const { msg: testMsg, flash } = inject(ACTION_TOAST)!;

async function saveDim(row: { id: number; name: string; maxTags: number; enabled: boolean }) {
  try {
    await api.updateTagDimension(row.id, row.name, row.maxTags, row.enabled);
    await tagsStore.load();
    props.reloadDims();
    props.reloadTags();
    flash(t("tagSaved"));
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
const newDimName = ref("");
/** 新维度 key：名称转小写 ascii slug，非 ascii 回落 dim-N */
async function addDim() {
  const name = newDimName.value.trim();
  if (!name) return;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = slug || `dim-${Date.now().toString(36)}`;
  try {
    await api.createTagDimension(key, name);
    newDimName.value = "";
    await tagsStore.load();
    props.reloadDims();
    props.reloadTags();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("tags.dimTitle") }}</h3>
    <div v-for="row in rows" :key="row.id" class="tag-row dim-row">
      <span class="dim-key" :title="row.key">{{ row.key }}</span>
      <input v-model="row.name" class="tag-name" />
      <input
        v-model.number="row.maxTags"
        class="dim-max"
        type="number"
        min="1"
        max="200"
        :title="t('tags.maxTags')"
        :aria-label="t('tags.maxTags')"
      />
      <DexToggle v-model="row.enabled" :title="t('cats.toggle')" />
      <button class="btn ghost" @click="saveDim(row)">{{ t("tags.save") }}</button>
    </div>
    <div class="btn-row">
      <input v-model="newDimName" class="tag-name" :placeholder="t('tags.dimNamePh')" />
      <button class="btn ghost" @click="addDim">{{ t("tags.dimNew") }}</button>
    </div>
    <p class="set-foot">{{ t("tags.dimManageHint") }}</p>
  </section>
</template>

<style scoped>
/* 共享壳样式（自 SettingsTab 复制的 scoped 副本：分区子组件沿用通用类的既定做法） */
.set-card {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 4px 4px 0 var(--dex-navy);
}
.set-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 10px;
}
/* 维度编辑行（与标签编辑行同款质感） */
.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.tag-row input {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.tag-name {
  width: 110px;
  flex: none;
}
.tag-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
.dim-row .dim-key {
  flex: none;
  width: 84px;
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 维度新增行：新维度名称输入框不在 .tag-row 内，单独补齐与 tag-row 同款控件质感 */
.btn-row .tag-name {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.dim-max {
  width: 64px;
  flex: none;
}
</style>
