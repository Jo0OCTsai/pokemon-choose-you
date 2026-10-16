/**
 * 表单原语：Toggle（开关，32px 命中区；整行形态——label 左、track 右，对齐主应用
 * SettingRow 与 Select 的 .row 布局；compact 内联形态用于实体行）/ Select /
 * TextInput（className 供行内定宽）/ ScopeBadge（作用于主应用×，U20）/
 * StatusDot（状态点 + 文字状态，非颜色冗余 a11y 断言③）/ FormRow（label + 控件行，
 * labelWidth=标签列定宽对齐主应用 SettingRow label-width，wide=控件占满标签右侧整行）。
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
  compact = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  badge?: string;
  /** 内联紧凑形态（实体行内：不占整行宽，紧随相邻控件） */
  compact?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.toggle}
      data-on={checked}
      data-compact={compact ? "true" : undefined}
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
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** 追加类（实体行内定宽，如标签行维度下拉 92px） */
  className?: string;
}): React.JSX.Element {
  const selectClass =
    className !== undefined
      ? `${styles.select} ${className}`
      : // 带 label 的设置行下拉（单独靠右档）：定宽 250
        label !== undefined
        ? `${styles.select} ${styles.labelSelect}`
        : styles.select;
  return (
    <label className={styles.row}>
      {label !== undefined && <span className={styles.rowLabel}>{label}</span>}
      <select
        className={selectClass}
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
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** 追加类（实体行内定宽/伸缩，如名称 110px、描述 flex:1） */
  className?: string;
}): React.JSX.Element {
  return (
    <input
      className={className !== undefined ? `${styles.input} ${className}` : styles.input}
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

/** 表单行容器（label + 控件 + 可选 badge/说明行；labelWidth=标签列定宽 + 控件贴右缘，
 * wide=控件占满标签右侧整行——对齐主应用 SettingRow 的 label-width / wide 两档） */
export function FormRow({
  label,
  badge,
  desc,
  labelWidth,
  wide = false,
  children,
}: {
  label: ReactNode;
  badge?: string;
  desc?: string;
  /** 标签列定宽像素（如 agent 卡 128：与首行名称 120+间隙 8 同轴，命令框左缘对齐下方输入列） */
  labelWidth?: number;
  /** 控件占满标签右侧整行（附加参数/工作目录这类长文本输入） */
  wide?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={styles.row}
      data-wide={wide ? "true" : undefined}
      data-right={labelWidth !== undefined && !wide ? "true" : undefined}
      style={labelWidth !== undefined ? { gap: 0 } : undefined}
    >
      <span
        className={styles.rowLabel}
        style={
          labelWidth !== undefined
            ? { flex: `0 0 ${labelWidth}px`, paddingRight: 12, boxSizing: "border-box" }
            : undefined
        }
      >
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
