import { defineStore } from "pinia";
import { api } from "../api";
import type { ChatMessage, Task } from "../types";

export type TaskTabKey = "today" | "inbox" | "scheduled" | "done";
export type DexFilter = "all" | "done" | "cancelled";

/** 本地日期串 YYYY-MM-DD（dueAt 的日期部分与之比较，逾期即 <= 当天） */
function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const useTasksStore = defineStore("tasks", {
  state: () => ({
    /** open = inbox/scheduled/active/paused（冒险/草丛/路线页共用） */
    open: [] as Task[],
    /** 图鉴页数据：done + cancelled（最近 200 条，按完成/取消时间倒序） */
    done: [] as Task[],
    /** 已完成数（不含逃走，捕捉进度分母用） */
    doneCount: 0,
    /** 图鉴页筛选：全部 / 已捕捉 / 已逃走 */
    dexFilter: "all" as DexFilter,
    /** 收音机电波：所有已拉取的飞书消息（含 AI 未识别为待办的） */
    chatMessages: [] as ChatMessage[],
    loading: false,
  }),
  getters: {
    /** 今日捕捉进度：已完成 / 总数（逃走不计入） */
    caught(state) {
      const total = state.open.length + state.doneCount;
      return {
        done: state.doneCount,
        total,
        pct: total ? Math.round((state.doneCount / total) * 100) : 0,
      };
    },
    /** 待处理的待办建议数（侧边栏角标） */
    pendingSuggestions(state): number {
      return state.chatMessages.filter((m) => m.aiStatus === "todo" && m.reviewStatus === "pending").length;
    },
  },
  actions: {
    /** 按 tab 过滤当前页可见任务（与后端 list_tasks 语义对齐） */
    visibleFor(tab: TaskTabKey): Task[] {
      if (tab === "done") {
        if (this.dexFilter === "done") return this.done.filter((t) => t.status === "done");
        if (this.dexFilter === "cancelled") return this.done.filter((t) => t.status === "cancelled");
        return this.done;
      }
      return this.open.filter((t) => {
        if (tab === "inbox") return t.status === "inbox";
        // 路线：除草丛和终态外的全部（scheduled/active/paused）
        if (tab === "scheduled") return t.status !== "inbox" && t.status !== "done" && t.status !== "cancelled";
        // 冒险：进行中（active/paused）+ 今日到期含逾期
        if (t.status === "active" || t.status === "paused") return true;
        return Boolean(t.dueAt) && t.dueAt!.slice(0, 10) <= localDateStr();
      });
    },
    async reload() {
      this.loading = true;
      try {
        const [open, done, chatMessages] = await Promise.all([
          api.listTasks("open"),
          api.listTasks("done"),
          api.listChatMessages(),
        ]);
        this.open = open;
        this.done = done;
        this.doneCount = done.filter((t) => t.status === "done").length;
        this.chatMessages = chatMessages;
      } finally {
        this.loading = false;
      }
    },
  },
});
