<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { clipWrite, openContextMenu } from "../../contextMenu";
import { useActionToast } from "../../composables/useActionToast";
import type { LogEntry } from "../../types";
import DexSelect from "../DexSelect.vue";

/**
 * 日志查看器卡（自 SettingsTab 拆出）：级别/来源过滤 + LCD 视图 + 行复制（悬停按钮或右键菜单）
 * + 支持报告一键复制（报告反馈位 reportMsg 独立于底部状态条，渲染在本卡内）。
 * 原实现每次进入 diag 分区都重拉日志，由 onMounted 等价承接。
 */
const { t } = useI18n();

const logLevel = ref("");
const logSource = ref("");
const logEntries = ref<LogEntry[]>([]);
const logsLoading = ref(false);
const logLevelOptions = computed(() => [
  { value: "", label: t("diag.allLevels") },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" },
]);
async function loadLogs() {
  logsLoading.value = true;
  try {
    logEntries.value = await api.listLogEntries(500, logLevel.value || undefined);
  } catch {
    logEntries.value = [];
  } finally {
    logsLoading.value = false;
  }
}
onMounted(() => void loadLogs());

/** 来源过滤在本地做（target / message 包含匹配）；倒序展示，最新在最上 */
const filteredLogs = computed(() => {
  const src = logSource.value.trim().toLowerCase();
  const hit = src
    ? logEntries.value.filter((e) => e.target.toLowerCase().includes(src) || e.message.toLowerCase().includes(src))
    : logEntries.value;
  return [...hit].reverse();
});

function logLineText(e: LogEntry): string {
  return `${e.time} ${e.level.toUpperCase()} ${e.target} ${e.message}`;
}

/** 复制单行日志（悬停按钮或右键），结果借用支持报告的提示位反馈 */
async function copyLogLine(e: LogEntry) {
  const ok = await clipWrite(logLineText(e));
  flashReport(ok ? t("ctx.copied") : t("diag.reportFailed"));
}

function onLogContextMenu(ev: MouseEvent, e: LogEntry) {
  openContextMenu(ev, [{ key: "copyLine", label: t("ctx.copyLine"), action: () => void copyLogLine(e) }]);
}

const { msg: reportMsg, flash: flashReport } = useActionToast();
async function copyReport() {
  try {
    const text = await api.buildSupportReport();
    await navigator.clipboard.writeText(text);
    reportMsg.value = t("diag.reportCopied");
  } catch {
    reportMsg.value = t("diag.reportFailed");
  } finally {
    flashReport(reportMsg.value, 4000);
  }
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("diag.logTitle") }}</h3>
    <div class="log-controls">
      <label>
        {{ t("diag.logLevel") }}
        <DexSelect v-model="logLevel" :options="logLevelOptions" />
      </label>
      <input v-model="logSource" class="log-source" :placeholder="t('diag.logSource')" @keydown.enter="loadLogs" />
      <button class="btn ghost" :disabled="logsLoading" @click="loadLogs">{{ t("diag.refresh") }}</button>
      <button class="btn ghost" @click="copyReport">{{ t("diag.copyReport") }}</button>
    </div>
    <p v-if="reportMsg" class="hint">{{ reportMsg }}</p>
    <div class="log-view lcd">
      <div v-if="!filteredLogs.length" class="log-empty">{{ t("diag.logEmpty") }}</div>
      <div
        v-for="(e, i) in filteredLogs"
        :key="i"
        class="log-line"
        :class="'lv-' + e.level"
        @contextmenu.prevent.stop="onLogContextMenu($event, e)"
      >
        <div class="log-meta">
          <span class="log-time">{{ e.time }}</span>
          <span class="log-lv">{{ e.level.toUpperCase() }}</span>
          <span class="log-target">{{ e.target }}</span>
          <button class="log-copy" :title="t('ctx.copyLine')" @click.stop="copyLogLine(e)">⧉</button>
        </div>
        <div class="log-msg">{{ e.message }}</div>
      </div>
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
/* 瞬时反馈信息（保存结果 / 错误 / 空态），不是常驻说明 */
.hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 8px 0 0;
  line-height: 1.7;
}
/* 诊断：日志查看器 */
.log-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.log-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  color: var(--ink-soft);
}
.log-source {
  flex: 1;
  min-width: 140px;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.log-view {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-empty {
  color: var(--lcd-text);
  opacity: 0.8;
  text-align: center;
  padding: 18px 0;
}
.log-line {
  /* 元数据一行（时间/级别/来源/复制钮）+ 消息独占一行全宽；行距收紧让两行贴成一组，条目间留缝防串行 */
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.5;
}
.log-line + .log-line {
  margin-top: 6px;
}
.log-meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
/* 行内复制按钮：悬停行时出现，不挤占日志文本 */
.log-copy {
  flex: none;
  margin-left: auto; /* 复制钮贴行右缘，悬停行时出现 */
  border: 2px solid var(--lcd-text);
  border-radius: 4px;
  background: transparent;
  color: var(--lcd-text);
  font-size: 11px;
  line-height: 1;
  padding: 2px 5px;
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  align-self: center;
}
.log-line:hover .log-copy,
.log-copy:focus-visible {
  opacity: 0.85;
}
.log-copy:hover {
  opacity: 1;
  background: var(--lcd-text);
  color: var(--lcd);
}
.log-time {
  flex: none;
  opacity: 0.75;
}
.log-lv {
  flex: none;
  width: 44px;
  font-weight: 800;
}
.log-target {
  flex: none;
  opacity: 0.75;
  word-break: break-all;
}
.log-msg {
  white-space: pre-wrap;
  word-break: break-word;
}
.lv-error .log-lv {
  color: var(--log-error);
}
.lv-warn .log-lv {
  color: var(--log-warn);
}
.lv-debug {
  opacity: 0.65;
}
</style>
