/**
 * DateTimePicker 弹层内部件（月历/时间行）：纯呈现——值计算与落值经回调回根组件
 * （pickDay/pickTime 持 value 草案语义），拆出只为复杂度/行数棘轮的文件粒度。
 */
import {
  calendarCells,
  dateKey,
  dayPeriodOf,
  monthTitle,
  snapMinute,
  weekdayHeaders,
  type DateTimeParts,
} from "./dateTime";
import styles from "./ui.module.css";

/** 弹层选择控件的可及名带字段前缀（两处 picker 同弹窗时仍可分辨） */
export function fieldLabel(ariaLabel: string | undefined, fallback: string): string {
  return ariaLabel === undefined ? fallback : `${ariaLabel} ${fallback}`;
}

/** 月历（月份导航 + 周一开头格子；选日高亮 = 一等选中黄，今日 = 描边） */
export function MonthGrid({
  intlLocale,
  viewYear,
  viewMonth,
  selKey,
  todayKey,
  prevLabel,
  nextLabel,
  onShift,
  onPickDay,
}: {
  intlLocale: string;
  viewYear: number;
  viewMonth: number;
  selKey: string;
  todayKey: string;
  prevLabel: string;
  nextLabel: string;
  onShift: (delta: number) => void;
  onPickDay: (day: number) => void;
}): React.JSX.Element {
  return (
    <>
      <div className={styles.dtNav}>
        <button type="button" className={styles.dtNavBtn} aria-label={prevLabel} onClick={() => onShift(-1)}>
          ◀
        </button>
        <span className={styles.dtTitle}>{monthTitle(intlLocale, viewYear, viewMonth)}</span>
        <button type="button" className={styles.dtNavBtn} aria-label={nextLabel} onClick={() => onShift(1)}>
          ▶
        </button>
      </div>
      <div className={styles.dtGrid}>
        {weekdayHeaders(intlLocale).map((w, i) => (
          <span key={`w${i}`} className={styles.dtWeek}>
            {w}
          </span>
        ))}
        {calendarCells(viewYear, viewMonth).map((day, i) => {
          const key = dateKey(viewYear, viewMonth + 1, day);
          return day === 0 ? (
            <span key={`b${i}`} className={styles.dtBlank} />
          ) : (
            <button
              key={day}
              type="button"
              className={styles.dtDay}
              data-selected={key === selKey}
              data-today={key === todayKey}
              aria-pressed={key === selKey}
              onClick={() => onPickDay(day)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** 时间行（时 : 分 + 12h 的上下午位随语言插在时前/后 + 清空） */
export function TimeRow({
  draft,
  is12,
  intlLocale,
  nameHour,
  nameMinute,
  namePeriod,
  clearLabel,
  onPickTime,
  onClear,
}: {
  draft: DateTimeParts;
  is12: boolean;
  intlLocale: string;
  nameHour: string;
  nameMinute: string;
  namePeriod: string;
  clearLabel: string;
  onPickTime: (hour: number, minute: number) => void;
  onClear: () => void;
}): React.JSX.Element {
  const minute = snapMinute(draft.minute);
  const hour12 = draft.hour % 12 === 0 ? 12 : draft.hour % 12;
  const isPm = draft.hour >= 12;
  const period = dayPeriodOf(intlLocale);
  const hourOptions = (
    is12
      ? [...Array(12)].map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))
      : [...Array(24)].map((_, h) => ({ value: String(h).padStart(2, "0"), label: String(h).padStart(2, "0") }))
  ).map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
  const periodSelect = (
    <select
      className={styles.dtSelectPeriod}
      value={isPm ? "pm" : "am"}
      aria-label={namePeriod}
      onChange={(event) => onPickTime((event.target.value === "pm" ? 12 : 0) + (hour12 % 12), minute)}
    >
      <option value="am">{period.am}</option>
      <option value="pm">{period.pm}</option>
    </select>
  );
  return (
    <div className={styles.dtTime}>
      {is12 && period.first && periodSelect}
      <select
        className={styles.dtSelect}
        value={is12 ? String(hour12) : String(draft.hour).padStart(2, "0")}
        aria-label={nameHour}
        onChange={(event) =>
          onPickTime(is12 ? (isPm ? 12 : 0) + (Number(event.target.value) % 12) : Number(event.target.value), minute)
        }
      >
        {hourOptions}
      </select>
      <span className={styles.dtColon} aria-hidden="true">
        :
      </span>
      <select
        className={styles.dtSelect}
        value={String(minute).padStart(2, "0")}
        aria-label={nameMinute}
        onChange={(event) => onPickTime(draft.hour, Number(event.target.value))}
      >
        {["00", "30"].map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      {is12 && !period.first && periodSelect}
      <button type="button" className={styles.dtClear} onClick={onClear}>
        {clearLabel}
      </button>
    </div>
  );
}
