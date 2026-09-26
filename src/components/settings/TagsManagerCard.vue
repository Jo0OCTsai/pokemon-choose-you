<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../../api";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useTagsStore } from "../../stores/tags";
import DexSelect from "../DexSelect.vue";

/**
 * 标签管理卡（自 SettingsTab 拆出）：编辑行按维度分组渲染，行内改名/描述/维度迁移/保存/释放。
 * 编辑缓冲由父级持有（跨分区保留未保存编辑），本卡经 props 取行、CRUD 后经 reload 回调重拉。
 */
interface EditingTag {
  id: number;
  name: string;
  description: string;
  dimension: string;
}
const props = defineProps<{ rows: EditingTag[]; reload: () => void }>();

const { t } = useI18n();
const tagsStore = useTagsStore();
const { msg: testMsg, flash } = inject(ACTION_TOAST)!;

/** 已改写派发路由的项目标签 id（口径与派发卡的「已配置」一致：agent 或目录任一指定；
 * 直接跟随 store，即时保存后行内 ⚡ 即时点亮） */
const dispatchIds = computed(
  () => new Set(tagsStore.list.filter((g) => !!(g.meta?.workdir || g.meta?.agentId)).map((g) => g.id)),
);
/** 编辑行按维度分组渲染（维度序 = tagsStore.dimensions 的 sort） */
const editingGroups = computed(() =>
  tagsStore.dimensions.map((d) => ({
    dim: d,
    rows: props.rows.filter((r) => r.dimension === (d.key || "topic")),
  })),
);
/** 行内维度迁移下拉的选项（停用维度不进选项） */
const dimOptions = computed(() => tagsStore.enabledDimensions.map((d) => ({ value: d.key, label: d.name })));

async function saveTag(row: EditingTag) {
  try {
    await api.updateTag(row.id, row.name, row.description, row.dimension);
    await tagsStore.load();
    props.reload();
    flash(t("tagSaved"));
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function removeTag(id: number) {
  try {
    await api.deleteTag(id);
    await tagsStore.load();
    props.reload();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function addTag(dimKey: string) {
  try {
    await api.createTag(t("tags.newName"), "", dimKey);
    await tagsStore.load();
    props.reload();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("tags.title") }}</h3>
    <p class="set-sub">{{ t("tags.hint") }}</p>
    <div v-for="group in editingGroups" :key="group.dim.key" class="tag-dim-group">
      <div class="tag-dim-head">
        <b>{{ group.dim.name }}</b>
        <span class="tag-dim-meta">
          {{ t("tags.dimCount", { used: group.rows.length, max: group.dim.maxTags }) }}
          <template v-if="group.dim.cardinality === 'single'"> · {{ t("tags.single") }}</template>
        </span>
        <button
          class="btn ghost mini"
          :disabled="group.rows.length >= group.dim.maxTags"
          @click="addTag(group.dim.key)"
        >
          ＋
        </button>
      </div>
      <template v-for="row in group.rows" :key="row.id">
        <!-- ⚡ = 已配置派发（配置入口在下方「项目派发」卡片） -->
        <div class="tag-row">
          <input v-model="row.name" class="tag-name" :placeholder="t('tags.namePh')" />
          <span v-if="dispatchIds.has(row.id)" class="tag-meta-chip" :title="t('tagDispatch.chipHint')">⚡</span>
          <input v-model="row.description" class="tag-desc" :placeholder="t('tags.descPh')" />
          <DexSelect v-model="row.dimension" :options="dimOptions" class="tag-dim-select" />
          <button class="btn ghost" @click="saveTag(row)">{{ t("tags.save") }}</button>
          <button class="btn ghost del" @click="removeTag(row.id)">{{ t("tags.release") }}</button>
        </div>
      </template>
    </div>
    <p class="set-foot">{{ t("tags.dimHint") }}</p>
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
/* 说明文字四层归属的页面两层（行内 desc 在 SettingRow 组件内）：区块副标题 + 卡片脚注 */
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.set-card .btn.del {
  color: var(--danger);
}
/* 标签编辑行 */
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
.tag-desc {
  flex: 1;
  min-width: 0;
}
.tag-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
/* 标签行内 ⚡ 徽标：已配置派发的项目标签（配置入口在下方「项目派发」卡片） */
.tag-meta-chip {
  flex: none;
  font-size: 13px;
  cursor: help;
}
/* 维度分组管理 */
.tag-dim-group {
  margin-bottom: 14px;
}
.tag-dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.tag-dim-meta {
  font-size: 11px;
  color: var(--ink-soft);
}
/* mini 档统一走 dex.css 的 .btn.mini（32px） */
.tag-dim-select {
  width: 92px;
  flex: none;
}
/* ds-btn 全局 min-width 150px，会从 92px 容器溢出盖住右侧「保存」按钮，钉回容器宽 */
.tag-dim-select :deep(.ds-btn) {
  width: 100%;
  min-width: 0;
  padding: 7px 8px;
}
</style>
