/**
 * 标签体检 LLM 复核纯函数半边（domain/tag-health-verdict，行为基准 = src-tauri
 * tag_health.rs judge_with_agent / parse_verdict / same_pair）：prompt 逐字格式 /
 * verdict 宽容解析 / 防幻觉过滤与方向采纳 / 新维度门槛。
 */
import { describe, expect, it } from "vitest";
import {
  applyTagHealthVerdict,
  buildTagHealthPrompt,
  parseTagHealthVerdict,
} from "../src/host/domain/tag-health-verdict";
import { TAG_HEALTH_SYSTEM_PROMPT } from "../src/host/domain/prompts";
import type { MergeCandidate } from "../src/host/domain/tag-health";
import type { Tag } from "../src/host/domain/vocabulary-tags";

const tag = (id: number, name: string, dimension: string, usage: number): Tag => ({
  id,
  name,
  description: "",
  meta: null,
  dimension,
  origin: "manual",
  createdAt: "2026-01-01T00:00:00Z",
  usage,
});

const candidate = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  fromId: 2,
  fromName: "工作周报",
  intoId: 1,
  intoName: "周报",
  dimension: "topic",
  similarity: 0.9,
  judged: false,
  reason: null,
  ...over,
});

/** applyTagHealthVerdict 两段用例共享：四标签词表 + 单候选对报告 */
const verdictTags = [
  tag(1, "周报", "topic", 3),
  tag(2, "工作周报", "topic", 0),
  tag(3, "月报", "topic", 1),
  tag(4, "家", "place", 1),
];
const verdictReport = { merges: [candidate()], zombies: [], newDimensions: [], judged: false };

describe("buildTagHealthPrompt（judge_with_agent prompt 逐字格式）", () => {
  it("系统词 + 按维度分组词表（分组间无换行——原样）+ 候选对编号清单", () => {
    const tags = [tag(1, "周报", "topic", 3), tag(2, "工作周报", "topic", 0), tag(3, "家", "place", 1)];
    const prompt = buildTagHealthPrompt("SYS\n词表：\n", tags, [candidate()]);
    expect(prompt).toBe(
      "SYS\n词表：\n- 维度 topic：周报（3 次）、工作周报（0 次）- 维度 place：家（1 次）\n\n候选对：\n" +
        "1. 「工作周报」vs「周报」（相似度 0.90，维度 topic）\n",
    );
  });

  it("无候选对不追加候选段；默认系统词尾部自带「词表：」框架", () => {
    const prompt = buildTagHealthPrompt(TAG_HEALTH_SYSTEM_PROMPT, [tag(1, "周报", "topic", 3)], []);
    expect(prompt.endsWith("词表：\n- 维度 topic：周报（3 次）")).toBe(true);
    expect(prompt).not.toContain("\n\n候选对：\n");
  });
});

describe("parseTagHealthVerdict（parse_verdict 宽容解析）", () => {
  it("剥 ```json 围栏 + 截首尾花括号 + 字段缺省", () => {
    const out = '前言 ```json\n{"merges":[{"from":"a","into":"b","merge":true}],"extra":1}\n``` 后记';
    expect(parseTagHealthVerdict(out)).toEqual({
      merges: [{ from: "a", into: "b", merge: true, reason: null }],
      newDimensions: [],
    });
    expect(parseTagHealthVerdict("{}")).toEqual({ merges: [], newDimensions: [] });
    expect(
      parseTagHealthVerdict('{"merges":[{"merge":"yes"}],"newDimensions":[{"name":"精力","tags":["a",1]}]}'),
    ).toEqual({
      merges: [{ from: "", into: "", merge: false, reason: null }],
      newDimensions: [{ name: "精力", tags: ["a"], reason: null }],
    });
  });

  it("非 JSON / 无花括号 → 抛错（调用方回落本地预筛）", () => {
    expect(() => parseTagHealthVerdict("我觉得都该合并")).toThrow(/不是合法 JSON/);
    expect(() => parseTagHealthVerdict("{broken")).toThrow(/不是合法 JSON/);
  });
});

describe("applyTagHealthVerdict（防幻觉过滤 + 方向采纳）", () => {
  it("只留 merge=true 且对得上候选对的；LLM 方向（into 在词表）覆盖预筛方向；理由回落预筛", () => {
    const flipped = applyTagHealthVerdict(
      verdictReport,
      { merges: [{ from: "周报", into: "工作周报", merge: true, reason: "统一叫法" }], newDimensions: [] },
      verdictTags,
    );
    expect(flipped.judged).toBe(true);
    expect(flipped.merges).toEqual([
      {
        ...candidate(),
        fromId: 1,
        fromName: "周报",
        intoId: 2,
        intoName: "工作周报",
        judged: true,
        reason: "统一叫法",
      },
    ]);
    const denied = applyTagHealthVerdict(
      verdictReport,
      {
        merges: [
          { from: "工作周报", into: "周报", merge: false, reason: "含义不同" },
          { from: "月报", into: "周报", merge: true, reason: "幻觉对" },
        ],
        newDimensions: [],
      },
      verdictTags,
    );
    expect(denied.merges).toEqual([]);
  });

  it("into 对不上候选对（same_pair 不命中）不采纳；同向沿用预筛方向与理由", () => {
    const unknownInto = applyTagHealthVerdict(
      verdictReport,
      { merges: [{ from: "工作周报", into: "不存在", merge: true, reason: null }], newDimensions: [] },
      verdictTags,
    );
    expect(unknownInto.merges).toEqual([]);
    const sameDir = applyTagHealthVerdict(
      verdictReport,
      { merges: [{ from: "工作周报", into: "周报", merge: true, reason: null }], newDimensions: [] },
      verdictTags,
    );
    expect(sameDir.merges[0]).toMatchObject({ fromId: 2, intoId: 1, judged: true, reason: null });
  });
});

describe("applyTagHealthVerdict（新维度门槛）", () => {
  it("新维度：名 ≥2 字 + 归入标签 ≥2 且都在词表（幻觉名剔除）；最多 2 条；僵尸段原样透传", () => {
    const zombies = [{ id: 9, name: "z", dimension: "topic", origin: "ai", createdAt: "2025-01-01T00:00:00Z" }];
    const out = applyTagHealthVerdict(
      { ...verdictReport, zombies },
      {
        merges: [],
        newDimensions: [
          { name: "周期", tags: ["周报", "月报", "幻觉"], reason: "按周期分" },
          { name: "x", tags: ["周报", "月报"], reason: null },
          { name: "场所", tags: ["家", "幻觉"], reason: null },
          { name: "第三", tags: ["周报", "家"], reason: null },
          { name: "第四", tags: ["周报", "家"], reason: null },
        ],
      },
      verdictTags,
    );
    expect(out.newDimensions).toEqual([{ name: "周期", tags: ["周报", "月报"], reason: "按周期分" }]);
    expect(out.zombies).toBe(zombies);
    expect(out.judged).toBe(true);
  });
});
