<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useSettingsStore } from "../../stores/settings";
import { BUNDLED_POKEMON, mergePokemonQuotes, pokemonQuotesFor } from "../../pokemon";
import PokemonPicker from "../PokemonPicker.vue";

/**
 * 每宝可梦自定义台词编辑器卡（自 SettingsTab 拆出）：选宝可梦 → 编辑多行台词 → 单独保存。
 * 编辑框内容只在本卡使用，原实现在切到 cats 分区时每次重载，由 onMounted 等价承接。
 */
const { t } = useI18n();
const settings = useSettingsStore();
const { flash } = inject(ACTION_TOAST)!;

/** 台词编辑器当前选中的宝可梦（默认跟主宝可梦，没设则皮卡丘） */
const quotePokemon = ref("");
const quoteText = ref("");
/** 从设置载入该宝可梦的台词到编辑框（切换选中时跟随已保存内容） */
function loadQuoteText() {
  quotePokemon.value = settings.sget("main_pokemon") || BUNDLED_POKEMON[0].key;
  quoteText.value = pokemonQuotesFor(settings.sget, quotePokemon.value).join("\n");
}
onMounted(loadQuoteText);

function onQuotePokemonChange(key: string) {
  quotePokemon.value = key;
  quoteText.value = pokemonQuotesFor(settings.sget, key).join("\n");
}
const quoteCount = computed(
  () =>
    quoteText.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean).length,
);
async function saveQuotes() {
  settings.values.pokemon_quotes = mergePokemonQuotes(settings.sget, quotePokemon.value, quoteText.value);
  await settings.save(["pokemon_quotes"]);
  flash(t("saved"));
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("cats.quotesTitle") }}</h3>
    <div class="quotes-controls">
      <PokemonPicker :model-value="quotePokemon" @update:model-value="onQuotePokemonChange" />
      <span class="quotes-count">{{ t("cats.quotesCount", { n: quoteCount }) }}</span>
      <button class="btn ghost" @click="saveQuotes">{{ t("cats.quotesSave") }}</button>
    </div>
    <textarea v-model="quoteText" class="quotes-editor" rows="4" :placeholder="t('cats.quotesPh')" />
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
/* 台词编辑器 */
.quotes-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.quotes-count {
  font-size: 12px;
  color: var(--ink-soft);
}
.quotes-editor {
  width: 100%;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
  min-height: 96px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
</style>
