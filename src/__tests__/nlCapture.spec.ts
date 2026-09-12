import { describe, expect, it } from "vitest";
import { parseNlCapture, type NlCaptureContext } from "../nlCapture";

/** 2026-09-13（周日）10:00 作为解析基准 */
const NOW = new Date(2026, 8, 13, 10, 0);

const ctx = (over: Partial<NlCaptureContext> = {}): NlCaptureContext => ({
  categories: [
    { id: 1, name: "工作", enabled: true },
    { id: 2, name: "学习", enabled: true },
    { id: 3, name: "休整", enabled: false },
  ],
  tags: [{ id: 7, name: "重要" }],
  now: NOW,
  ...over,
});

describe("parseNlCapture 时间识别", () => {
  it("明天 5pm 交周报 #工作 → 明天 17:00 + 分类工作", () => {
    const r = parseNlCapture("明天 5pm 交周报 #工作", ctx());
    expect(r).not.toBeNull();
    expect(r!.title).toBe("交周报");
    expect(r!.dueAt).toBe("2026-09-14T17:00");
    expect(r!.categoryId).toBe(1);
    expect(r!.categoryName).toBe("工作");
  });

  it("后天上午10点半开评审会 → 10:30", () => {
    const r = parseNlCapture("后天上午10点半开评审会", ctx());
    expect(r!.dueAt).toBe("2026-09-15T10:30");
    expect(r!.title).toBe("开评审会");
  });

  it("晚上8点 打电话 → 今晚 20:00", () => {
    const r = parseNlCapture("晚上8点 打电话", ctx());
    expect(r!.dueAt).toBe("2026-09-13T20:00");
  });

  it("只有时间且今天已过 → 顺延明天", () => {
    const r = parseNlCapture("下午3点 提交周报", ctx({ now: new Date(2026, 8, 13, 16, 0) }));
    expect(r!.dueAt).toBe("2026-09-14T15:00");
  });

  it("9月15日 交房租 → 缺省 09:00", () => {
    const r = parseNlCapture("9月15日 交房租", ctx());
    expect(r!.dueAt).toBe("2026-09-15T09:00");
  });

  it("今年已过的月日 → 落明年", () => {
    const r = parseNlCapture("3月1日 报税", ctx());
    expect(r!.dueAt).toBe("2027-03-01T09:00");
  });

  it("周一（基准是周日）→ 明天；下周一 → 8 天后", () => {
    expect(parseNlCapture("周一 交周报", ctx())!.dueAt).toBe("2026-09-14T09:00");
    expect(parseNlCapture("下周一 交周报", ctx())!.dueAt).toBe("2026-09-21T09:00");
    expect(parseNlCapture("周五 交周报", ctx())!.dueAt).toBe("2026-09-18T09:00");
  });

  it("完整日期与 24 小时制", () => {
    expect(parseNlCapture("2026-12-01 14:30 年度总结", ctx())!.dueAt).toBe("2026-12-01T14:30");
    expect(parseNlCapture("14:30 开会", ctx())!.dueAt).toBe("2026-09-13T14:30");
    expect(parseNlCapture("10am 站会", ctx())!.dueAt).toBe("2026-09-13T10:00");
  });
});

describe("parseNlCapture 分类与标签", () => {
  it("#标签名 只认已有标签", () => {
    const r = parseNlCapture("#重要 复习第三章", ctx());
    expect(r!.tagIds).toEqual([7]);
    expect(r!.tagNames).toEqual(["重要"]);
    expect(r!.title).toBe("复习第三章");
    expect(r!.dueAt).toBeNull();
  });

  it("未知 # 名与停用分类留在标题里，不猜", () => {
    const r = parseNlCapture("#不存在的 复习第三章", ctx());
    expect(r).toBeNull();
    const r2 = parseNlCapture("明天 #休整 玩耍", ctx());
    expect(r2!.title).toBe("#休整 玩耍");
    expect(r2!.categoryId).toBeNull();
  });

  it("分类与标签可同时命中", () => {
    const r = parseNlCapture("周五 6pm 健身 #学习 #重要", ctx());
    expect(r!.title).toBe("健身");
    expect(r!.categoryId).toBe(2);
    expect(r!.tagIds).toEqual([7]);
    expect(r!.dueAt).toBe("2026-09-18T18:00");
  });
});

describe("parseNlCapture 防误识别（Todoist 教训）", () => {
  it("纯文本 / 裸数字 / 范围页码都不识别", () => {
    expect(parseNlCapture("交周报", ctx())).toBeNull();
    expect(parseNlCapture("周报2", ctx())).toBeNull();
    expect(parseNlCapture("读 3-5 页报告", ctx())).toBeNull();
    expect(parseNlCapture("", ctx())).toBeNull();
  });

  it("识别后标题为空 → 整体不识别", () => {
    expect(parseNlCapture("#工作", ctx())).toBeNull();
    expect(parseNlCapture("明天5pm", ctx())).toBeNull();
  });

  it("被抽走的原文片段进 matchedTexts（预览高亮用）", () => {
    const r = parseNlCapture("明天 5pm 交周报 #工作", ctx());
    expect(r!.matchedTexts).toContain("5pm");
    expect(r!.matchedTexts).toContain("明天");
    expect(r!.matchedTexts).toContain("#工作");
  });
});
