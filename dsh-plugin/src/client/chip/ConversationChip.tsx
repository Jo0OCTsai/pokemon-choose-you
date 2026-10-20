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
  /** 计时秒数（dsh 形态 = 最近一次刷新时的快照值：helper 番茄相位在场取到期倒计时，
   *  否则自 startedAt 起算的已专注时长——面板不驱动计时，客户端无周期动作 invariant（NFR-6）） */
  secondsLeft,
  /** 进行中任务分类的宝可梦名（运行态前缀） */
  pokemonName,
  /** 打开插件页面（宿主导航回调；可选目标分段锚点） */
  onOpenPage,
  targetSection,
  /** 就近控制后的数据回刷（宿主层注入——⏸/✔/▶ 立即反映，不等轮询窗） */
  onMutate,
  /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：chip ⏸/✔ 置灰） */
  readonly = false,
}: {
  task: Task | null;
  mode: ChipMode;
  secondsLeft: number;
  pokemonName: string;
  onOpenPage?: (section?: PageSection) => void;
  targetSection?: PageSection;
  onMutate?: () => void;
  readonly?: boolean;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  // 无进行中任务零占位（NFR-6：chip 不渲染）
  if (task === null) {
    return null;
  }
  /** 动作统一收口：rpc 调用 + 回刷（失败也刷——让 UI 回到真实态） */
  const act = (fn: () => Promise<unknown>): void => {
    void fn().finally(() => onMutate?.());
  };
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
            onClick={() => act(() => client.taskResume({ taskId: task.id }))}
          />
          <IconBtn
            label={t("pet.trialStart")}
            glyph="🍦"
            disabled={readonly}
            onClick={() => act(() => client.pomoTryFive({ taskId: task.id }))}
          />
        </>
      ) : mode === "resting" ? (
        <IconBtn
          label={t("pet.menuResume")}
          glyph="▶"
          onClick={() => act(() => client.taskResume({ taskId: task.id }))}
        />
      ) : (
        <>
          <IconBtn
            label={t("entry.pause")}
            glyph="⏸"
            disabled={readonly}
            onClick={() => act(() => client.taskPause({ taskId: task.id }))}
          />
          <IconBtn
            label={t("pet.menuDone")}
            glyph="✔"
            disabled={readonly}
            onClick={() => act(() => client.taskComplete({ taskId: task.id }))}
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
