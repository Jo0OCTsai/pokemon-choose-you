<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

export interface DexOption {
  value: string;
  label: string;
}

/** 图鉴风自绘下拉：原生 select 的弹层在 WebKitGTK 会被滚动容器裁剪 */
const model = defineModel<string>({ required: true });
const { options } = defineProps<{ options: DexOption[] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const currentLabel = () => options.find((o) => o.value === model.value)?.label ?? model.value;

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false;
  }
}
function pick(v: string) {
  model.value = v;
  open.value = false;
}

onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="dex-select">
    <button type="button" class="ds-btn" :class="{ open }" @click="open = !open">
      <span class="ds-label">{{ currentLabel() }}</span>
      <span class="ds-arrow">▼</span>
    </button>
    <ul v-if="open" class="ds-list">
      <li v-for="o in options" :key="o.value" :class="{ sel: o.value === model }" @click="pick(o.value)">
        <span class="ds-cursor">▶</span>{{ o.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dex-select {
  position: relative;
  flex: none;
}
.ds-btn {
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
  padding: 7px 10px;
  min-height: 38px;
  min-width: 150px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap);
}
.ds-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
.ds-btn:hover:not(.open) {
  background: var(--hover);
}
.ds-btn.open {
  background: var(--poke-yellow);
}
.ds-label {
  flex: 1;
  text-align: left;
}
.ds-arrow {
  font-size: 10px;
}
.ds-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  z-index: 60;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 240px;
  overflow-y: auto;
}
.ds-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  padding: 8px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.ds-list li:hover {
  background: var(--hover);
}
.ds-list li.sel {
  background: var(--poke-yellow);
}
.ds-cursor {
  width: 10px;
  flex: none;
  font-size: 10px;
  opacity: 0;
}
.ds-list li.sel .ds-cursor {
  opacity: 1;
}
</style>
