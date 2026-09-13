<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { spriteCandidates } from "../pokemon";

/**
 * 精灵图：按候选链逐级回退（本地内置 → CDN 动图 → CDN 静态图），
 * 全部失败时显示占位方块（断网且非内置宝可梦的场景）。
 * class 等透传属性由调用方附加在根元素上。
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{ sprite: string }>();

const failed = ref(false);
const idx = ref(0);
const srcs = ref<string[]>(spriteCandidates(props.sprite));

watch(
  () => props.sprite,
  (s) => {
    failed.value = false;
    idx.value = 0;
    srcs.value = spriteCandidates(s);
  },
);

function onError() {
  if (idx.value < srcs.value.length - 1) idx.value += 1;
  else failed.value = true;
}

const src = computed(() => srcs.value[idx.value]);
</script>

<template>
  <img v-if="!failed" v-bind="$attrs" class="pk-sprite" :src="src" @error="onError" />
  <span v-else v-bind="$attrs" class="pk-sprite pk-sprite-missing" aria-hidden="true">？</span>
</template>

<style>
.pk-sprite {
  image-rendering: pixelated;
  object-fit: contain;
  user-select: none;
}
.pk-sprite-missing {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lcd, #d8e0c8);
  color: var(--lcd-text, #3a4a32);
  border: 2px dashed currentColor;
  border-radius: 6px;
  font-weight: 800;
}
</style>
