/**
 * 每周复盘向导（「训练家复盘」，对照主应用 ReviewWizard.vue）：总览 → 路线逐站复盘 →
 * 草丛批量归位 → 标签体检（词表治理）→ 收尾标记本周已复盘。状态全内存态（关闭即重置），
 * 入口在图鉴段筛选行（views.tsx DexView）；任务数据来自 PanelData 快照，动作后经
 * onChanged 触发面板重拉刷新。步骤视图见 ReviewWizardSteps / ReviewWizardTags，标签体检
 * 状态机见 useReviewTagCheckup（dsh 无 LLM 复核，judged 恒 false → 本地预筛脚注）。
 */
import { useEffect, useMemo, useState } from "react";
import { useClient } from "../clientContext";
import { useT, type TranslateFn } from "../i18n";
import type { PanelData } from "../model";
import { Modal, type ModalAction } from "../ui/Modal";
import { FinishStep, GrassStep, OverviewStep, RouteStep, StepsBar, type RouteActionKind } from "./ReviewWizardSteps";
import { TagsStep } from "./ReviewWizardTags";
import { useReviewTagCheckup } from "./useReviewTagCheckup";
import styles from "./tasks.module.css";

const STEPS = 5;
const WEEK_MS = 7 * 86_400_000;

/** completedAt 兼容 16 位无秒形态（桌面同款补 ":00"） */
function parseCompletedAt(iso: string): number {
  return Date.parse(iso.length === 16 ? `${iso}:00` : iso);
}

/** 底部主按钮：未收官 = 下一步（路线步有在审任务时变「跳过路线」）；收官 = 结束复盘 */
function footerActions(
  step: number,
  hasCurrent: boolean,
  busy: boolean,
  t: TranslateFn,
  onNext: () => void,
  onFinish: () => void,
  onClose: () => void,
): ModalAction[] {
  if (step < STEPS - 1) {
    return [
      {
        label: step === 1 && hasCurrent ? t("review.skipRoute") : t("review.next"),
        onChoose: onNext,
        variant: "primary",
        disabled: busy,
      },
      { label: t("cancel"), onChoose: onClose },
    ];
  }
  return [
    { label: t("review.finish"), onChoose: onFinish, variant: "primary" },
    { label: t("cancel"), onChoose: onClose },
  ];
}

export function ReviewWizard({
  data,
  onClose,
  onChanged,
}: {
  data: PanelData;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const openTasks = useMemo(
    () => data.tasks.filter((t0) => t0.status !== "done" && t0.status !== "cancelled"),
    [data.tasks],
  );

  // ---- Step 0 总览：本周捕捉（rolling 7 天）/ 专注分钟 / 路线上 / 草丛里 / 每分类条形 ----
  const weekDone = useMemo(
    () =>
      data.tasks.filter((t0) => {
        if (t0.status !== "done" || t0.completedAt === null) return false;
        const ms = parseCompletedAt(t0.completedAt);
        return Number.isFinite(ms) && Date.now() - ms < WEEK_MS;
      }),
    [data.tasks],
  );
  const weekFocusMin = Math.round(weekDone.reduce((sum, task) => sum + task.focusSeconds, 0) / 60);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of weekDone) {
      const name = data.categories.find((c) => c.id === task.categoryId)?.name ?? "?";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [weekDone, data.categories]);

  // ---- Step 1 路线复盘：逐张任务卡四动作（保留/完成/归草丛/逃走） ----
  const routeTasks = useMemo(
    () => openTasks.filter((t0) => t0.status === "scheduled" || t0.status === "active" || t0.status === "paused"),
    [openTasks],
  );
  const [routeIdx, setRouteIdx] = useState(0);
  const [routeDoneCount, setRouteDoneCount] = useState(0);
  const current = routeTasks[routeIdx] ?? null;
  // 处置后列表缩短：索引夹回末位，避免停在空位而列表还有待复盘项
  useEffect(() => {
    if (routeTasks.length > 0 && routeIdx >= routeTasks.length) {
      setRouteIdx(routeTasks.length - 1);
    }
  }, [routeTasks.length, routeIdx]);

  async function routeAction(action: RouteActionKind): Promise<void> {
    const task = current;
    if (task === null || busy) return;
    if (action === "keep") {
      setRouteIdx((i) => i + 1);
      return;
    }
    setBusy(true);
    try {
      // 失败信封不打断指针与计数（桌面 api 抛错即中止，此处等价跳过回读）
      if (action === "done") {
        const result = await client.taskUpdate({ id: task.id, status: "done" });
        if (!result.ok) return;
        setRouteDoneCount((n) => n + 1);
      } else if (action === "toGrass") {
        // 清掉截止时间 → 草丛不变量归位 inbox
        const result = await client.taskUpdate({ id: task.id, dueAt: null });
        if (!result.ok) return;
      } else {
        const result = await client.taskUpdate({ id: task.id, status: "cancelled" });
        if (!result.ok) return;
      }
      onChanged();
      // 列表来自快照：索引不动即指向下一条
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2 草丛归位：多选批量放生（逐只串行 taskDelete） ----
  const grassTasks = useMemo(() => openTasks.filter((t0) => t0.status === "inbox"), [openTasks]);
  const [grassSelected, setGrassSelected] = useState<Set<number>>(new Set());
  const grassAllSelected = grassTasks.length > 0 && grassTasks.every((t0) => grassSelected.has(t0.id));
  const [releasedCount, setReleasedCount] = useState(0);
  function toggleGrassAll(): void {
    setGrassSelected(grassAllSelected ? new Set() : new Set(grassTasks.map((t0) => t0.id)));
  }
  function toggleGrassOne(id: number): void {
    setGrassSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  async function releaseGrass(): Promise<void> {
    if (busy || grassSelected.size === 0) return;
    setBusy(true);
    try {
      for (const id of [...grassSelected]) {
        const result = await client.taskDelete({ taskId: id });
        if (!result.ok) break; // 失败即中止批量（桌面 api 抛错中断同构）
        setReleasedCount((n) => n + 1);
      }
      setGrassSelected(new Set());
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 3 标签体检：状态机见 useReviewTagCheckup ----
  const tags = useReviewTagCheckup(step === 3, data.tags ?? [], onChanged);

  // ---- Step 4 收尾 ----
  async function finish(): Promise<void> {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    await client.configWrite({ keyValues: { review_last_done: date } }).catch(() => {});
    onChanged();
    onClose();
  }

  function goNext(): void {
    setStep((s) => Math.min(s + 1, STEPS - 1));
  }
  const categoryNameOf = (id: number): string | undefined => data.categories.find((c) => c.id === id)?.name;
  const stepLabels = [
    t("review.stepOverview"),
    t("review.stepRoute"),
    t("review.stepGrass"),
    t("review.stepTags"),
    t("review.stepDone"),
  ];
  const bodies = [
    <OverviewStep
      key={0}
      caught={weekDone.length}
      focusMin={weekFocusMin}
      routeCount={routeTasks.length}
      grassCount={grassTasks.length}
      byCategory={byCategory}
      total={weekDone.length || 1}
    />,
    <RouteStep
      key={1}
      task={current}
      index={routeIdx}
      total={routeTasks.length}
      busy={busy}
      categoryName={current === null ? undefined : categoryNameOf(current.categoryId)}
      onAction={(action) => void routeAction(action)}
    />,
    <GrassStep
      key={2}
      tasks={grassTasks}
      selected={grassSelected}
      allSelected={grassAllSelected}
      releasedCount={releasedCount}
      busy={busy}
      onToggleAll={toggleGrassAll}
      onToggleOne={toggleGrassOne}
      onRelease={() => void releaseGrass()}
      categoryNameOf={categoryNameOf}
    />,
    <TagsStep
      key={3}
      checking={tags.checking}
      error={tags.error}
      checkup={tags.checkup}
      tagBusy={tags.tagBusy}
      dimensions={data.dimensions ?? []}
      onRetry={tags.runCheckup}
      onMerge={tags.mergeTagRow}
      onIgnoreMerge={tags.ignoreMerge}
      onReleaseZombie={tags.releaseZombie}
      onKeepZombie={tags.keepZombie}
      onAdopt={tags.adoptDimension}
      onIgnoreDimension={tags.ignoreDimension}
    />,
    <FinishStep key={4} n={weekDone.length + routeDoneCount} />,
  ];

  return (
    <Modal
      title={`🧢 ${t("review.title")}`}
      ariaLabel={t("review.title")}
      actions={footerActions(step, current !== null, busy, t, goNext, () => void finish(), onClose)}
      onClose={onClose}
    >
      <div className={styles.reviewBody} data-testid="review-wizard" data-step={step}>
        <StepsBar step={step} labels={stepLabels} />
        {bodies[step]}
      </div>
    </Modal>
  );
}
