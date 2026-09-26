<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { fmtDateTime } from "../../stores/settings";
import type { ChatMessage } from "../../types";

/**
 * 单条电波行。原 RadioTab 内 5 处近乎逐字的复制（时间模式：待办信号 / 无信号 / 已捕捉 / 已逃走 + 频道模式混合行），
 * 差异位收敛到 variant 逐一对应原内联分支：勾选显隐、会话徽标、🔧/🔇 chip、置信点、dim 与行尾标记。
 */
defineProps<{
  message: ChatMessage;
  variant: "signal" | "noise" | "caught" | "escaped" | "channel";
  /** 当前选中行 id（右栏详情跟随，v-model:selected-id 双向） */
  selectedId?: number | null;
  /** 勾选态（批量分诊；仅 signal/noise/channel-pending 行渲染勾选框） */
  checked?: boolean;
}>();

const emit = defineEmits<{
  "update:selectedId": [id: number];
  toggleCheck: [id: number];
}>();

const { t } = useI18n();

const isSignal = (m: ChatMessage) => m.aiStatus === "todo" || m.aiStatus === "update";
const chatTypeLabel = (m: ChatMessage) => (m.chatType ? t(`im.type.${m.chatType}`) : "");
const snippet = (m: ChatMessage) => m.content.split("\n")[0] ?? "";
</script>

<template>
  <div
    class="rrow"
    :class="{
      sel: message.id === selectedId,
      dim:
        variant === 'caught' || variant === 'escaped' || (variant === 'channel' && message.reviewStatus !== 'pending'),
    }"
    @click="emit('update:selectedId', message.id)"
  >
    <input
      v-if="
        variant === 'signal' || variant === 'noise' || (variant === 'channel' && message.reviewStatus === 'pending')
      "
      type="checkbox"
      class="im-check"
      :checked="checked"
      :aria-label="t('im.selectAll')"
      @click.stop
      @change="emit('toggleCheck', message.id)"
    />
    <div class="r-main">
      <div class="r-line1">
        <span v-if="variant !== 'channel' && (message.chatType || message.chatName)" class="chat-badge">
          {{ chatTypeLabel(message) ? `${chatTypeLabel(message)}·` : "" }}{{ message.chatName || "FEISHU" }}
        </span>
        <span class="r-sender">{{ message.sender }}</span>
        <span
          v-if="
            message.aiStatus === 'update' &&
            (variant === 'signal' || (variant === 'channel' && message.reviewStatus === 'pending'))
          "
          class="chat-badge"
          >🔧 {{ t("im.chipUpdate") }}</span
        >
        <span
          v-if="variant === 'channel' && !isSignal(message) && message.reviewStatus === 'pending'"
          class="chat-badge"
          >🔇 {{ t("im.chipNoise") }}</span
        >
        <span
          v-if="
            variant === 'signal' || (variant === 'channel' && message.reviewStatus === 'pending' && isSignal(message))
          "
          class="conf"
          :class="message.suggestedConfidence || 'low'"
          :title="variant === 'signal' ? t(`im.confidence.${message.suggestedConfidence || 'low'}`) : undefined"
        ></span>
        <span class="r-time">{{ fmtDateTime(message.createdAt) }}</span>
      </div>
      <div class="r-snippet">{{ snippet(message) }}</div>
    </div>

    <span v-if="variant === 'caught'" class="r-mark ok">
      {{ message.followupTaskId ? t("im.markMerged", { id: message.followupTaskId }) : `✔ No.${message.taskId}` }}
    </span>
    <span v-else-if="variant === 'escaped'" class="r-marks">
      <span v-if="isSignal(message)" class="veto-chip" :title="t('im.vetoedTitle')">⚡ {{ t("im.chipVetoed") }}</span>
      <span class="r-mark no">✕</span>
    </span>
    <template v-else-if="variant === 'channel'">
      <span v-if="message.followupTaskId" class="r-mark ok">{{
        t("im.markMerged", { id: message.followupTaskId })
      }}</span>
      <span v-else-if="message.taskId" class="r-mark ok">✔ No.{{ message.taskId }}</span>
      <span v-else-if="message.reviewStatus === 'dismissed'" class="r-marks">
        <span v-if="isSignal(message)" class="veto-chip" :title="t('im.vetoedTitle')">⚡ {{ t("im.chipVetoed") }}</span>
        <span class="r-mark no">✕</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
/* 单行消息 */
.rrow {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 3px solid transparent;
}
.rrow:hover {
  background: var(--hover);
}
.rrow.sel {
  background: var(--hover);
  border-color: var(--dex-navy);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.rrow.dim {
  opacity: 0.6;
}
.im-check {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--dex-navy);
  cursor: pointer;
  flex: none;
}
.r-main {
  flex: 1;
  min-width: 0;
}
.r-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
}
.chat-badge {
  flex: none;
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  border: 2px solid var(--ink-faint);
  border-radius: 4px;
  padding: 0 4px;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-sender {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-time {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 500;
}
.r-snippet {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-mark {
  flex: none;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 800;
}
.r-mark.ok {
  color: var(--dex-navy);
}
.r-mark.no {
  color: var(--ink-soft);
}
/* 行尾标记组：✕ 旁可挂「已否决」chip——AI 判了信号但被人工推翻，回看时一眼找到推翻点 */
.r-marks {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-top: 2px;
}
.r-marks .r-mark {
  margin-top: 0;
}
.veto-chip {
  font-size: 10px;
  font-weight: 800;
  color: var(--warn-ink);
  border: 2px solid var(--warn-ink);
  border-radius: 4px;
  padding: 0 4px;
  white-space: nowrap;
}
/* 置信色点（行内紧凑版） */
.conf {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--dex-navy);
  flex: none;
}
.conf.high {
  background: var(--ok-bright);
}
.conf.medium {
  background: var(--poke-yellow);
}
.conf.low {
  background: var(--conf-low);
}
</style>
