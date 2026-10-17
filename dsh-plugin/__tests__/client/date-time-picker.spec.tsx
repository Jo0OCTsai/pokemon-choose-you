/**
 * DateTimePicker（日期时间选择器）：零键入弹层选择（月历 + 时/分下拉）/ 分钟半小时
 * 粒度（存量奇值向下吸附展示）/ 12·24 小时制与日期格式、语言对齐（月份标题、星期、
 * 上下午标签与位序、操作钮）/ 空值打开默认当天 18:00（已过 18 点 → 明天 18:00，
 * 18:00 整点算当天）/ 清空落空串并收起。设置偏好经 DisplayPrefsProvider 注入。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { I18nProvider, type Locale } from "../../src/client/i18n";
import { DateTimePicker } from "../../src/client/ui/DateTimePicker";
import { DisplayPrefsProvider, type DisplayPrefs } from "../../src/client/ui/displayPrefs";
import { dateKey, defaultOpenValue, parseDateTimeValue } from "../../src/client/ui/dateTime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 受控夹具：value 经 onChange 回写（模拟表单受控用法） */
function Harness({
  initial = "",
  prefs = {},
  locale = "zh-Hans",
}: {
  initial?: string;
  prefs?: Partial<DisplayPrefs>;
  locale?: Locale;
}) {
  const [value, setValue] = useState(initial);
  return (
    <I18nProvider locale={locale}>
      <DisplayPrefsProvider dateFormat={prefs.dateFormat ?? "YYYY-MM-DD"} timeFormat={prefs.timeFormat ?? "24h"}>
        <DateTimePicker value={value} onChange={setValue} ariaLabel="截止" />
      </DisplayPrefsProvider>
    </I18nProvider>
  );
}

function trigger(): HTMLElement {
  return screen.getByLabelText("截止") as HTMLElement;
}

function pop(): HTMLElement {
  return screen.getByTestId("dt-pop");
}

function selectByLabel(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

describe("DateTimePicker 零键入弹层", () => {
  it("触发钮开弹层：无任何文本输入（原生 datetime-local 收编），选择全经控件", () => {
    render(<Harness initial="2026-10-12T18:30" />);
    expect(trigger().tagName).toBe("BUTTON");
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(trigger());
    expect(pop().querySelectorAll("input")).toHaveLength(0);
  });

  it("弹层外点击收起；触发钮再点开合（aria-expanded）", () => {
    render(<Harness initial="2026-10-12T18:30" />);
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("dt-pop")).toBeNull();
    fireEvent.click(trigger());
    expect(screen.getByTestId("dt-pop")).toBeTruthy();
  });
});

describe("DateTimePicker 半小时粒度", () => {
  it("分钟只有 00/30 两档；改 30 → 落值 T18:30", () => {
    render(<Harness initial="2026-10-12T18:00" />);
    fireEvent.click(trigger());
    const minute = selectByLabel("截止 分");
    expect([...minute.options].map((o) => o.value)).toEqual(["00", "30"]);
    fireEvent.change(minute, { target: { value: "30" } });
    expect(trigger().textContent).toContain("2026-10-12 18:30");
  });

  it("24h 制：小时 24 档（00..23）", () => {
    render(<Harness initial="2026-10-12T18:00" />);
    fireEvent.click(trigger());
    const hour = selectByLabel("截止 时");
    expect(hour.options).toHaveLength(24);
    expect(hour.options[0]?.value).toBe("00");
    expect(hour.options[23]?.value).toBe("23");
  });

  it("存量奇值 09:15：分档向下吸附展示 00、值不动；点选当日 → 落值 T09:00", () => {
    render(<Harness initial="2026-10-12T09:15" />);
    fireEvent.click(trigger());
    expect(trigger().textContent).toContain("2026-10-12 09:15");
    expect(selectByLabel("截止 分").value).toBe("00");
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    expect(trigger().textContent).toContain("2026-10-12 09:00");
  });
});

describe("DateTimePicker 空值默认 18 点", () => {
  it("空值打开 → 即落当天 18:00，弹层高亮今日、时 18 分 00", () => {
    render(<Harness initial="" />);
    expect(trigger().textContent).toContain("未设置");
    fireEvent.click(trigger());
    const expected = defaultOpenValue();
    expect(trigger().textContent).toContain(expected.replaceAll("T", " "));
    expect(selectByLabel("截止 时").value).toBe("18");
    expect(selectByLabel("截止 分").value).toBe("00");
    const today = new Date();
    const dayBtn = screen.getByRole("button", { name: String(today.getDate()) });
    expect(dayBtn.getAttribute("data-selected")).toBe("true");
    expect(dayBtn.getAttribute("data-today")).toBe("true");
  });

  it("已过 18:00 → 默认落明天 18:00；18:00 整点仍算当天", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 19, 30));
    render(<Harness initial="" />);
    fireEvent.click(trigger());
    expect(trigger().textContent).toContain("2026-10-18 18:00");
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 17, 18, 0));
    render(<Harness initial="" />);
    fireEvent.click(trigger());
    expect(trigger().textContent).toContain("2026-10-17 18:00");
  });

  it("有值打开不改动（无默认落值）", () => {
    render(<Harness initial="2026-10-12T08:00" />);
    fireEvent.click(trigger());
    expect(trigger().textContent).toContain("2026-10-12 08:00");
  });
});

describe("DateTimePicker 配置对齐（12/24h · 日期格式 · 语言）", () => {
  it("12h 制（zh）：上下午下拉位序在时之前，标签 上午/下午；下午 6:30 → T18:30", () => {
    render(<Harness initial="2026-10-12T18:30" prefs={{ timeFormat: "12h" }} />);
    expect(trigger().textContent).toContain("下午6:30");
    fireEvent.click(trigger());
    const selects = [...pop().querySelectorAll("select")];
    expect(selects[0]?.getAttribute("aria-label")).toBe("截止 上下午");
    expect(selectByLabel("截止 上下午").value).toBe("pm");
    const hour = selectByLabel("截止 时");
    expect([...hour.options].map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(hour.value).toBe("6");
    fireEvent.change(selectByLabel("截止 上下午"), { target: { value: "am" } });
    expect(trigger().textContent).toContain("上午6:30");
  });

  it("12h 制（en）：触发钮 6:30 PM 位序在后，标签 AM/PM", () => {
    render(<Harness initial="2026-10-12T18:30" prefs={{ timeFormat: "12h" }} locale="en" />);
    expect(trigger().textContent).toContain("6:30 PM");
    fireEvent.click(trigger());
    const periodSelect = selectByLabel("截止 AM/PM");
    expect(periodSelect.value).toBe("pm");
    expect(periodSelect.options[periodSelect.selectedIndex]?.textContent).toBe("PM");
    const selects = [...pop().querySelectorAll("select")];
    expect(selects[selects.length - 1]?.getAttribute("aria-label")).toBe("截止 AM/PM");
  });

  it("日期格式档位：MM/DD/YYYY 与 DD/MM/YYYY（时间保持 24h HH:mm）", () => {
    render(<Harness initial="2026-10-12T09:00" prefs={{ dateFormat: "MM/DD/YYYY" }} />);
    expect(trigger().textContent).toContain("10/12/2026 09:00");
    cleanup();
    render(<Harness initial="2026-10-12T09:00" prefs={{ dateFormat: "DD/MM/YYYY" }} />);
    expect(trigger().textContent).toContain("12/10/2026 09:00");
  });

  it("语言随 i18n locale：月份标题与星期头（zh 一/日 vs en Mo 式窄标）", () => {
    render(<Harness initial="2026-10-12T09:00" />);
    fireEvent.click(trigger());
    expect(screen.getByText(/^2026年10月$/)).toBeTruthy();
    cleanup();
    render(<Harness initial="2026-10-12T09:00" locale="en" />);
    fireEvent.click(trigger());
    expect(screen.getByText(/^October 2026$/)).toBeTruthy();
  });

  it("操作钮随语言：en 清空钮为 Clear", () => {
    render(<Harness initial="2026-10-12T09:00" locale="en" />);
    fireEvent.click(trigger());
    expect(screen.getByText("Clear")).toBeTruthy();
  });
});

describe("DateTimePicker 日历选择", () => {
  it("翻下月选日：保留当前时分，落值 = 下月 1 日（跨大月 31 日滚动安全）", () => {
    render(<Harness initial="" />);
    fireEvent.click(trigger());
    const base = parseDateTimeValue(defaultOpenValue());
    if (base === null) {
      throw new Error("defaultOpenValue 解析失败");
    }
    const firstOfNext = new Date(base.year, base.month, 1);
    fireEvent.click(screen.getByLabelText("下月"));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const expected = `${dateKey(firstOfNext.getFullYear(), firstOfNext.getMonth() + 1, 1)}T18:00`;
    expect(trigger().textContent).toContain(expected.replaceAll("T", " "));
  });

  it("清空 → 落空串并收起弹层", () => {
    render(<Harness initial="2026-10-12T09:00" />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("清空"));
    expect(trigger().textContent).toContain("未设置");
    expect(screen.queryByTestId("dt-pop")).toBeNull();
  });
});
