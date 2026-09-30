<script setup lang="ts">
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ACTION_TOAST } from "../../composables/useActionToast";
import type { PromptPanelState } from "../../composables/usePromptEditor";
import { clipWrite } from "../../contextMenu";
import PromptEditSession from "./PromptEditSession.vue";
import PromptPlaceholderRow from "./PromptPlaceholderRow.vue";
import PromptSourceBadges from "./PromptSourceBadges.vue";
import PromptViewActions from "./PromptViewActions.vue";
import PromptViewScreen from "./PromptViewScreen.vue";

/**
 * 单功能提示词折叠面板（编排层）：折叠头 + 徽章组、警示行、查看屏（LCD + 复制钮）、
 * 占位符行、编辑会话、查看态操作行/两步确认、内置默认对照。交互规格 = uiux-design.md
 * §3/§4/§5：占位符行与警示行是面板级常驻子节点（不随编辑态隐藏），焦点管理按 §4.1
 * 六条集中在本面板编排（进编辑→textarea 光标置尾；确认条→焦点入主动作；取消/成功→
 * 回「编辑」钮；chip 插入不抢焦；折叠焦点留折叠头）。样式沿用 set-card scoped 副本先例。
 */
const props = defineProps<{ panel: PromptPanelState }>();
const { t } = useI18n();
const { flash } = inject(ACTION_TOAST)!;

/** 折叠状态（面板本地；编辑缓冲在 composable，折叠不丢） */
const expanded = ref(false);
/** 内置默认对照区展开 */
const refOpen = ref(false);

// 子组件句柄（焦点编排集中在本面板：UIUX §4.1 六条）
const sessionRef = ref<InstanceType<typeof PromptEditSession> | null>(null);
const actionsRef = ref<InstanceType<typeof PromptViewActions> | null>(null);

const featureName = computed(() => t(`prompts.feature.${props.panel.id}`));
/** 编辑态缺失的占位符（chip 标红集；查看态不标红） */
const missingToks = computed(() =>
  props.panel.editing ? props.panel.spec.requiredPlaceholders.filter((tok) => !props.panel.draft.includes(tok)) : [],
);

/** default_warned 警示行（查看与编辑态都常驻）：缺占位符 / 超长两个来源 */
const warnText = computed(() => {
  const s = props.panel.spec;
  if (s.overlong) {
    return t("prompts.warnOverlong", { n: [...(s.overrideText ?? "")].length });
  }
  return t("prompts.warnLine", { names: s.missingPlaceholders.join(", ") });
});

async function onEdit() {
  props.panel.startEdit();
  await nextTick();
  sessionRef.value?.focusEditorTail(); // 进编辑：焦点入 textarea 且光标置文本尾
}

async function onCancelEdit() {
  props.panel.cancelEdit();
  await nextTick();
  actionsRef.value?.focusEditButton(); // 回查看态：焦点回「编辑」
}

async function onSave() {
  const ok = await props.panel.save();
  if (ok) await nextTick(() => actionsRef.value?.focusEditButton()); // 保存成功：焦点回「编辑」
}

async function onRestore() {
  props.panel.requestRestore();
  await nextTick();
  actionsRef.value?.focusConfirmPrimary(); // 确认条出现：焦点移至主动作「确认恢复」
}

async function onCancelRestore() {
  props.panel.cancelRestore();
  await nextTick();
  actionsRef.value?.focusRestoreButton(); // 收起确认条：焦点回「恢复默认…」
}

async function onConfirmRestore() {
  const ok = await props.panel.confirmRestore();
  if (ok) await nextTick(() => actionsRef.value?.focusEditButton()); // 「恢复默认…」随成功消失：回操作行首个可用钮
}

/** 占位符 chip：插入编辑缓冲光标处（非编辑态仅展示，不路由） */
function insertPlaceholder(tok: string) {
  if (!props.panel.editing) return;
  sessionRef.value?.insertAtCursor(tok);
}

async function copyAll() {
  const ok = await clipWrite(props.panel.effectiveText);
  flash(ok ? t("prompts.copied") : t("diag.reportFailed"));
}
</script>

<template>
  <div class="panel" :class="{ open: expanded }">
    <button
      class="panel-head"
      :aria-expanded="expanded"
      :aria-controls="`pb-${panel.id}`"
      @click="expanded = !expanded"
    >
      <span class="arrow">▼</span>
      <span class="panel-name">{{ featureName }}</span>
      <PromptSourceBadges :spec="panel.spec" :dirty="panel.dirty" />
    </button>
    <div v-show="expanded" :id="`pb-${panel.id}`" class="panel-body">
      <!-- 警示行：面板级常驻（编辑态不隐藏，修复时可见缺什么） -->
      <p v-if="panel.spec.source === 'default_warned'" class="warn-line">{{ warnText }}</p>

      <!-- 查看屏（LCD）：生效标签 + 当前生效文本 + 悬停复制钮 -->
      <div v-if="!panel.editing" class="view-block">
        <PromptViewScreen
          :label="panel.spec.source === 'custom' ? t('prompts.tagCustom') : t('prompts.tagDefault')"
          :text="panel.effectiveText"
          variant="view"
          copyable
          @copy="copyAll"
        />
        <!-- 只读说明行（仅派发）：安全结构不可编辑的原因 -->
        <p v-if="!panel.spec.editable" class="info-line">{{ t("prompts.readonlyNote") }}</p>
      </div>

      <!-- 占位符行：面板级常驻（查看态与编辑态都渲染，不随模式切换隐藏）；空集不渲染 -->
      <PromptPlaceholderRow
        v-if="panel.spec.requiredPlaceholders.length"
        :tokens="panel.spec.requiredPlaceholders"
        :missing="missingToks"
        @insert="insertPlaceholder"
      />

      <!-- 编辑态块（替换「查看屏 + 查看态操作行」的渲染位） -->
      <PromptEditSession
        v-if="panel.editing"
        ref="sessionRef"
        :panel="panel"
        :feature-name="featureName"
        @save="onSave"
        @cancel="onCancelEdit"
      />
      <!-- 查看态操作行 / 恢复默认两步确认条（原位替换）+ 成功提示行与遗留警告 -->
      <PromptViewActions
        v-else
        ref="actionsRef"
        :panel="panel"
        :feature-name="featureName"
        :ref-open="refOpen"
        @edit="onEdit"
        @restore="onRestore"
        @compare="refOpen = !refOpen"
        @confirm-restore="onConfirmRestore"
        @cancel-restore="onCancelRestore"
      />

      <!-- 内置默认对照区（非默认态可展开；对照屏无生效标签，以区标题标识） -->
      <div v-if="refOpen && !panel.editing" class="ref-block">
        <PromptViewScreen :label="t('prompts.compareTitle')" :text="panel.spec.defaultText" variant="ref" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 折叠面板（控件级 3px 描边 / 3px 3px 0 阴影 / 8px 圆角） */
.panel {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  margin-bottom: 10px;
  background: #fff;
}
.panel:last-child {
  margin-bottom: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: #fff;
  border: 0;
  padding: 9px 12px;
  min-height: 38px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background var(--t-tap);
}
.panel-head:hover {
  background: var(--hover);
}
.panel-head .arrow {
  font-size: 10px;
  width: 12px;
  flex: none;
  transition: transform var(--t-act) var(--e-snap);
}
.panel:not(.open) .panel-head .arrow {
  transform: rotate(-90deg);
}
.panel-name {
  min-width: 0;
}
.panel-body {
  padding: 0 12px 12px;
  animation: unfold var(--t-act) var(--e-snap);
}
@keyframes unfold {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 警示行 / 只读说明 */
.warn-line {
  background: var(--warn-soft);
  color: var(--warn-ink);
  border: 2px solid var(--warn-ink);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.7;
  margin: 10px 0 0;
}
.info-line {
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0 0;
}

/* 内置默认对照区 */
.ref-block {
  margin-top: 10px;
}

@media (max-width: 760px) {
  .panel-head {
    flex-wrap: wrap;
  }
}
</style>
