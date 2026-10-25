/**
 * 表单原语：Toggle（开关，32px 命中区；整行形态——label 左、track 右，对齐主应用
 * SettingRow 与 Select 的 .row 布局；compact 内联形态用于实体行）/ Select /
 * TextInput（className 供行内定宽）/ StatusDot（状态点 + 文字状态，非颜色冗余
 * a11y 断言③）/ FormRow（label + 控件行，labelWidth=标签列定宽对齐主应用
 * SettingRow label-width，wide=控件占满标签右侧整行）。
 * （原 ScopeBadge/作用域徽标机制已随消费方清零移除——U29 触达类翻案 + 关闭到托盘
 * 隐藏 + 终端偏好 dsh 自执行后无「作用于主应用」类标注。）
 */
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  compact = false,
  tip,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  /** 内联紧凑形态（实体行内：不占整行宽，紧随相邻控件） */
  compact?: boolean;
  /** 说明文案：悬浮标签气泡展示（与主应用 SettingRow desc 同语义） */
  tip?: string;
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
      <span className={styles.toggleLabel} data-tip={tip}>
        {label}
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
  tip,
  labelExtra,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** 追加类（实体行内定宽，如标签行维度下拉 92px） */
  className?: string;
  /** 说明文案：悬浮标签气泡展示（与主应用 SettingRow desc 同语义） */
  tip?: string;
  /** 标签右侧内联附加内容（如时间制式实时预览） */
  labelExtra?: ReactNode;
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
      {label !== undefined && (
        <span className={styles.rowLabel} data-tip={tip}>
          {label}
          {labelExtra !== undefined && <span className={styles.labelExtra}>{labelExtra}</span>}
        </span>
      )}
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

/** 裸下拉（表单行内形态——外层 label/布局由调用方给，如 DeployFormModal 的 formRow；
 * 选项 value 直传，不自带 label 行结构） */
export function SelectInput({
  value,
  onChange,
  options,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  ariaLabel?: string;
  /** 追加类（与 TextInput 同族的行内定宽/伸缩挂点） */
  className?: string;
}): React.JSX.Element {
  return (
    <select
      className={className !== undefined ? `${styles.select} ${className}` : styles.select}
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

/** 状态点 + 文字状态（a11y 断言③：健康状态非颜色冗余） */
export function StatusDot({ level, text }: { level: "ok" | "warn" | "fail"; text: string }): React.JSX.Element {
  return (
    <span className={styles.statusRow}>
      <span className={styles.statusDot} data-level={level} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

/** 表单行容器（label + 控件；labelWidth=标签列定宽 + 控件贴右缘，
 * wide=控件占满标签右侧整行——对齐主应用 SettingRow 的 label-width / wide 两档） */
export function FormRow({
  label,
  desc,
  labelWidth,
  wide = false,
  children,
}: {
  label: ReactNode;
  /** 说明文案：悬浮标签气泡展示 */
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
        data-tip={desc}
        style={
          labelWidth !== undefined
            ? { flex: `0 0 ${labelWidth}px`, paddingRight: 12, boxSizing: "border-box" }
            : undefined
        }
      >
        {label}
      </span>
      {children}
    </div>
  );
}
