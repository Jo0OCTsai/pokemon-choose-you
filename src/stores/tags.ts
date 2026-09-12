import { defineStore } from "pinia";
import { api } from "../api";
import type { Tag } from "../types";

/** 标签配置（设置页维护，任务编辑/AI 建议消费） */
export const useTagsStore = defineStore("tags", {
  state: () => ({
    list: [] as Tag[],
  }),
  getters: {
    byName(state): Map<string, Tag> {
      return new Map(state.list.map((t) => [t.name, t]));
    },
    /** 名称 → id（编辑弹窗提交 tagIds 用） */
    nameToId(state): (name: string) => number | undefined {
      return (name: string) => state.list.find((t) => t.name === name)?.id;
    },
  },
  actions: {
    async load() {
      this.list = await api.listTags();
    },
  },
});
