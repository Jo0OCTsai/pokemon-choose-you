import { defineStore } from "pinia";
import { api } from "../api";
import type { ChatMessage, Task } from "../types";

export type TaskTabKey = "today" | "inbox" | "scheduled" | "done";
export type DexFilter = "all" | "done" | "cancelled";

/** 本地日期串 YYYY-MM-DD（dueAt 的日期部分与之比较，逾期即 <= 当天） */
function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 冒险页口径：进行中（active/paused）或 今日到期含逾期（进度条与 LED 都以此为准） */
function isAdventureTask(t: Task): boolean {
  if (t.status === "active" || t.status === "paused") return true;
  return Boolean(t.dueAt) && t.dueAt!.slice(0, 10) <= localDateStr();
}

export const useTasksStore = defineStore("tasks", {
  state: () => ({
    /** open = inbox/scheduled/active/paused（冒险/草丛/路线页共用） */
    open: [] as Task[],
    /** 图鉴页数据：done + cancelled（最近 200 条，按完成/取消时间倒序） */
    done: [] as Task[],
    /** 图鉴页筛选：全部 / 已捕捉 / 已逃走 */
    dexFilter: "all" as DexFilter,
    /** 收音机电波：所有已拉取的飞书消息（含 AI 未识别为待办的） */
    chatMessages: [] as ChatMessage[],
    loading: false,
  }),
  getters: {
    /** 今日捕捉进度（口径与冒险页一致）：今日完成 /（今日完成 + 冒险页在列）。
     * 不看全库未完成与累计完成——草丛、路线未来的任务不该稀释今天的进度 */
    caught(state) {
      const today = localDateStr();
      const doneToday = state.done.filter(
        (t) => t.status === "done" && t.completedAt && localDateStr(new Date(t.completedAt)) === today,
      ).length;
      const total = doneToday + state.open.filter(isAdventureTask).length;
      return {
        done: doneToday,
        total,
        pct: total ? Math.round((doneToday / total) * 100) : 0,
      };
    },
    /** 待处理的建议数（侧边栏角标）：新待办建议 + 更新建议 */
    pendingSuggestions(state): number {
      return state.chatMessages.filter(
        (m) => m.reviewStatus === "pending" && (m.aiStatus === "todo" || m.aiStatus === "update"),
      ).length;
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
        return isAdventureTask(t);
      });
    },
    async reload() {
      this.loading = true;
      try {
        // 各数据源独立失败：任一查询报错不能连累其余（曾因收音机缺列让主窗口任务全消失）
        const [open, done, chatMessages] = await Promise.allSettled([
          api.listTasks("open"),
          api.listTasks("done"),
          api.listChatMessages(),
        ]);
        if (open.status === "fulfilled") this.open = open.value;
        if (done.status === "fulfilled") {
          this.done = done.value;
        }
        if (chatMessages.status === "fulfilled") this.chatMessages = chatMessages.value;
      } finally {
        this.loading = false;
      }
    },
  },
});
