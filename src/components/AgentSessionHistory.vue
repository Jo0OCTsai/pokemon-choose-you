<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import type { AgentSession, SessionCounts } from "../types";

/**
 * 全局会话历史列表（顶层「冒险日志」页，2026-09 自设置 · Agent 分区抽为独立菜单）：
 * 收音机分类（classify/capture）与待办派发（dispatch_headless/dispatch_interactive）
 * 共用 agent_sessions 表，task_id 为空的收音机会话此前无任何 UI 入口——这里按来源
 * 分组 + 分页拉通展示，不分本地/远程。分组过滤与 LIMIT/OFFSET 翻页下沉后端
 * （list_agent_sessions_paged），四档计数随页带回。回放走 open_recorded_session：
 * 按记录里的执行时快照路由（远端 ssh / tmux 重连 / --resume 转录），不依赖 agent 当前配置。
 */
const { t, te } = useI18n();

/** 每页行数（与后端 list_agent_sessions_paged 的 limit 钳制上限 100 对齐留余量） */
const PAGE_SIZE = 20;

const items = ref<AgentSession[]>([]);
const total = ref(0);
const counts = ref<SessionCounts>({ all: 0, radio: 0, dispatch: 0, other: 0 });
const page = ref(1); // 1-based；offset = (page-1) * PAGE_SIZE
const loading = ref(false);
const loadError = ref("");
const filter = ref<"all" | "radio" | "dispatch" | "other">("all");
/** 回放中的行（防连点） */
const openingIds = ref(new Set<number>());
const toast = ref<{ text: string; error?: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string, error = false) {
  toast.value = { text, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const p = await api.listAgentSessionsPaged(filter.value, PAGE_SIZE, (page.value - 1) * PAGE_SIZE);
    items.value = p.items;
    total.value = p.total;
    counts.value = p.counts;
    // 数据在两次加载间收缩（如另一窗口删了记录）导致页码越界：回到末页重拉一次
    if (page.value > maxPage.value) {
      page.value = maxPage.value;
      const again = await api.listAgentSessionsPaged(filter.value, PAGE_SIZE, (page.value - 1) * PAGE_SIZE);
      items.value = again.items;
      total.value = again.total;
    }
  } catch (e) {
    loadError.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

/** 筛选切换：分组变了总量也变，回到第 1 页 */
function setFilter(f: "all" | "radio" | "dispatch" | "other") {
  if (filter.value === f) return;
  filter.value = f;
  page.value = 1;
  void load();
}

function goPage(delta: number) {
  const next = page.value + delta;
  if (next < 1 || next > maxPage.value) return;
  page.value = next;
  void load();
}

function kindText(kind: string | undefined): string {
  return te(`sess.kind.${kind || "legacy"}`) ? t(`sess.kind.${kind || "legacy"}`) : kind || "—";
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 1000) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

async function openSession(x: AgentSession) {
  if (openingIds.value.has(x.id)) return;
  openingIds.value.add(x.id);
  try {
    const term = await api.openRecordedSession(x.id);
    showToast(term);
  } catch (e) {
    showToast(errorMessage(e), true);
  } finally {
    openingIds.value.delete(x.id);
  }
}

onMounted(load);
</script>

<template>
  <div class="sess-hist">
    <div class="sess-toolbar">
      <div class="sess-filters">
        <button
          v-for="f in ['all', 'radio', 'dispatch', 'other'] as const"
          :key="f"
          class="chip"
          :class="{ on: filter === f }"
          type="button"
          @click="setFilter(f)"
        >
          {{ t(`sess.filter_${f}`) }}<span class="chip-n">{{ counts[f] }}</span>
        </button>
      </div>
      <button class="btn ghost" type="button" :disabled="loading" @click="load">
        {{ loading ? t("sess.loading") : t("sess.reload") }}
      </button>
    </div>

    <p v-if="loadError" class="err">❌ {{ loadError }}</p>
    <p v-else-if="!loading && !items.length" class="sess-empty">{{ t("sess.empty") }}</p>

    <ul v-else class="sess-list">
      <li v-for="x in items" :key="x.id" class="sess-row" :class="{ err: x.status === 'error' }">
        <div class="sess-meta">
          <span class="sess-kind" :class="{ err: x.status === 'error' }">{{ kindText(x.kind) }}</span>
          <span class="sess-agent">{{ x.agentName }}</span>
          <span v-if="x.remoteHost" class="sess-host" :title="x.remoteHost">SSH · {{ x.remoteHost }}</span>
          <span v-else class="sess-host local">local</span>
          <span class="sess-time">{{ fmtDateTime(x.createdAt) }}</span>
          <button
            class="btn ghost sess-open"
            type="button"
            :disabled="openingIds.has(x.id)"
            :title="x.tmuxSession ? t('sess.openTmux') : t('edit.openTranscript')"
            @click="openSession(x)"
          >
            ▶ {{ t("sess.open") }}
          </button>
        </div>
        <div class="sess-detail" :title="x.workdir || undefined">
          <template v-if="x.taskId">No.{{ x.taskId }} · </template>
          <template v-if="x.durationMs != null">{{ fmtDuration(x.durationMs) }} · </template>
          <template v-if="x.costUsd != null">${{ x.costUsd.toFixed(2) }} · </template>
          <span class="sess-dir">{{ x.workdir || t("sess.dirUnset") }}</span>
        </div>
        <div v-if="x.command" class="sess-cmd">{{ x.command }}</div>
      </li>
    </ul>

    <!-- 翻页：单页放得下（total ≤ PAGE_SIZE）时整条隐藏 -->
    <div v-if="maxPage > 1" class="sess-pager">
      <button class="btn ghost mini" type="button" :disabled="page <= 1 || loading" @click="goPage(-1)">
        ‹ {{ t("sess.prev") }}
      </button>
      <span class="sess-pageinfo">{{ t("sess.pageOf", { cur: page, max: maxPage }) }}</span>
      <button class="btn ghost mini" type="button" :disabled="page >= maxPage || loading" @click="goPage(1)">
        {{ t("sess.next") }} ›
      </button>
    </div>

    <p v-if="toast" class="sess-toast" :class="{ error: toast.error }" role="status">{{ toast.text }}</p>
  </div>
</template>

<style scoped>
.sess-hist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sess-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sess-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  border: 1px solid var(--border, #d8d8d8);
  border-radius: 999px;
  background: transparent;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  color: inherit;
}
.chip.on {
  background: var(--accent-soft, #e8f0fe);
  border-color: var(--accent, #4a7dff);
}
.chip-n {
  opacity: 0.6;
  margin-left: 4px;
}
.sess-empty {
  color: var(--ink-soft);
  text-align: center;
  padding: 48px 0;
  font-size: 14px;
  line-height: 2;
}
.sess-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 行卡与任务页 .entry 同档（白底描边硬阴影），整页宽度跟随内容区 */
.sess-row {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px 14px;
  font-size: 13px;
}
.sess-row.err {
  border-color: #c66;
}
.sess-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sess-kind {
  font-size: 12px;
  border-radius: 4px;
  padding: 0 6px;
  background: var(--accent-soft, #eef2f8);
  white-space: nowrap;
}
.sess-kind.err {
  background: #f9e3e3;
  color: #a33;
}
.sess-agent {
  font-weight: 600;
  white-space: nowrap;
}
.sess-host {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}
.sess-time {
  margin-left: auto;
  opacity: 0.65;
  white-space: nowrap;
}
.sess-open {
  padding: 1px 8px;
  font-size: 12px;
  white-space: nowrap;
}
.sess-detail {
  opacity: 0.8;
  margin-top: 2px;
  word-break: break-all;
}
.sess-dir {
  font-family: var(--mono, monospace);
  font-size: 12px;
}
.sess-cmd {
  opacity: 0.6;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sess-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.sess-pageinfo {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
.sess-toast {
  font-size: 13px;
  margin: 0;
}
.sess-toast.error {
  color: #b33;
}
</style>
