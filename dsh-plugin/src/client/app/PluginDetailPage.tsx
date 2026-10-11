/**
 * 插件自有页面（plugins.detail.section 自定义内容，U16）：SegmentNav 七段（任务四分段 +
 * 收音机 + 日志 + 背包独立分段）+ 任务详情抽屉 + SchemaBanner 只读传播 + pageOpen 推送
 * 锚点（host→客户端，双击桌宠/chip 点击经宿主导航打开并定位）+ 背包未保存离开守卫
 * （U21：切分段时若背包有未保存草稿先弹确认）+ 语言即时跟随（locale preview）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientProvider, useClient } from "../clientContext";
import { I18nProvider, type Locale } from "../i18n";
import { suggestionGroups, type PanelData, type SegmentKey } from "../model";
import type { HostClient } from "../rpc";
import { RadioSegment } from "../radio/RadioSegment";
import { SettingsSegment } from "../settings/SettingsSegment";
import { TaskDetailDrawer } from "../tasks/TaskDetailDrawer";
import { AdventureView, DexView, GrassView, LogSegment, RouteView } from "../tasks/views";
import { PageHeader } from "./PageHeader";
import { SchemaBanner } from "./SchemaBanner";
import { SegmentNav } from "./SegmentNav";
import styles from "./app.module.css";

export function PluginDetailPage({
  client,
  data,
  initialSegment = "adventure",
  onChanged,
}: {
  client: HostClient;
  data: PanelData;
  initialSegment?: SegmentKey;
  /** 写命令成功后的数据刷新请求（适配层重拉快照） */
  onChanged?: () => void;
}): React.JSX.Element {
  return (
    <ClientProvider client={client}>
      <PluginDetailPageInner data={data} initialSegment={initialSegment} onChanged={onChanged} />
    </ClientProvider>
  );
}

function PluginDetailPageInner({
  data,
  initialSegment,
  onChanged,
}: {
  data: PanelData;
  initialSegment: SegmentKey;
  onChanged?: () => void;
}): React.JSX.Element {
  const client = useClient();
  const [segment, setSegment] = useState<SegmentKey>(initialSegment);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  // 背包离开守卫（U21）：dirty 上报 + 待离开目标
  const [pendingLeave, setPendingLeave] = useState<SegmentKey | null>(null);
  const settingsDirtyRef = useRef(false);
  // 语言即时跟随（U21/U8）：显示分区语言控件随选随切，落库走保存
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);
  const refresh = useCallback(() => {
    onChanged?.();
  }, [onChanged]);

  const requestSegment = useLeaveGuard(segment, settingsDirtyRef, setPendingLeave, setSegment);
  usePageOpenAnchor(client, requestSegment);

  const readonly = data.dbStatus?.mode === "ro";
  const pendingCount = countActionablePending(data.messages);
  const openTask = findTask(data.tasks, openTaskId);

  return (
    <I18nProvider locale={localeOverride ?? data.locale}>
      <div className={styles.page}>
        {readonly && <SchemaBanner />}
        <PageHeader pendingCount={pendingCount} />
        <SegmentNav
          active={segment}
          onChange={requestSegment}
          radioPending={data.health.pendingCount}
          radioFailures={data.health.consecutiveFailures}
        />
        <div className={styles.segmentBody}>
          <SegmentBody
            segment={segment}
            data={data}
            readonly={readonly}
            onOpen={setOpenTaskId}
            onChanged={refresh}
            pendingLeave={pendingLeave}
            onLeaveResolved={(proceed) =>
              resolveLeave(proceed, pendingLeave, settingsDirtyRef, setPendingLeave, setSegment)
            }
            onUnsavedChange={(dirty) => {
              settingsDirtyRef.current = dirty;
            }}
            onLocalePreview={setLocaleOverride}
          />
        </div>
        {openTask !== null && (
          <TaskDetailDrawer
            task={openTask}
            data={data}
            categories={data.categories}
            onClose={() => setOpenTaskId(null)}
            onChanged={refresh}
          />
        )}
      </div>
    </I18nProvider>
  );
}

/** 分段体渲染（七段互斥；背包分段带离开守卫与语言即时跟随装配） */
function SegmentBody({
  segment,
  data,
  readonly,
  onOpen,
  onChanged,
  pendingLeave,
  onLeaveResolved,
  onUnsavedChange,
  onLocalePreview,
}: {
  segment: SegmentKey;
  data: PanelData;
  readonly: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
  pendingLeave: SegmentKey | null;
  onLeaveResolved: (proceed: boolean) => void;
  onUnsavedChange: (dirty: boolean) => void;
  onLocalePreview: (locale: Locale) => void;
}): React.JSX.Element {
  const segmentProps = { data, readonly, onOpen, onChanged };
  switch (segment) {
    case "adventure":
      return <AdventureView {...segmentProps} />;
    case "grass":
      return <GrassView {...segmentProps} />;
    case "route":
      return <RouteView {...segmentProps} />;
    case "dex":
      return <DexView {...segmentProps} />;
    case "radio":
      return <RadioSegment data={data} readonly={readonly} onChanged={onChanged} />;
    case "logs":
      return <LogSegment data={data} />;
    case "settings":
      return (
        <SettingsSegment
          data={data}
          onChanged={onChanged}
          leaveRequest={pendingLeave}
          onLeaveResolved={onLeaveResolved}
          onUnsavedChange={onUnsavedChange}
          onLocalePreview={onLocalePreview}
        />
      );
  }
}

/** pageOpen 订阅（host→客户端推送锚定；requestSegment 经 ref 保鲜不重订阅） */
function usePageOpenAnchor(client: HostClient, requestSegment: (next: SegmentKey) => void): void {
  const requestRef = useRef(requestSegment);
  requestRef.current = requestSegment;
  useEffect(() => {
    return client.onPageOpen((event) => {
      requestRef.current(event.section === "settings" ? "settings" : "adventure");
    });
  }, [client]);
}

/** 背包未保存离开守卫（U21）：离开背包分段时若有未保存草稿先拦下（弹层由 SettingsSegment 呈现） */
function useLeaveGuard(
  segment: SegmentKey,
  dirtyRef: React.RefObject<boolean>,
  setPendingLeave: (next: SegmentKey) => void,
  setSegment: (next: SegmentKey) => void,
): (next: SegmentKey) => void {
  return useCallback(
    (next: SegmentKey) => {
      if (segment === "settings" && next !== "settings" && dirtyRef.current) {
        setPendingLeave(next);
        return;
      }
      setSegment(next);
    },
    [segment, dirtyRef, setPendingLeave, setSegment],
  );
}

/** 离开守卫裁决：proceed 且有目标 → 清 dirty 标记并切换；否则留在背包 */
function resolveLeave(
  proceed: boolean,
  pendingLeave: SegmentKey | null,
  dirtyRef: React.RefObject<boolean>,
  setPendingLeave: (next: SegmentKey | null) => void,
  setSegment: (next: SegmentKey) => void,
): void {
  const target = pendingLeave;
  setPendingLeave(null);
  if (proceed && target !== null) {
    dirtyRef.current = false;
    setSegment(target);
  }
}

/** 待处理计数（判定中/待判定不计入——分段导航被动信号口径） */
function countActionablePending(messages: PanelData["messages"]): number {
  const groups = suggestionGroups(messages);
  return groups.pending.filter((m) => m.aiStatus !== "judging" && m.aiStatus !== "pending").length;
}

/** 按 id 找任务（null → null；缺勤回 null） */
function findTask(tasks: PanelData["tasks"], id: number | null): PanelData["tasks"][number] | null {
  if (id === null) {
    return null;
  }
  return tasks.find((t) => t.id === id) ?? null;
}
