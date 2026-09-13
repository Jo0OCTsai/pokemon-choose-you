<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { POKEMON_BY_KEY, isBundled, pokemonName, searchPokemon } from "../pokemon";
import PokemonSprite from "./PokemonSprite.vue";

/**
 * 全量宝可梦选择器（图鉴风）：点开面板后按 名称/编号/英文名 搜索名录（PokeAPI 全量），
 * 内置 6 只默认置顶。allowEmptyLabel 提供一个"清空"选项（主宝可梦跟随分类用）。
 */
const model = defineModel<string>({ required: true });
const { allowEmptyLabel = "" } = defineProps<{ allowEmptyLabel?: string }>();

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const root = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const results = computed(() => searchPokemon(query.value));
const selectedLabel = computed(() => {
  if (!model.value) return allowEmptyLabel ?? "";
  return pokemonName(model.value) || model.value;
});
const selectedKnown = computed(() => !model.value || POKEMON_BY_KEY.has(model.value));

function toggle() {
  open.value = !open.value;
  if (open.value) {
    query.value = "";
    // 面板渲染后聚焦搜索框（直接搜索，不用再点一下）
    requestAnimationFrame(() => searchInput.value?.focus());
  }
}
function pick(v: string) {
  model.value = v;
  open.value = false;
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false;
  }
}
function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    // 回车直取第一条结果（搜索 → 回车的最短路径）
    const first = results.value[0];
    if (first) pick(first.key);
  } else if (e.key === "Escape") {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="pk-picker">
    <button type="button" class="pk-btn" :class="{ open }" @click="toggle">
      <PokemonSprite v-if="model" class="pk-thumb" :sprite="model" />
      <span class="pk-label" :class="{ unknown: !selectedKnown }">{{ selectedLabel }}</span>
      <span class="pk-arrow">▼</span>
    </button>
    <div v-if="open" class="pk-panel">
      <input
        ref="searchInput"
        v-model="query"
        class="pk-search"
        type="text"
        :placeholder="t('pk.searchPh')"
        @keydown="onSearchKeydown"
      />
      <ul class="pk-list">
        <li v-if="allowEmptyLabel" class="pk-item pk-empty-option" @click="pick('')">
          <span class="pk-cursor">▶</span>{{ allowEmptyLabel }}
        </li>
        <li v-for="p in results" :key="p.key" class="pk-item" :class="{ sel: p.key === model }" @click="pick(p.key)">
          <span class="pk-cursor">▶</span>
          <PokemonSprite class="pk-thumb" :sprite="p.key" />
          <span class="pk-name">{{ pokemonName(p.key) }}</span>
          <span class="pk-id px">#{{ p.id }}</span>
          <span v-if="isBundled(p.key)" class="pk-bundled">{{ t("pk.bundled") }}</span>
        </li>
        <li v-if="!results.length" class="pk-none">{{ t("pk.empty") }}</li>
      </ul>
      <div class="pk-foot hint">{{ t("pk.footHint") }}</div>
    </div>
  </div>
</template>

<style scoped>
.pk-picker {
  position: relative;
  flex: none;
}
.pk-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  color: var(--dex-navy);
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  padding: 4px 10px;
  min-height: 38px;
  min-width: 150px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.pk-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.pk-btn.open {
  background: var(--poke-yellow);
}
.pk-thumb {
  width: 26px;
  height: 26px;
  flex: none;
}
.pk-thumb.pk-sprite-missing {
  width: 26px;
  height: 26px;
  font-size: 12px;
}
.pk-label {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-label.unknown {
  color: #9a937f;
}
.pk-arrow {
  font-size: 9px;
}
.pk-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 70;
  width: min(320px, 78vw);
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 8px;
}
.pk-search {
  width: 100%;
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 36px;
  margin-bottom: 6px;
}
.pk-list {
  list-style: none;
  margin: 0;
  padding: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.pk-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.pk-item:hover {
  background: #fff3c4;
}
.pk-item.sel {
  background: var(--poke-yellow);
}
.pk-cursor {
  width: 10px;
  flex: none;
  font-size: 9px;
  opacity: 0;
}
.pk-item.sel .pk-cursor {
  opacity: 1;
}
.pk-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pk-item:hover .pk-name,
.pk-item.sel .pk-name {
  white-space: normal;
}
.pk-id {
  font-size: 9px;
  opacity: 0.65;
  flex: none;
}
.pk-bundled {
  flex: none;
  font-size: 9px;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 4px;
  line-height: 14px;
}
.pk-none {
  font-size: 13px;
  color: #9a937f;
  text-align: center;
  padding: 14px 0;
}
.pk-foot {
  margin: 6px 2px 0;
}
</style>
