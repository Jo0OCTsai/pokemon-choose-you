/**
 * conversation chip（conversation header 挂载）：进行中任务被动信号 + 就近控制。
 * 四态：无进行中（零占位——不渲染）/ 运行（捕获中 mm:ss ⏸✔）/ 暂停（已暂停 mm:ss
 * ▶🍦✔）/ 短休息（☕ 休息中 mm:ss ▶——不含 ✔）。点击 chip 主体打开插件页面
 * （host:pageOpen 语义——经宿主导航，可选目标分段；纯组件层经 onOpenPage 回调承载）。
 */
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PageSection } from "../rpc";
import styles from "./chip.module.css";

export type ChipMode = "running" | "paused" | "resting";

export function ConversationChip({
  task,
  mode,
  /** 倒计时剩余秒（各形态本地番茄，D2） */
  secondsLeft,
  /** 进行中任务分类的宝可梦名（运行态前缀） */
  pokemonName,
  /** 打开插件页面（宿主导航回调；可选目标分段锚点） */
  onOpenPage,
  targetSection,
  /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：chip ⏸/✔ 置灰） */
  readonly = false,
}: {
  task: Task | null;
  mode: ChipMode;
  secondsLeft: number;
  pokemonName: string;
  onOpenPage?: (section?: PageSection) => void;
  targetSection?: PageSection;
  readonly?: boolean;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  // 无进行中任务零占位（NFR-6：chip 不渲染）
  if (task === null) {
    return null;
  }
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const time = `${mm}:${ss}`;
  const label =
    mode === "resting"
      ? `☕ ${t("dsh.chip.resting")}`
      : mode === "paused"
        ? t("entry.paused")
        : `${pokemonName} ${t("entry.catching")}`;
  const open = (): void => onOpenPage?.(targetSection);
  return (
    <span className={styles.chip} data-mode={mode} data-testid="conversation-chip">
      <button
        type="button"
        className={styles.chipTitle}
        title={`${task.title} · ${t("dsh.chip.openPage")}`}
        onClick={open}
        aria-label={`${task.title} · ${t("dsh.chip.openPage")}`}
        data-testid="chip-open"
      >
        {label}
      </button>
      <span className={styles.chipTime}>{time}</span>
      {mode === "paused" ? (
        <>
          <IconBtn
            label={t("pet.menuResume")}
            glyph="▶"
            disabled={readonly}
            onClick={() => void client.taskResume({ taskId: task.id })}
          />
          <IconBtn
            label={t("pet.trialStart")}
            glyph="🍦"
            disabled={readonly}
            onClick={() => void client.pomoTryFive({ taskId: task.id })}
          />
        </>
      ) : mode === "resting" ? (
        <IconBtn label={t("pet.menuResume")} glyph="▶" onClick={() => void client.taskResume({ taskId: task.id })} />
      ) : (
        <>
          <IconBtn
            label={t("entry.pause")}
            glyph="⏸"
            disabled={readonly}
            onClick={() => void client.taskPause({ taskId: task.id })}
          />
          <IconBtn
            label={t("pet.menuDone")}
            glyph="✔"
            disabled={readonly}
            onClick={() => void client.taskComplete({ taskId: task.id })}
          />
        </>
      )}
      <IconBtn label={t("dsh.chip.openPage")} glyph="↗" onClick={open} />
    </span>
  );
}

function IconBtn({
  label,
  glyph,
  onClick,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.chipButton}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
}
