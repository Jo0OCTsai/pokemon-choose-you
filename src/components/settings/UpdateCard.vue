<script setup lang="ts">
import { useI18n } from "vue-i18n";

/**
 * 自动更新卡（自 SettingsTab 拆出）：当前版本 / 新版本提示 / 检查更新 / 安装。
 * 版本号、更新忙位与进度文案由父级持有（页面挂载预取版本；下载进度经 tauri 事件
 * 跨分区持续推送），检查/安装动作经 emit 回父级——不在卡内自查自装。
 */
defineProps<{
  appVersion: string;
  latestVersion?: string;
  updating: boolean;
  updateMsg: string;
}>();
const emit = defineEmits<{ check: []; install: [] }>();

const { t } = useI18n();
/** 平台限定的说明只在对应平台渲染（DESIGN_SYSTEM.md §4.4 说明文字四层归属） */
const isLinux = /linux/i.test(navigator.userAgent);
</script>

<template>
  <section class="set-card">
    <h3>⬆️ {{ t("update.title") }}</h3>
    <p v-if="appVersion" class="set-sub">{{ t("update.current", { v: appVersion }) }}</p>
    <p v-if="latestVersion" class="set-sub">{{ t("update.found", { v: latestVersion }) }}</p>
    <p v-if="updateMsg" class="hint">{{ updateMsg }}</p>
    <div class="btn-row">
      <button class="btn ghost" :disabled="updating" @click="emit('check')">
        {{ t("update.check") }}
      </button>
      <button v-if="latestVersion" class="btn ghost" :disabled="updating" @click="emit('install')">
        {{ t("update.install") }}
      </button>
    </div>
    <p v-if="isLinux" class="set-foot">{{ t("update.linuxHint") }}</p>
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
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
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
.btn-row {
  display: flex;
  gap: 10px;
}
</style>
