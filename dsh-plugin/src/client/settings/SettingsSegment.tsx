/**
 * 背包分段（「背包」独立分区，U17/U18/U21）：SectionNav 八分区选单（切换保留未保存
 * 草稿）+ 分区整页 ×8（一次只显示一个、其余 hidden）+ 保存制（36 共享键草稿编辑 →
 * 分区标题行「保存」统一 configWrite）+ 未保存离开确认（保存并离开/放弃修改/留在这里，
 * 离开请求由 PluginDetailPage 在切分段时发起）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClient } from "../clientContext";
import type { Locale } from "../i18n";
import { dirtySectionSet, type PanelData } from "../model";
import { SectionNav } from "./SectionNav";
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
  const [section, setSection] = useState<SectionKey>("focus");
  // 真实库未落盘的设置键 configRead 回 undefined——draft/saved 统一归一空串
  // （设置值皆字符串形态；Toggle 的 ==="true" 与 textarea 的受控值都与 "" 兼容），
  // 否则 PetSection 的 quotes.split 等消费点在未设键上崩溃（真实宿主实测踩坑）
  const initialConfig = useMemo(() => {
    const normalized: Record<string, string> = {};
    for (const key of DRAFT_KEYS) {
      normalized[key] = data.config[key] ?? "";
    }
    return normalized;
  }, [data.config]);
  const [draft, setDraft] = useState<Record<string, string>>(initialConfig);
  const [saved, setSaved] = useState<Record<string, string>>(initialConfig);

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
            pokemonSearch={data.pokemonSearch}
            onChanged={onChanged}
          />
        );
      case "pets":
        return <PetSection {...sectionProps} data={data} />;
      case "display":
        return <DisplaySection {...sectionProps} onLocalePreview={onLocalePreview} />;
      case "agents":
        return <AgentSection {...sectionProps} agents={agents} routes={data.routes} promptSpecs={promptSpecs} />;
      case "feishu":
        return <FeishuSection {...sectionProps} filters={filters} />;
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
      <SectionNav active={section} onChange={setSection} dirtySections={dirtySections} />
      {SECTION_KEYS.map((key) => (
        <div key={key} hidden={section !== key} data-section-wrap={key}>
          {renderSection(key)}
        </div>
      ))}
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
