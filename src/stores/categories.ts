import { defineStore } from "pinia";
import { api } from "../api";
import type { Category } from "../types";

export const useCategoriesStore = defineStore("categories", {
  state: () => ({
    list: [] as Category[],
  }),
  getters: {
    byId(state): Map<number, Category> {
      return new Map(state.list.map((c) => [c.id, c]));
    },
  },
  actions: {
    async load() {
      this.list = await api.listCategories();
    },
  },
});

/** 分类名 → 徽章配色 key（图鉴条目卡用） */
export function catKeyOf(byId: Map<number, Category>, id: number): string {
  const cls: Record<string, string> = {
    工作: "work",
    学习: "study",
    生活: "life",
    健康: "health",
    社交: "social",
    紧急: "urgent",
  };
  const name = byId.get(id)?.name;
  return (name && cls[name]) || "work";
}
