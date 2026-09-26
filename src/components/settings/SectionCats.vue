<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { inject } from "vue";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useSettingsStore } from "../../stores/settings";
import PokemonPicker from "../PokemonPicker.vue";
import SettingRow from "../SettingRow.vue";
import CategoriesCard from "./CategoriesCard.vue";
import QuotesEditorCard from "./QuotesEditorCard.vue";

/**
 * 「宝可梦」分区壳（自 SettingsTab 拆出）：主宝可梦选择卡在本组件，
 * 分类管理 / 台词编辑器各拆为子卡。分类与台词的编辑缓冲只在本分区使用且
 * 原实现每次进入分区都重拉（无未保存保留语义），随子卡 onMounted 加载等价承接。
 */
const { t } = useI18n();
const settings = useSettingsStore();
const { flash } = inject(ACTION_TOAST)!;

/** 主宝可梦：选中即存（桌宠空闲展示即时生效，桌宠窗口经 settings-changed 跟随） */
async function saveMainPokemon(key: string) {
  settings.values.main_pokemon = key;
  await settings.save(["main_pokemon"]);
  flash(t("saved"));
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("cats.mainTitle") }}</h3>
    <SettingRow :label="t('cats.mainLabel')" :desc="t('cats.mainDesc')">
      <PokemonPicker
        :model-value="settings.values.main_pokemon"
        :allow-empty-label="t('cats.mainFollow')"
        @update:model-value="saveMainPokemon"
      />
    </SettingRow>
    <p class="set-foot">{{ t("cats.spriteHint") }}</p>
  </section>

  <CategoriesCard />
  <QuotesEditorCard />
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
</style>
