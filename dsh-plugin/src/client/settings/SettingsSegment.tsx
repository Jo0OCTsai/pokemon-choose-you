/**
 * 背包分段（「背包」独立分区，U17/U18/U21）：分区选单行（SectionNav 居左 + 保存控件
 * 靠右——无独立保存行，固定不随滚动）+ 分区整页 ×8（一次只显示一个、其余 hidden，装在
 * settingsBody 滚动容器内——填充形态下仅分区页内容滚动，切分区回顶）+ 保存制（36 共享
 * 键草稿编辑 → 保存控件统一 configWrite）+ 未保存离开确认（保存并离开/放弃修改/留下来
 * 在这里，离开请求由 PluginDetailPage 在切分段时发起）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../clientContext";
import { useT, type Locale } from "../i18n";
import { dirtySectionSet, type PanelData } from "../model";
import { normalizeSettingValues } from "./optionSets";
import { SectionNav } from "./SectionNav";
import { SaveControls } from "./SectionShell";
import { UnsavedLeaveDialog } from "./UnsavedLeaveDialog";
import {
  AGENT_KEYS,
  DRAFT_KEYS,
  FEISHU_KEYS,
  FOCUS_KEYS,
  GENERAL_KEYS,
  PET_KEYS,
  DISPLAY_KEYS,
  SECTION_KEYS,
  type SectionKey,
} from "./sectionKeys";
import { AgentSection } from "./sections/AgentSection";
import { CategoryTagSection } from "./sections/CategoryTagSection";
import { DiagnosticsSection } from "./sections/DiagnosticsSection";
import { DisplaySection } from "./sections/DisplaySection";
import { FeishuSection } from "./sections/FeishuSection";
import { FocusSection } from "./sections/FocusSection";
import { GeneralSection } from "./sections/GeneralSection";
import { PetSection } from "./sections/PetSection";
import styles from "./settings.module.css";

const SECTION_KEY_SETS: Record<SectionKey, readonly string[]> = {
  focus: FOCUS_KEYS,
  taxonomy: [],
  pets: PET_KEYS,
  display: DISPLAY_KEYS,
  agents: AGENT_KEYS,
  feishu: FEISHU_KEYS,
  diag: [],
  general: GENERAL_KEYS,
};

/** 行内防呆（原 FocusSection 分区页内逻辑上提）：勿扰起=止阻断保存（后端兜底 CONFIG_VALIDATION_FAILED） */
function sectionSaveBlocker(
  section: SectionKey,
  draft: Record<string, string>,
  t: ReturnType<typeof useT>,
): { saveBlocked?: boolean; blockedReason?: string } {
  const quietClash =
    section === "focus" &&
    draft["quiet_hours_enabled"] === "true" &&
    draft["quiet_start"] !== "" &&
    draft["quiet_start"] === draft["quiet_end"];
  if (!quietClash) {
    return {};
  }
  return { saveBlocked: true, blockedReason: t("dsh.settings.saveFailed", { reason: t("remind.quiet") }) };
}

export function SettingsSegment({
  data,
  onChanged,
  leaveRequest,
  onLeaveResolved,
  onUnsavedChange,
  onLocalePreview,
}: {
  data: PanelData;
  onChanged: () => void;
  /** 页面侧发起的离开请求（null = 无）；SettingsSegment 有未保存时弹确认，无未保存直接放行 */
  leaveRequest: string | null;
  onLeaveResolved: (proceed: boolean) => void;
  /** 未保存状态上报（页面侧离开守卫） */
  onUnsavedChange: (dirty: boolean) => void;
  onLocalePreview?: (locale: Locale) => void;
}): React.JSX.Element {
  const t = useT();
  const [section, setSection] = useState<SectionKey>("focus");
  // 真实库未落盘的设置键 configRead 回 undefined——draft/saved 统一归一空串
  // （设置值皆字符串形态；Toggle 的 ==="true" 与 textarea 的受控值都与 "" 兼容），
  // 否则 PetSection 的 quotes.split 等消费点在未设键上崩溃（真实宿主实测踩坑）；
  // 再过 normalizeSettingValues 把历史存量值吸附到与主应用一致的合法档位（选项值
  // 单源 optionSets——双形态共用存储，值域漂移会互相写坏）
  const initialConfig = useMemo(() => {
    const normalized: Record<string, string> = {};
    for (const key of DRAFT_KEYS) {
      normalized[key] = data.config[key] ?? "";
    }
    return normalizeSettingValues(normalized);
  }, [data.config]);
  const [draft, setDraft] = useState<Record<string, string>>(initialConfig);
  const [saved, setSaved] = useState<Record<string, string>>(initialConfig);
  // 分区页滚动容器（填充形态下唯一滚动位）；切分区回顶——新分区页从头部呈现
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [section]);

  const onField = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);
  const onSavedKeys = useCallback((keys: string[], values: Record<string, string>) => {
    setSaved((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        next[key] = values[key];
      }
      return next;
    });
  }, []);

  const dirtyKeys = useMemo(() => DRAFT_KEYS.filter((key) => draft[key] !== saved[key]), [draft, saved]);
  const anyDirty = dirtyKeys.length > 0;
  const dirtySections = useMemo(
    () => dirtySectionSet(draft, saved, SECTION_KEY_SETS) as Set<SectionKey>,
    [draft, saved],
  );

  useEffect(() => {
    onUnsavedChange(anyDirty);
  }, [anyDirty, onUnsavedChange]);

  const sectionProps = { draft, saved, onField, onSavedKeys };
  const taxonomy = { dimensions: data.dimensions ?? [], tags: data.tags ?? [] };
  const agents = data.agents ?? [];
  const promptSpecs = data.promptSpecs ?? [];
  const filters = data.filters ?? [];

  /** 分区整页装配（一次只显示一个，其余 hidden——U21 草稿跨分区存活） */
  function renderSection(key: SectionKey): React.JSX.Element | null {
    switch (key) {
      case "focus":
        return <FocusSection {...sectionProps} />;
      case "taxonomy":
        return (
          <CategoryTagSection
            categories={data.categories}
            dimensions={taxonomy.dimensions}
            tags={taxonomy.tags}
            routes={data.routes}
            pokemonSearch={data.pokemonSearch}
            onChanged={onChanged}
          />
        );
      case "pets":
        return <PetSection {...sectionProps} data={data} />;
      case "display":
        return <DisplaySection {...sectionProps} onLocalePreview={onLocalePreview} />;
      case "agents":
        return (
          <AgentSection
            {...sectionProps}
            agents={agents}
            routes={data.routes}
            tags={taxonomy.tags}
            promptSpecs={promptSpecs}
            onChanged={onChanged}
          />
        );
      case "feishu":
        return <FeishuSection {...sectionProps} filters={filters} lastPollAt={data.filterLastPollAt ?? null} />;
      case "diag":
        return <DiagnosticsSection />;
      case "general":
        return <GeneralSection {...sectionProps} />;
      default:
        return null;
    }
  }
  return (
    <div className={styles.settingsSegment} data-testid="segment-settings">
      {/* 分区选单行：选单居左 + 保存控件靠右（无独立保存行；仅含草稿键的分区出保存钮） */}
      <div className={styles.settingsHeadRow}>
        <SectionNav active={section} onChange={setSection} dirtySections={dirtySections} />
        {SECTION_KEY_SETS[section].length > 0 && (
          <SaveControls
            keys={SECTION_KEY_SETS[section]}
            draft={draft}
            saved={saved}
            onSavedKeys={onSavedKeys}
            {...sectionSaveBlocker(section, draft, t)}
          />
        )}
      </div>
      <div ref={bodyRef} className={styles.settingsBody}>
        {SECTION_KEYS.map((key) => (
          <div key={key} hidden={section !== key} data-section-wrap={key}>
            {renderSection(key)}
          </div>
        ))}
      </div>
      <LeaveGuardDialog
        leaveRequest={leaveRequest}
        anyDirty={anyDirty}
        draft={draft}
        dirtyKeys={dirtyKeys}
        onSavedKeys={onSavedKeys}
        onChanged={onChanged}
        onLeaveResolved={onLeaveResolved}
        onDiscard={() => setDraft(saved)}
      />
    </div>
  );
}

/** 未保存离开确认弹层（保存并离开 = saveAllDirty 先成功再放行；失败留在当前分区不丢草稿） */
function LeaveGuardDialog({
  leaveRequest,
  anyDirty,
  draft,
  dirtyKeys,
  onSavedKeys,
  onChanged,
  onLeaveResolved,
  onDiscard,
}: {
  leaveRequest: string | null;
  anyDirty: boolean;
  draft: Record<string, string>;
  dirtyKeys: readonly string[];
  onSavedKeys: (keys: string[], values: Record<string, string>) => void;
  onChanged: () => void;
  onLeaveResolved: (proceed: boolean) => void;
  onDiscard: () => void;
}): React.JSX.Element | null {
  const client = useClient();
  if (leaveRequest === null || !anyDirty) {
    return null;
  }
  async function saveAndLeave(): Promise<void> {
    if (dirtyKeys.length === 0) {
      onLeaveResolved(true);
      return;
    }
    const keyValues = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
    const result = await client.configWrite({ keyValues });
    if (result.ok) {
      onSavedKeys([...dirtyKeys], draft);
      onChanged();
      onLeaveResolved(true);
    }
    // 保存失败：留在当前分区页（不丢草稿可重试）
  }
  return (
    <UnsavedLeaveDialog
      onSaveLeave={() => void saveAndLeave()}
      onDiscard={() => {
        onDiscard();
        onLeaveResolved(true);
      }}
      onStay={() => {
        onLeaveResolved(false);
      }}
    />
  );
}
