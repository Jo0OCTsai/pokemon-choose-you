<script setup lang="ts">
/** 图鉴风开关：默认 ON/OFF，也可自定义状态文案（如 草丛/路线） */
const model = defineModel<boolean>({ required: true });
const { onLabel = "ON", offLabel = "OFF" } = defineProps<{ onLabel?: string; offLabel?: string }>();
</script>

<template>
  <button type="button" class="dex-toggle" :class="{ on: model }" :aria-pressed="model" @click="model = !model">
    <span class="knob" />
    <span class="state">{{ model ? onLabel : offLabel }}</span>
  </button>
</template>

<style scoped>
.dex-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  min-height: 38px;
  min-width: 92px;
  padding: 4px 10px 4px 6px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  font-family: inherit;
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap);
}
.dex-toggle:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
.dex-toggle:hover:not(.on) {
  background: var(--hover);
}
.dex-toggle.on {
  background: var(--poke-yellow);
}
.knob {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 3px solid var(--dex-navy);
  background: #fff;
  transition: background var(--t-pop);
}
.dex-toggle.on .knob {
  background: var(--dex-red);
}
.state {
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
}
</style>
