<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { fmtDateTime } from "../../stores/settings";
import type { IntegrationHealth } from "../../types";

/**
 * 集成健康面板卡（自 SettingsTab 拆出）：各 provider 的健康行 + 飞书一键重试。
 * reload 暴露给分区壳，转发父级 integrationHealthChanged 事件的跟随刷新。
 */
const { t } = useI18n();
const { busy: testing, run } = inject(ACTION_TOAST)!;

const health = ref<IntegrationHealth[]>([]);
async function loadHealth() {
  try {
    health.value = await api.getIntegrationHealth();
  } catch {
    health.value = []; // 非桌面环境（单元测试 mock）静默
  }
}
onMounted(() => void loadHealth());

/** 一键重试：飞书立即拉取（完成后刷新健康面板）；无提示文案，错误才进状态条 */
async function retryProvider(provider: string) {
  await run("", async () => {
    if (provider === "feishu") {
      await api.triggerFeishuPoll();
    }
    await loadHealth();
  });
}

const fmtEpoch = (ms: number) => fmtDateTime(new Date(ms).toISOString());

defineExpose({ reload: loadHealth });
</script>

<template>
  <section class="set-card">
    <h3>{{ t("diag.healthTitle") }}</h3>
    <p class="set-sub">{{ t("diag.healthHint") }}</p>
    <div v-for="h in health" :key="h.provider" class="health-item">
      <div class="health-row">
        <span class="health-dot" :class="'h-' + h.status">●</span>
        <span class="health-name">{{ t(`diag.provider.${h.provider}`) }}</span>
        <span class="health-state" :class="'hs-' + h.status">{{ t(`diag.status.${h.status}`) }}</span>
        <span class="health-meta">
          {{ h.lastSuccessAt ? t("diag.lastSuccess", { v: fmtDateTime(h.lastSuccessAt) }) : t("diag.never") }}
          <template v-if="h.nextPollAt"> · {{ t("diag.nextPoll", { v: fmtEpoch(h.nextPollAt) }) }}</template>
          <template v-if="h.provider === 'feishu' && h.pendingCount">
            · {{ t("diag.pending", { n: h.pendingCount }) }}</template
          >
          <template v-if="h.provider === 'ai' && h.primaryAgent">
            · {{ t("diag.primaryAgent", { name: h.primaryAgent }) }}</template
          >
        </span>
        <button
          v-if="h.provider === 'feishu' && h.configured"
          class="btn ghost"
          :disabled="testing"
          @click="retryProvider('feishu')"
        >
          {{ t("diag.pollNow") }}
        </button>
      </div>
      <p v-if="h.lastError" class="hint health-err">{{ fmtDateTime(h.lastErrorAt ?? "") }} · {{ h.lastError }}</p>
    </div>
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
/* 说明文字四层归属的页面两层（行内 desc 在 SettingRow 组件内）：区块副标题 + 卡片脚注 */
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
/* 瞬时反馈信息（保存结果 / 错误 / 空态），不是常驻说明 */
.hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 8px 0 0;
  line-height: 1.7;
}
/* 诊断：集成健康行 */
.health-item {
  margin-bottom: 10px;
}
.health-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.health-dot {
  font-size: 14px;
  line-height: 1;
}
/* 三档状态：绿=正常/待运行，黄=降级/暂停，红=故障；灰=未配置 */
.h-ok,
.h-idle {
  color: var(--ok);
}
.h-degraded,
.h-paused {
  color: var(--warn);
}
.h-down {
  color: var(--dex-red);
  animation: health-blink 1.2s steps(2) infinite;
}
.h-off {
  color: var(--ink-soft);
}
@keyframes health-blink {
  50% {
    opacity: 0.35;
  }
}
.health-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
}
.health-state {
  font-size: 12px;
  font-weight: 700;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 8px;
  background: #fff;
}
.hs-down {
  background: var(--danger);
  color: #fff;
}
.hs-degraded {
  background: var(--warn-soft);
}
.health-meta {
  font-size: 12px;
  color: var(--ink-soft);
  flex: 1;
  min-width: 200px;
}
.health-err {
  margin: 4px 0 0 24px;
  color: var(--danger);
}
</style>
