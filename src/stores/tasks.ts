import { defineStore } from "pinia";
import { api } from "../api";
import type { ChatMessage, Task } from "../types";

export type TaskTabKey = "today" | "inbox" | "scheduled" | "done";

export const useTasksStore = defineStore("tasks", {
  state: () => ({
    /** open = inbox/scheduled/active/paused（冒险/草丛/路线页共用） */
    open: [] as Task[],
    /** 最近完成的 200 条（图鉴页） */
    done: [] as Task[],
    doneCount: 0,
    /** 收音机电波：所有已拉取的飞书消息（含 AI 未识别为待办的） */
    chatMessages: [] as ChatMessage[],
    loading: false,
  }),
  getters: {
    /** 今日捕捉进度：已完成 / 总数 */
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
      if (tab === "done") return this.done;
      return this.open.filter((t) => {
        if (tab === "inbox") return t.status === "inbox";
        if (tab === "scheduled") return t.status === "scheduled" || t.status === "paused";
        // today：进行中 + 今日到期（后端 today 过滤的本地镜像）
        return t.status !== "done";
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
        this.doneCount = done.length;
        this.chatMessages = chatMessages;
      } finally {
        this.loading = false;
      }
    },
  },
});
