<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { closeContextMenu, ctxMenu } from "../contextMenu";

// 先按光标坐标落位再夹取到视口内（右/下边缘不溢出）
const menuEl = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);

watch(
  () => ctxMenu.open,
  async (open) => {
    if (!open) return;
    left.value = ctxMenu.x;
    top.value = ctxMenu.y;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    left.value = Math.max(0, Math.min(ctxMenu.x, window.innerWidth - el.offsetWidth - 4));
    top.value = Math.max(0, Math.min(ctxMenu.y, window.innerHeight - el.offsetHeight - 4));
  },
);

function onItem(item: (typeof ctxMenu.items)[number]) {
  closeContextMenu();
  item.action?.();
}

/** 捕获阶段判外点：菜单自身的 mousedown 不关，落到其他目标立即收起 */
function onDocDown(e: MouseEvent) {
  if (!menuEl.value?.contains(e.target as Node)) closeContextMenu();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeContextMenu();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("wheel", closeContextMenu, { passive: true });
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocDown, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("wheel", closeContextMenu);
  window.removeEventListener("resize", closeContextMenu);
  window.removeEventListener("blur", closeContextMenu);
});
</script>

<template>
  <Teleport to="body">
    <ul v-if="ctxMenu.open" ref="menuEl" class="ctx-menu" :style="{ left: left + 'px', top: top + 'px' }" role="menu">
      <li
        v-for="item in ctxMenu.items"
        :key="item.key"
        role="menuitem"
        :class="{ danger: item.danger, disabled: item.disabled }"
        @click="!item.disabled && onItem(item)"
      >
        <span class="cursor">▶</span>{{ item.label }}
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
/* 图鉴风右键菜单：白底粗描边 + ▶ 光标 + 皮卡黄高亮，与侧栏按钮同一套控件语言 */
.ctx-menu {
  position: fixed;
  z-index: 95;
  /* pet 窗为透明区点击穿透把 html/body/#app 全设 pointer-events:none，菜单 Teleport 到 body
     不在舞台树里，必须自行恢复 auto：否则收不到点击，elementFromPoint 也会跳过菜单
     让 usePetClickThrough 视其为空白、穿透常开 */
  pointer-events: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  min-width: 168px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  user-select: none;
}
.ctx-menu li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  min-height: 32px;
}
.ctx-menu li .cursor {
  width: 10px;
  flex: none;
  font-size: 10px;
  opacity: 0;
}
.ctx-menu li:hover:not(.disabled) {
  background: var(--hover);
}
.ctx-menu li:hover:not(.disabled) .cursor {
  opacity: 1;
}
.ctx-menu li.danger {
  color: var(--danger);
}
.ctx-menu li.disabled {
  color: var(--ink-faint);
  cursor: default;
}
</style>
