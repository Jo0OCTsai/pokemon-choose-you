<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { fmtDateTime } from "../../stores/settings";
import type { ChatMessage } from "../../types";

/** AI 建议卡：新待办 / 更新已有待办两处同构模板合一，差异位（卡头文案、底色、变更字段行）走 props */
defineProps<{
  message: ChatMessage;
  /** 卡头文案（新待办 = 发现…；更新 = 建议更新待办 No.x） */
  title: string;
  /** 卡头后追加的原任务标题（更新卡「…」引导） */
  quoted?: string;
  /** 更新卡：底色区别 + 追加「标题 → 」变更字段行 */
  update?: boolean;
}>();

const { t } = useI18n();

/** 内置维度的展示名（自定义维度回落 key）；建议卡 chip 的 title 提示用 */
const dimLabel = (key: string) => (["project", "context", "person", "topic"].includes(key) ? t(`dim.${key}`) : key);
/** 建议标签 chip 的悬浮说明：拟新建的标签标明「接受时才会创建」 */
const chipTitle = (tag: { name: string; dimension: string; isNew: boolean }) =>
  tag.isNew ? t("im.tagNew", { dim: dimLabel(tag.dimension) }) : dimLabel(tag.dimension);
</script>

<template>
  <div class="im-suggest" :class="{ update }">
    {{ title }}<span v-if="quoted">「{{ quoted }}」</span>
    <span v-if="update && message.suggestedTitle">{{ t("edit.title") }} → {{ message.suggestedTitle }}</span>
    <span v-if="message.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(message.suggestedDue) }) }}）</span>
    <span v-if="message.suggestedPriority" class="sug-prio">{{ t(`priority.${message.suggestedPriority}`) }}</span>
    <span v-if="message.suggestedConfidence" class="sug-conf" :class="'c-' + message.suggestedConfidence">
      {{ t(`im.confidence.${message.suggestedConfidence}`) }}
    </span>
    <span
      v-for="tag in message.suggestedTags"
      :key="tag.dimension + ':' + tag.name"
      class="sug-tag"
      :class="{ 'sug-new': tag.isNew, ['sug-dim-' + tag.dimension]: true }"
      :title="chipTitle(tag)"
      >{{ tag.isNew ? "＋" : "#" }} {{ tag.name }}</span
    >
    <span v-if="message.suggestedReason" class="sug-reason">💡 {{ message.suggestedReason }}</span>
  </div>
</template>

<style scoped>
.im-suggest {
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.im-suggest.update {
  background: var(--conf-mid-soft);
}
.sug-prio {
  font-size: 11px;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 6px;
}
.sug-tag {
  font-size: 11px;
  color: var(--dex-navy);
  background: var(--tag-pill);
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 0 7px;
}
/* 项目维度是主位信息：黄色；拟新建的标签用虚线描边 + 前缀 ＋ */
.sug-tag.sug-dim-project {
  background: var(--poke-yellow);
  color: var(--dex-navy);
}
.sug-tag.sug-new {
  border-style: dashed;
  font-weight: 800;
}
/* 置信档位：高=绿 / 中=琥珀 / 低=灰 */
.sug-conf {
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 6px;
}
.sug-conf.c-high {
  color: var(--ok-ink);
  background: var(--ok-soft);
}
.sug-conf.c-medium {
  color: var(--warn-ink);
  background: var(--conf-mid-soft);
}
.sug-conf.c-low {
  color: var(--ink-soft);
  background: var(--conf-low-soft);
}
.sug-reason {
  flex-basis: 100%;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-soft);
}
</style>
