/**
 * 任务详情抽屉（桌面 TaskDetailDrawer 同构）：属性总览 kv 栅格（分类/优先级/状态/截止/
 * 提醒/标签/来源/专注/创建/完成——卡右上角「编辑」入口）+ 备注块（.summaryNote，桌面
 * .d-note 同构）+ 跟进记录（FollowupStream）+ Agent 派发（DispatchOps）+ Agent 执行
 * 时间线（DispatchTimeline）+ 操作历史段；总览后各段顶部虚线分隔（桌面 .notes 同构）；
 * focus trap + Esc 关闭 + 焦点回归。放生走卡片 ✕（桌面同位），抽屉不设危险区。
 * 跟进流与该任务的 agent 时间线经 taskDetail 懒载（实体读域按需命令）——拉回后以
 * overlay PanelData 下传，FollowupStream/DispatchTimeline 契约不变；旧 host 无此
 * 命令或加载中保持快照面（空跟进/全局账本过滤）。跟进写命令成功后重拉 taskDetail
 * （reload）回灌流。
 */
import { useEffect, useMemo, useState } from "react";
import type { Category } from "../../host/domain/vocabulary";
import type { Task, TaskLog } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { flattenKeys, MESSAGES, useI18n, useT } from "../i18n";
import type { PanelData } from "../model";
import type { AgentSessionEntry, HostClient, TaskDetail } from "../rpc";
import { useFocusTrap } from "../ui/useFocusTrap";
import ui from "../ui/ui.module.css";
import { DispatchOps } from "./DispatchOps";
import { DispatchTimeline } from "./DispatchTimeline";
import { FollowupStream } from "./FollowupStream";
import { TaskEditModal } from "./TaskEditModal";
import styles from "./tasks.module.css";

export function TaskDetailDrawer({
  task,
  data,
  categories,
  onClose,
  onChanged,
}: {
  task: Task;
  data: PanelData;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const client = useClient();
  const readonly = data.dbStatus?.mode === "ro";
  const ref = useFocusTrapTarget(onClose);
  const category = categories.find((c) => c.id === task.categoryId);
  const [detail, reloadDetail] = useTaskDetail(client, task.id);
  const logs = useTaskHistory(client, task.id);
  const [editing, setEditing] = useState(false);
  const overlay = useMemo<PanelData>(
    () => (detail === null ? data : overlayDetail(data, task.id, detail)),
    [data, detail, task.id],
  );
  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className={styles.drawer}
        data-testid="task-drawer"
        tabIndex={-1}
      >
        <header className={styles.drawerHeader}>
          <h3 className={styles.drawerTitle}>
            No.{task.id} {task.title}
          </h3>
          <button type="button" className={`${ui.button} ${styles.drawerClose}`} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className={styles.drawerBody}>
          <SummaryGrid
            task={task}
            categoryName={category?.name ?? "-"}
            readonly={readonly}
            onEdit={() => setEditing(true)}
          />
          {task.note !== null && task.note !== "" && (
            <p className={styles.summaryNote} data-testid="task-note">
              {task.note}
            </p>
          )}
          <FollowupStream data={overlay} taskId={task.id} onRefresh={reloadDetail} readonly={readonly} />
          <DispatchOps task={task} data={data} readonly={readonly} onChanged={onChanged} />
          <DispatchTimeline data={overlay} taskId={task.id} />
          <HistorySection logs={logs} />
          {/* 编辑弹层在抽屉容器内渲染（overlay z-index 低于抽屉面板） */}
          {editing && <TaskEditModal task={task} data={data} onClose={() => setEditing(false)} onChanged={onChanged} />}
        </div>
      </aside>
    </>
  );
}

/** 属性总览（桌面 .d-summary 同构：两列 kv——卡右上角「编辑」入口，打开 TaskEditModal） */
function SummaryGrid({
  task,
  categoryName,
  readonly,
  onEdit,
}: {
  task: Task;
  categoryName: string;
  readonly: boolean;
  onEdit: () => void;
}): React.JSX.Element {
  const t = useT();
  const fmt = (iso: string | null): string => (iso === null ? "—" : iso.slice(0, 16).replace("T", " "));
  const sourceText =
    task.source === "feishu" ? t("entry.feishu") : task.source === "capture" ? t("entry.capture") : task.source;
  return (
    <div className={styles.summarySection} data-testid="task-summary">
      {/* 编辑钮浮层贴卡右上角（不占布局行、不挤压 kv 栅格） */}
      <button type="button" className={`${ui.button} ${styles.summaryEdit}`} disabled={readonly} onClick={onEdit}>
        ✎ {t("detail.edit")}
      </button>
      <div className={styles.summaryGrid}>
        <Kv k={t("edit.category")} v={categoryName} />
        <Kv k={t("edit.priority")} v={t(`priority.${task.priority}`)} />
        <Kv k={t("detail.status")} v={t(`status.${task.status}`)} />
        <Kv k={t("edit.due")} v={fmt(task.dueAt)} />
        <Kv k={t("edit.remind")} v={fmt(task.remindAt)} />
        <Kv
          k={t("edit.tags")}
          v={
            task.tags.length === 0 ? (
              "—"
            ) : (
              <span className={styles.summaryTags}>
                {task.tags.map((ref) => (
                  <i
                    key={`${ref.dimension}:${ref.name}`}
                    className={styles.metaTagChip}
                    data-project={ref.dimension === "project"}
                  >
                    {ref.dimension === "project" ? "⛳ " : "# "}
                    {ref.name}
                  </i>
                ))}
              </span>
            )
          }
        />
        <Kv k={t("detail.source")} v={sourceText} />
        <Kv k={t("detail.focus")} v={`${Math.round(task.focusSeconds / 60)} min`} />
        <Kv k={t("detail.created")} v={fmt(task.createdAt)} mono />
        <Kv
          k={task.status === "cancelled" ? t("detail.escaped") : t("detail.completed")}
          v={fmt(task.completedAt ?? task.cancelledAt)}
          mono
        />
      </div>
    </div>
  );
}

function Kv({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className={styles.summaryKv}>
      <span className={styles.summaryKey}>{k}</span>
      <span className={mono ? styles.summaryValMono : styles.summaryVal}>{v}</span>
    </div>
  );
}

/** 操作历史段（对照桌面：时间 + 动作文案 + 字段旧→新；动作文案 log.* 键缺失回退原文） */
function HistorySection({ logs }: { logs: TaskLog[] }): React.JSX.Element {
  const t = useT();
  const { locale } = useI18n();
  // 键集一次展平（te() 等价件：缺键回退原值，不在运行时报红）
  const keys = useMemo(() => flattenKeys(MESSAGES[locale]), [locale]);
  const tx = (key: string, fallback: string): string => (keys.has(key) ? t(key) : fallback);
  /** 字段值展示：null/空串 → —；status 值走翻译 */
  const valueText = (field: string, value: string | null): string => {
    if (value === null || value === "") {
      return "—";
    }
    return field === "status" ? tx(`status.${value}`, value) : value;
  };
  return (
    <div className={styles.drawerSection} data-testid="task-history">
      <h4 className={styles.drawerSectionTitle}>{t("edit.history")}</h4>
      {logs.length === 0 ? (
        <div className={styles.followupEmpty}>{t("edit.noHistory")}</div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className={styles.historyRow}>
            <div className={styles.historyMeta}>
              <span className={styles.historyOrigin}>{log.origin}</span>
              <span>{log.createdAt.slice(0, 16).replace("T", " ")}</span>
            </div>
            <div className={styles.historyText}>
              {tx(`log.${log.action}`, log.action)}
              {log.field !== "" &&
                ` · ${log.field}: ${valueText(log.field, log.oldValue)} → ${valueText(log.field, log.newValue)}`}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** taskDetail 懒载（失败/旧 host 无命令 → null，保持快照面不阻塞抽屉；reload 供跟进写后回读） */
function useTaskDetail(client: HostClient, taskId: number): [TaskDetail | null, () => void] {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setDetail(null);
    let alive = true;
    void client.taskDetail({ taskId }).then((result) => {
      if (alive && result.ok) {
        setDetail(result.data);
      }
    });
    return () => {
      alive = false;
    };
  }, [client, taskId, nonce]);
  return [detail, () => setNonce((n) => n + 1)];
}

/** 操作历史懒载（进抽屉时 taskHistory 拉取一次；失败/旧 host → 空，不阻塞） */
function useTaskHistory(client: HostClient, taskId: number): TaskLog[] {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  useEffect(() => {
    let alive = true;
    void client.taskHistory({ taskId }).then((result) => {
      if (alive && result.ok) {
        setLogs(result.data.logs);
      }
    });
    return () => {
      alive = false;
    };
  }, [client, taskId]);
  return logs;
}

/** 快照面 + 任务详情 overlay（跟进灌入 followups；时间线按 id 去重并入 sessions） */
function overlayDetail(data: PanelData, taskId: number, detail: TaskDetail): PanelData {
  const seen = new Set<number>();
  const sessions: AgentSessionEntry[] = [];
  for (const session of [...detail.timeline, ...data.sessions]) {
    if (!seen.has(session.id)) {
      seen.add(session.id);
      sessions.push(session);
    }
  }
  return {
    ...data,
    followups: { ...data.followups, [taskId]: detail.followups },
    sessions,
  };
}

/** 抽屉容器 ref + focus trap（Esc = 关闭，焦点回归触发卡） */
function useFocusTrapTarget(onClose: () => void) {
  const [ref, setRef] = useState<HTMLElement | null>(null);
  useFocusTrap({ current: ref } as React.RefObject<HTMLElement | null>, true, onClose);
  return setRef;
}
