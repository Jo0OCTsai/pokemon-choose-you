import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import { useTagsStore } from "../stores/tags";
import type { Tag, TagDimension } from "../types";

vi.mock("../api", () => ({
  api: {
    listTags: vi.fn(async () => []),
    listTagDimensions: vi.fn(async () => []),
  },
}));

function dim(partial: Partial<TagDimension> & { key: string }): TagDimension {
  return {
    id: partial.id ?? 1,
    name: partial.key,
    cardinality: "multi",
    maxTags: 6,
    sort: 0,
    enabled: true,
    builtin: false,
    createdAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

function tag(partial: Partial<Tag> & { id: number }): Tag {
  return {
    name: `标签${partial.id}`,
    description: "",
    dimension: "topic",
    origin: "manual",
    usage: 0,
    createdAt: "2026-09-01T00:00:00Z",
    meta: null,
    ...partial,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("tags store", () => {
  it("load 一次拉齐标签与维度", async () => {
    vi.mocked(api.listTags).mockResolvedValue([tag({ id: 1 })]);
    vi.mocked(api.listTagDimensions).mockResolvedValue([dim({ key: "topic" })]);
    const s = useTagsStore();
    await s.load();
    expect(s.list).toHaveLength(1);
    expect(s.dimensions).toHaveLength(1);
  });

  it("getters：启用维度过滤、按 key 索引、无维度标签归 topic 分组", async () => {
    const s = useTagsStore();
    s.dimensions = [
      dim({ key: "project", sort: 1 }),
      dim({ key: "topic", enabled: false }),
      dim({ key: "person", sort: 0 }),
    ];
    s.list = [
      tag({ id: 1, name: "pkm", dimension: "project" }),
      tag({ id: 2, name: "随便聊", dimension: "" }), // 老数据无维度 → topic
      tag({ id: 3, name: "张三", dimension: "person" }),
    ];
    expect(s.enabledDimensions.map((d) => d.key)).toEqual(["project", "person"], "只过滤停用，保持声明序");
    expect(s.dimByKey.get("project")?.name).toBe("project");
    expect(s.tagsByDimension.get("project")).toHaveLength(1);
    expect(s.tagsByDimension.get("topic")?.[0].name).toBe("随便聊", "无维度归 topic");
  });

  it("refToId：先精确维度命中，同名跨维度回落第一个同名", async () => {
    const s = useTagsStore();
    s.list = [tag({ id: 1, name: "重名", dimension: "project" }), tag({ id: 2, name: "重名", dimension: "topic" })];
    expect(s.refToId("重名", "project")).toBe(1);
    expect(s.refToId("重名", "topic")).toBe(2);
    expect(s.refToId("重名", "person")).toBe(1, "维度不匹配回落第一个同名");
    expect(s.refToId("没有", "project")).toBeUndefined();
  });
});
