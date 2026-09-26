<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../../api";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useCategoriesStore } from "../../stores/categories";
import { BUNDLED_POKEMON, POKEMON_BY_KEY } from "../../pokemon";
import PokemonPicker from "../PokemonPicker.vue";
import DexToggle from "../DexToggle.vue";

/**
 * 分类管理卡（自 SettingsTab 拆出）：分类改名 / 换宝可梦 / 停用启用 / 释放。
 * 编辑缓冲 editingCats 为本卡私有；原实现在切到 cats 分区时无条件重拉，
 * 由 onMounted 等价承接（v-if 装配下每次进入分区都会重新挂载）。
 */
const { t } = useI18n();
const categories = useCategoriesStore();
const { msg: testMsg, flash } = inject(ACTION_TOAST)!;

// ---- 分类管理 ----
const editingCats = ref<{ id: number; name: string; pokemonKey: string; enabled: boolean }[]>([]);
function startEditCats() {
  editingCats.value = categories.list.map((c) => ({
    id: c.id,
    name: c.name,
    pokemonKey: c.sprite,
    enabled: c.enabled,
  }));
}
onMounted(startEditCats);

async function saveCat(row: { id: number; name: string; pokemonKey: string }) {
  // 全量名录里挑的宝可梦：库存简中名（显示层按语言本地化），未知 key 回退内置第一位
  const entry = POKEMON_BY_KEY.get(row.pokemonKey);
  const fallback = BUNDLED_POKEMON[0];
  await api.updateCategory(row.id, row.name, entry?.hans ?? fallback.name, entry?.key ?? fallback.key);
  await categories.load();
  flash(t("catSaved"));
}
/** 停用/启用：停用后分类不进新建、编辑与 AI 选项（至少保留一个启用分类） */
async function toggleCat(row: { id: number; enabled: boolean }, v: boolean | string | number) {
  row.enabled = Boolean(v);
  try {
    await api.setCategoryEnabled(row.id, row.enabled);
    await categories.load();
    startEditCats();
  } catch (e) {
    row.enabled = !row.enabled;
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function removeCat(row: { id: number; name: string }) {
  try {
    await api.deleteCategory(row.id);
    await categories.load();
    startEditCats();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function addCat() {
  await api.createCategory(t("cats.newName"), BUNDLED_POKEMON[0].name, BUNDLED_POKEMON[0].key);
  await categories.load();
  startEditCats();
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("cats.title") }}</h3>
    <div v-for="row in editingCats" :key="row.id" class="cat-row" :class="{ off: !row.enabled }">
      <input v-model="row.name" class="cat-name" />
      <PokemonPicker v-model="row.pokemonKey" />
      <DexToggle :model-value="row.enabled" :title="t('cats.toggle')" @update:model-value="(v) => toggleCat(row, v)" />
      <button class="btn ghost" @click="saveCat(row)">{{ t("cats.save") }}</button>
      <button class="btn ghost del" @click="removeCat(row)">{{ t("cats.release") }}</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" @click="addCat">{{ t("cats.new") }}</button>
    </div>
    <p class="set-foot">{{ t("cats.hint") }}</p>
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
.set-card .btn.del {
  color: var(--danger);
}
/* 分类编辑行 */
.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-row.off {
  opacity: 0.5;
}
.cat-name {
  width: 110px;
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.cat-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
.cat-row .btn.del {
  color: var(--danger);
}
</style>
