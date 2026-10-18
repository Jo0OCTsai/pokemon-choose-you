/**
 * 插件主面板页（原 plugins.detail.section 自定义内容 U16 起家；该槽摘除后由主区
 * 全局面板（sidebar main 槽）承载）：SegmentNav 七段（任务四分段 + 收音机 + 日志 +
 * 背包独立分段）+ 任务详情抽屉 + SchemaBanner 只读传播 + pageOpen 推送锚点
 * （host→客户端，双击桌宠/chip 点击经宿主导航打开并定位）+ 背包未保存离开守卫
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
import { AdventureView, DexView, GrassView, RouteView } from "../tasks/views";
import { LogSegment } from "../tasks/SessionsView";
import { DisplayPrefsProvider, displayPrefsOf } from "../ui/displayPrefs";
import { HelperBanner } from "./HelperBanner";
import { PageHeader } from "./PageHeader";
import { SchemaBanner } from "./SchemaBanner";
import { SegmentNav } from "./SegmentNav";
import { useFillRemainingHeight } from "./useFillRemainingHeight";
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
  // 背包分区锚点（U30 HelperBanner「查看诊断」→ 背包·诊断分区；SettingsSegment 挂载取初值，
  // 常规入口不重置——诊断锚定后续进背包仍落诊断分区一次，分区选单一步可达无伤）
  const [settingsSection, setSettingsSection] = useState<"focus" | "diag">("focus");
  // 语言即时跟随（U21/U8）：显示分区语言控件随选随切，落库走保存
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);
  // 收音机/日志/背包段填充窗口剩余高度（段体顶缘实测 → --pcy-remaining；标题/七段选单/
  // 背包分区选单行固定，滚动收敛到段体内部——日志段过滤行/分页器常驻、列表区占满内滚）
  const segmentBodyRef = useRef<HTMLDivElement | null>(null);
  const fillBody = segment === "radio" || segment === "logs" || segment === "settings";
  useFillRemainingHeight(segmentBodyRef, fillBody);
  const refresh = useCallback(() => {
    onChanged?.();
  }, [onChanged]);

  // 分段切换即重拉快照：分段体按段卸载重挂、重挂从 data 重建，旧 data 里未刷新的
  // 实体状态（如已保存的 agent）不得带进重挂（初挂的首次拉取归 PanelRoot，此处只管切换）
  const prevSegment = useRef(segment);
  useEffect(() => {
    if (prevSegment.current !== segment) {
      prevSegment.current = segment;
      refresh();
    }
  }, [segment, refresh]);

  const requestSegment = useLeaveGuard(segment, settingsDirtyRef, setPendingLeave, setSegment);
  usePageOpenAnchor(client, requestSegment);

  const readonly = data.dbStatus?.mode === "ro";
  const pendingCount = countActionablePending(data.messages);
  const openTask = findTask(data.tasks, openTaskId);

  return (
    <I18nProvider locale={localeOverride ?? data.locale}>
      <DisplayPrefsProvider {...displayPrefsOf(data.config)}>
        <div className={styles.page}>
          {readonly && <SchemaBanner />}
          {/* HelperBanner 与 SchemaBanner 同族不叠抢：schema 拒绝优先在上（U30） */}
          <HelperBanner
            onOpenDiagnostics={() => {
              setSettingsSection("diag");
              requestSegment("settings");
            }}
          />
          <PageHeader pendingCount={pendingCount} data={data} />
          <SegmentNav
            active={segment}
            onChange={requestSegment}
            radioPending={data.health.pendingCount}
            radioFailures={data.health.consecutiveFailures}
          />
          <div
            ref={segmentBodyRef}
            className={fillBody ? `${styles.segmentBody} ${styles.segmentFill}` : styles.segmentBody}
          >
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
              settingsSection={settingsSection}
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
      </DisplayPrefsProvider>
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
  settingsSection,
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
  settingsSection: "focus" | "diag";
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
      return <LogSegment readonly={readonly} />;
    case "settings":
      return (
        <SettingsSegment
          data={data}
          onChanged={onChanged}
          leaveRequest={pendingLeave}
          onLeaveResolved={onLeaveResolved}
          onUnsavedChange={onUnsavedChange}
          onLocalePreview={onLocalePreview}
          initialSection={settingsSection}
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
