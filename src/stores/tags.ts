import { defineStore } from "pinia";
import { api } from "../api";
import type { Tag, TagDimension } from "../types";

/** 标签配置（设置页维护，任务编辑/AI 建议消费）；维度（分面）+ 维度内标签 */
export const useTagsStore = defineStore("tags", {
  state: () => ({
    list: [] as Tag[],
    dimensions: [] as TagDimension[],
  }),
  getters: {
    /** 启用中的维度（新建/编辑与 AI 选项只用启用的；渲染任务标签时不过滤） */
    enabledDimensions(state): TagDimension[] {
      return state.dimensions.filter((d) => d.enabled);
    },
    /** 维度 key → 维度（展示名/单多选/上限；未知 key 的标签渲染回落通用样式） */
    dimByKey(state): Map<string, TagDimension> {
      return new Map(state.dimensions.map((d) => [d.key, d]));
    },
    /** 按维度分组的标签（编辑弹窗分组选择器；无维度信息的标签归 topic） */
    tagsByDimension(state): Map<string, Tag[]> {
      const groups = new Map<string, Tag[]>();
      for (const d of state.dimensions) groups.set(d.key, []);
      for (const t of state.list) {
        const key = t.dimension || "topic";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t);
      }
      return groups;
    },
    /** 名字 + 维度 → id（编辑弹窗提交 tagIds 用）；同名跨维度按精确维度命中 */
    refToId(state): (name: string, dimension: string) => number | undefined {
      return (name, dimension) =>
        state.list.find((t) => t.name === name && (t.dimension || "topic") === (dimension || "topic"))?.id ??
        state.list.find((t) => t.name === name)?.id;
    },
  },
  actions: {
    async load() {
      const [tags, dimensions] = await Promise.all([api.listTags(), api.listTagDimensions()]);
      this.list = tags;
      this.dimensions = dimensions;
    },
  },
});
