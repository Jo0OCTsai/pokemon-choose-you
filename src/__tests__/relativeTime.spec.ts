import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { relativeDue } from "../relativeTime";
import { i18n } from "../i18n";

/** 基准时间：2026-09-13（周日）10:00 本地 */
const NOW = new Date(2026, 8, 13, 10, 0);

function dueIn(hours: number): string {
  const d = new Date(NOW.getTime() + hours * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

beforeEach(() => {
  setActivePinia(createPinia());
  i18n.global.locale.value = "zh-Hans";
});

describe("relativeDue 相对截止时间", () => {
  it("已逾期分档：分钟 / 小时 / 天", () => {
    expect(relativeDue(dueIn(-0.5), NOW)).toEqual({ text: "已逾期 30 分钟", level: "overdue" });
    expect(relativeDue(dueIn(-5), NOW)).toEqual({ text: "已逾期 5 小时", level: "overdue" });
    expect(relativeDue(dueIn(-72), NOW)).toEqual({ text: "已逾期 3 天", level: "overdue" });
  });

  it("临近分档：分钟级紧急、当天小时级", () => {
    expect(relativeDue(dueIn(0.5), NOW)).toEqual({ text: "30 分钟后", level: "urgent" });
    expect(relativeDue(dueIn(5), NOW)).toEqual({ text: "5 小时后", level: "hours" });
  });

  it("跨天：明天/后天带具体钟点", () => {
    expect(relativeDue("2026-09-14T15:00", NOW)).toEqual({ text: "明天 15:00", level: "hours" });
    // 后天 09:30（距基准 47.5 小时，仍在 3 天窗口内）
    expect(relativeDue("2026-09-15T09:30", NOW)).toEqual({ text: "后天 09:30", level: "hours" });
  });

  it("一周内显示星期，更远显示天数", () => {
    // 周五（2026-09-18）
    expect(relativeDue("2026-09-18T10:00", NOW)).toEqual({ text: "周五", level: "days" });
    expect(relativeDue("2026-09-25T10:00", NOW)).toEqual({ text: "12 天后", level: "far" });
  });

  it("非法输入安全退化", () => {
    expect(relativeDue("", NOW)).toEqual({ text: "", level: "far" });
    expect(relativeDue("not-a-date", NOW)).toEqual({ text: "", level: "far" });
  });
});
