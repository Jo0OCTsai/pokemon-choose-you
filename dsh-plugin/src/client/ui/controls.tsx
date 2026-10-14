/**
 * 表单原语：Toggle（开关，32px 命中区；整行形态——label 左、track 右，对齐主应用
 * SettingRow 与 Select 的 .row 布局）/ Select / TextInput / ScopeBadge（作用于
 * 主应用×，U20）/ StatusDot（状态点 + 文字状态，非颜色冗余 a11y 断言③）。
 */
import type { ReactNode } from "react";
import { useT } from "../i18n";
import styles from "./ui.module.css";

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  badge,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  badge?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.toggle}
      data-on={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleLabel}>
        {label}
        {badge !== undefined && <span className={styles.scopeBadge}>{badge}</span>}
      </span>
      <span className={styles.toggleTrack} aria-hidden="true">
        <span className={styles.toggleThumb} />
      </span>
    </button>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <label className={styles.row}>
      {label !== undefined && <span className={styles.rowLabel}>{label}</span>}
      <select
        className={styles.select}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <input
      className={styles.input}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 形态专属行为项标注（U20：共享值项不加 badge） */
export function ScopeBadge({
  kind,
  title,
}: {
  kind: "mainApp" | "notifications" | "pet" | "dispatch";
  title?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <span className={styles.scopeBadge} title={title ?? t(`dsh.badge.${kind}`)}>
      {t(`dsh.badge.${kind}`)}
    </span>
  );
}

/** 状态点 + 文字状态（a11y 断言③：健康状态非颜色冗余） */
export function StatusDot({ level, text }: { level: "ok" | "warn" | "fail"; text: string }): React.JSX.Element {
  return (
    <span className={styles.statusRow}>
      <span className={styles.statusDot} data-level={level} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

/** 表单行容器（label + 控件 + 可选 badge/说明行） */
export function FormRow({
  label,
  badge,
  desc,
  children,
}: {
  label: ReactNode;
  badge?: string;
  desc?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        {badge !== undefined && <span className={styles.scopeBadge}>{badge}</span>}
        {desc !== undefined && (
          <span className={styles.hint} style={{ display: "block" }}>
            {desc}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}
