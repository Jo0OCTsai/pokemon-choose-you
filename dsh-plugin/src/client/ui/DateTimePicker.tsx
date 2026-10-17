/**
 * 日期时间选择器（桌面 DexDateTime 同构 + dsh 增量规则）：触发钮开弹层（月历 + 时/分
 * 下拉，部件见 DateTimePickerParts），零键入——原生 datetime-local 的键入面与浏览器
 * 语言弹层由此收编；分钟粒度半小时（存量奇值按半点吸附展示）；12/24 小时制、日期
 * 格式、语言（月份标题/星期/上下午标签与位序/操作钮）读共享设置与 i18n locale；空值
 * 打开即落默认当天 18:00（已过 18:00 → 明天 18:00），有值打开不动。清空 = 落空串并
 * 收起（值契约同旧输入）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n, useT } from "../i18n";
import {
  dateKey,
  draftPartsOf,
  fmtDisplayDateTime,
  formatValue,
  intlLocaleOf,
  parseDateTimeValue,
  shiftedMonth,
  snapMinute,
} from "./dateTime";
import { useDisplayPrefs } from "./displayPrefs";
import { fieldLabel, MonthGrid, TimeRow } from "./DateTimePickerParts";
import styles from "./ui.module.css";

export function DateTimePicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useI18n();
  const { dateFormat, timeFormat } = useDisplayPrefs();
  const intlLocale = intlLocaleOf(locale);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [viewYear, setViewYear] = useState(1970);
  const [viewMonth, setViewMonth] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // 弹层外点击收起（mousedown —— 触发钮自身开合走 onClick，不在此列）
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // 下方空间不足时翻到触发钮上方（编辑弹窗底部行贴近视口下缘的兜底）
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (trigger === null || pop === null) {
      return;
    }
    setAbove(window.innerHeight - trigger.getBoundingClientRect().bottom < pop.offsetHeight + 8);
  }, [open]);

  /** 打开弹层：空值（或残缺值）即时落默认 18 点档；有值不动 */
  function openPopup(): void {
    const base = value !== "" && parseDateTimeValue(value) !== null ? value : formatValue(draftPartsOf(value));
    if (base !== value) {
      onChange(base);
    }
    const parts = draftPartsOf(base);
    setViewYear(parts.year);
    setViewMonth(parts.month - 1);
    setAbove(false);
    setOpen(true);
  }

  /** 选日（保留草案时分——分钟按半点吸附落值） */
  function pickDay(day: number): void {
    const draft = draftPartsOf(value);
    onChange(
      formatValue({ year: viewYear, month: viewMonth + 1, day, hour: draft.hour, minute: snapMinute(draft.minute) }),
    );
  }

  /** 选时/分（保留草案日期） */
  function pickTime(hour: number, minute: number): void {
    const draft = draftPartsOf(value);
    onChange(formatValue({ year: draft.year, month: draft.month, day: draft.day, hour, minute }));
  }

  const draft = draftPartsOf(value);

  return (
    <div ref={rootRef} className={styles.dtRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.dtBtn}
        data-open={open}
        data-none={value === ""}
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPopup())}
      >
        <span className={styles.dtLabel}>
          🕐 {value === "" ? t("dt.none") : fmtDisplayDateTime(value, dateFormat, timeFormat, intlLocale)}
        </span>
        <span className={styles.dtArrow} aria-hidden="true">
          ▼
        </span>
      </button>
      {open && (
        <div ref={popRef} className={styles.dtPop} data-above={above} role="group" data-testid="dt-pop">
          <MonthGrid
            intlLocale={intlLocale}
            viewYear={viewYear}
            viewMonth={viewMonth}
            selKey={dateKey(draft.year, draft.month, draft.day)}
            todayKey={dateKey(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())}
            prevLabel={t("dsh.dt.prevMonth")}
            nextLabel={t("dsh.dt.nextMonth")}
            onShift={(delta) => {
              const next = shiftedMonth(viewYear, viewMonth, delta);
              setViewYear(next.year);
              setViewMonth(next.month0);
            }}
            onPickDay={pickDay}
          />
          <TimeRow
            draft={draft}
            is12={timeFormat === "12h"}
            intlLocale={intlLocale}
            nameHour={fieldLabel(ariaLabel, t("dsh.dt.hour"))}
            nameMinute={fieldLabel(ariaLabel, t("dsh.dt.minute"))}
            namePeriod={fieldLabel(ariaLabel, t("dsh.dt.period"))}
            clearLabel={t("dt.clear")}
            onPickTime={pickTime}
            onClear={() => {
              onChange("");
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
