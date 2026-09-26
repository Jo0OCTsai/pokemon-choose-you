<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { fmtDateTime } from "../../stores/settings";
import { useTasksStore } from "../../stores/tasks";
import type { ChatMessage } from "../../types";
import EscapeReasonPop from "./EscapeReasonPop.vue";
import SuggestCard from "./SuggestCard.vue";

/** 右栏详情与操作：选中电波经 props 传入，分诊动作 emit 回 RadioTab（按钮位置固定，不随消息滚动） */
defineProps<{
  /** 当前选中的电波（null = 未选中空态） */
  message: ChatMessage | null;
  /** 强制捕捉进行中的消息 id（按钮禁用 / 「判定中」文案） */
  forcingId: number | null;
  /** error 消息重判进行中 */
  retrying: boolean;
  /** 逃走原因弹层是否打开（挂在选中消息上；背板在操作区之前渲染，见模板内注释） */
  menuOpen: boolean;
}>();

const emit = defineEmits<{
  accept: [message: ChatMessage];
  dismiss: [message: ChatMessage, code?: string];
  force: [message: ChatMessage];
  restore: [message: ChatMessage];
  retry: [ids: number[]];
  toggleMenu: [];
  closeMenu: [];
}>();

const { t } = useI18n();
const tasksStore = useTasksStore();

const isSignal = (m: ChatMessage) => m.aiStatus === "todo" || m.aiStatus === "update";
const chatTypeLabel = (m: ChatMessage) => (m.chatType ? t(`im.type.${m.chatType}`) : "");
const aiStatusKey = (m: ChatMessage) => `im.status.${m.aiStatus}`;
const taskTitle = (id: number) => tasksStore.open.find((tk) => tk.id === id)?.title ?? "";
</script>

<template>
  <section class="im-right">
    <div v-if="!message" class="d-empty">{{ t("im.selectHint") }}</div>
    <div v-else class="d-body">
      <div class="d-meta">
        <span v-if="message.chatType" class="type-badge">{{ chatTypeLabel(message) }}</span>
        <span>{{ message.chatName || "FEISHU" }} · {{ message.sender }} · {{ fmtDateTime(message.createdAt) }}</span>
        <span class="ai-status">{{ t(aiStatusKey(message)) }}</span>
      </div>
      <div class="lcd d-content im-content">{{ message.content }}</div>

      <!-- AI 建议：新待办 -->
      <SuggestCard
        v-if="message.suggestedTitle && message.aiStatus !== 'update' && message.reviewStatus === 'pending'"
        :message="message"
        :title="t('im.found') + message.suggestedTitle"
      />

      <!-- AI 建议：更新已有待办（只展示明确给出的变更字段） -->
      <SuggestCard
        v-if="message.aiStatus === 'update' && message.updateTaskId && message.reviewStatus === 'pending'"
        :message="message"
        update
        :title="t('im.updateFound', { id: message.updateTaskId })"
        :quoted="taskTitle(message.updateTaskId)"
      />

      <!-- 无信号说明 -->
      <div v-if="!isSignal(message) && message.reviewStatus === 'pending'" class="im-suggest none">
        🔇 {{ t(`im.status.${message.aiStatus}`)
        }}<span v-if="message.suggestedReason"> · {{ message.suggestedReason }}</span>
      </div>

      <!-- 已处理状态条 -->
      <div v-if="message.followupTaskId" class="done-banner">
        ✔ {{ t("im.followedTask", { id: message.followupTaskId }) }}
        <span v-if="taskTitle(message.followupTaskId)" class="caught-sub"
          >「{{ taskTitle(message.followupTaskId) }}」</span
        >
      </div>
      <div v-else-if="message.reviewStatus === 'accepted'" class="done-banner">
        ✔ {{ t("im.caughtTask", { id: message.taskId ?? 0 }) }}
      </div>
      <div v-else-if="message.reviewStatus === 'dismissed'" class="done-banner dim-banner">
        ✕ {{ t("im.released") }}
        <span class="caught-sub">{{ t("im.aiVerdict") }}：{{ t(aiStatusKey(message)) }}</span>
        <span v-if="message.dismissReason" class="caught-sub"
          >{{ t("im.dismissReasonLabel") }}：{{ t(`im.escapeReasons.${message.dismissReason}`) }}</span
        >
      </div>

      <!-- 弹层背板：点外面收起。必须排在操作区之前——弹层挂在操作区内，
           「先于操作区 + 更低 z」让 DOM 顺序与 z-index 两种层叠解释下选项都压在背板上
           （WKWebView 上曾表现为背板盖住弹层，选项点击被背板吞掉只关菜单） -->
      <div v-if="menuOpen" class="pop-mask" @click="emit('closeMenu')"></div>

      <!-- 操作区 -->
      <div class="im-actions">
        <template v-if="message.reviewStatus === 'pending' && message.aiStatus === 'update'">
          <button class="btn" :disabled="forcingId === message.id" @click="emit('accept', message)">
            {{ forcingId === message.id ? t("im.forcing") : t("im.applyUpdate") }}<span class="kbd">C</span>
          </button>
          <button class="btn red" @click="emit('dismiss', message)">
            {{ t("im.release") }}<span class="kbd">X</span>
          </button>
          <button
            class="btn ghost er-toggle"
            :title="t('im.escapeWhy')"
            :aria-label="t('im.escapeWhy')"
            @click="emit('toggleMenu')"
          >
            ▾
          </button>
        </template>
        <template v-else-if="message.reviewStatus === 'pending' && message.aiStatus === 'todo'">
          <button class="btn" @click="emit('accept', message)">{{ t("im.catch") }}<span class="kbd">C</span></button>
          <button class="btn red" @click="emit('dismiss', message)">
            {{ t("im.release") }}<span class="kbd">X</span>
          </button>
          <button
            class="btn ghost er-toggle"
            :title="t('im.escapeWhy')"
            :aria-label="t('im.escapeWhy')"
            @click="emit('toggleMenu')"
          >
            ▾
          </button>
          <button class="btn ghost force" :disabled="forcingId === message.id" @click="emit('force', message)">
            {{ forcingId === message.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
          </button>
        </template>
        <template v-else-if="message.reviewStatus === 'pending'">
          <!-- 无信号/判定失败：重判（仅 error）、逃走或强制捕捉 -->
          <button
            v-if="message.aiStatus === 'error'"
            class="btn ghost"
            :disabled="retrying"
            @click="emit('retry', [message.id])"
          >
            {{ retrying ? t("im.retrying") : `♻ ${t("im.retry")}` }}
          </button>
          <button class="btn red" @click="emit('dismiss', message)">
            {{ t("im.release") }}<span class="kbd">X</span>
          </button>
          <button
            class="btn ghost er-toggle"
            :title="t('im.escapeWhy')"
            :aria-label="t('im.escapeWhy')"
            @click="emit('toggleMenu')"
          >
            ▾
          </button>
          <button class="btn ghost force" :disabled="forcingId === message.id" @click="emit('force', message)">
            {{ forcingId === message.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
          </button>
        </template>
        <template v-else-if="message.reviewStatus === 'dismissed'">
          <button class="btn ghost" @click="emit('restore', message)">↩ {{ t("im.restore") }}</button>
          <button class="btn ghost force" :disabled="forcingId === message.id" @click="emit('force', message)">
            {{ forcingId === message.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
          </button>
        </template>
        <template v-else>
          <button class="btn ghost force" :disabled="forcingId === message.id" @click="emit('force', message)">
            {{ forcingId === message.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
          </button>
        </template>

        <!-- 弹层仅在选中态打开（menuOpen = 父级判定 escapeMenuId === 选中消息 id），message 必非空 -->
        <EscapeReasonPop v-if="menuOpen" @escape="(code) => emit('dismiss', message!, code)" />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 右栏详情 */
.im-right {
  flex: 2 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.d-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 2;
  text-align: center;
}
.d-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.d-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
  flex-wrap: wrap;
}
.d-meta .type-badge {
  color: var(--dex-navy);
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  background: #fff;
}
.d-content {
  padding: 14px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
  white-space: pre-wrap;
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
}
.ai-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 6px;
  background: #fff;
  color: var(--dex-navy);
  flex: none;
}
/* 无信号说明条（建议卡 SuggestCard 内持同名基础样式，scoped 隔离各一份） */
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
.im-suggest.none {
  background: var(--conf-low-soft);
  color: var(--ink-soft);
  font-weight: 600;
}
.done-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
  background: var(--ok-soft);
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 10px 12px;
  flex-wrap: wrap;
}
.done-banner.dim-banner {
  background: var(--conf-low-soft);
  color: var(--ink-soft);
}
.caught-sub {
  font-size: 12px;
  color: var(--ink-soft);
}

/* 操作区（固定在详情底部，不随消息滚动） */
.im-actions {
  flex: none;
  display: flex;
  gap: 10px;
  align-items: center;
  position: relative;
  flex-wrap: wrap;
}
.im-actions .force {
  color: var(--dex-navy);
}
.im-actions .red {
  background: var(--dex-red);
  color: #fff;
}
/* 快捷键提示 chip（NN/g：快捷键标在按钮上，用着用着就学会了） */
.kbd {
  display: inline-block;
  font-family: "Press Start 2P", monospace;
  font-size: 8px;
  background: #fff;
  border: 2px solid var(--dex-navy);
  border-bottom-width: 3px;
  border-radius: 4px;
  padding: 2px 5px;
  margin-left: 6px;
  vertical-align: 1px;
}
.im-actions .red .kbd {
  background: rgba(255, 255, 255, 0.25);
}
.er-toggle {
  padding: 8px 10px;
}
/* 弹层背板：点外面收起 */
.pop-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
}
</style>
