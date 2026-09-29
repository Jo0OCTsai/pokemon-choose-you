<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { usePromptEditor } from "../../composables/usePromptEditor";
import PromptFeaturePanel from "./PromptFeaturePanel.vue";

/**
 * 「AI 提示词」卡（Agent 分区第 2 卡，CLI 卡之后、项目派发路由卡之前）：卡级装载与
 * 失败重试，5 个功能折叠面板。数据自独立装载（不依赖 agentsStore / 主 agent 选择——
 * 未配置 agent 也可查看）；提示词键不入设置页批量保存链路，面板内即时落库
 * （QuotesEditorCard / TagDispatchCard 卡内保存先例）。
 */
const { t } = useI18n();
const { loading, loadError, panels, reload } = usePromptEditor();

/** 骨架行功能序（与后端目录顺序一致：装载前无数据，用固定 id 序借 i18n 撑出面板头） */
const FEATURE_ORDER = ["im_classify", "capture", "pet_chat", "tag_health", "dispatch"] as const;
</script>

<template>
  <section class="set-card">
    <h3>{{ t("prompts.title") }}</h3>
    <p class="set-sub">{{ t("prompts.sub") }}</p>

    <!-- 读取失败：错误行 + 重试；面板不渲染残缺文本 -->
    <div v-if="loadError !== null" class="load-error">
      <span class="err-text">{{ t("prompts.loadFailed", { err: loadError }) }}</span>
      <button class="btn ghost mini" :disabled="loading" @click="reload">{{ t("prompts.retry") }}</button>
    </div>

    <!-- 读取中 / 失败：面板折叠头骨架就位（失败时无 LCD 读取条） -->
    <div v-if="loading || loadError !== null" class="panels-skel">
      <div v-if="loading" class="lcd skel">{{ t("prompts.loading") }}</div>
      <div v-for="id in FEATURE_ORDER" :key="id" class="panel-skel">{{ t(`prompts.feature.${id}`) }}</div>
    </div>
    <template v-else>
      <PromptFeaturePanel v-for="p in panels" :key="p.id" :panel="p" />
    </template>

    <p class="set-foot">{{ t("prompts.foot") }}</p>
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
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}

/* 卡级错误行：底色纯白 + --dex-red-dark 文字（白底 ≥6:1） */
.load-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  flex-wrap: wrap;
  background: #fff;
  border: 2px solid var(--danger);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
}
.err-text {
  color: var(--dex-red-dark);
  font-weight: 700;
  min-width: 0;
}
.load-error .btn {
  flex: none;
}

/* 装载骨架：面板折叠头就位（虚线占位）；LCD 读取条文字用 --lcd-text（--lcd-dark 对比度不足） */
.panels-skel {
  margin-bottom: 2px;
}
.lcd.skel {
  color: var(--lcd-text);
  text-align: center;
  padding: 18px 0;
  margin-bottom: 10px;
  font-size: 12px;
}
.panel-skel {
  border: 3px dashed var(--ink-faint);
  border-radius: 8px;
  margin-bottom: 10px;
  padding: 9px 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-faint);
}
</style>
