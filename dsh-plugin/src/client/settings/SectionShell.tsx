/**
 * 背包分区壳：SectionShell = 分区整页容器（保存按钮不在分区页内——与分区选单同行
 * 靠右，由 SettingsSegment 装配 SaveControls，桌面「标题行右侧保存」同位）；
 * SaveControls = 保存控件组（U21 保存制：「保存」按钮 + 未保存静态角标● title「有未
 * 保存的修改」——不闪烁 + 保存中禁用转「保存中…」+ 成功 hint「已保存」自隐 4s
 * （role=status 无 toast）+ 失败/防呆行内「保存失败：{原因}」草稿保留可重试）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import styles from "./settings.module.css";

export type SaveHint = { kind: "saved" } | { kind: "failed"; reason: string } | null;

export const SAVED_HINT_MS = 4000;

/** useSectionSave：单分区保存流（草稿由父级持有；此处只管保存态机与 hint 自隐） */
export function useSectionSave(): {
  saving: boolean;
  hint: SaveHint;
  save: (dirtyKeyValues: Record<string, string>, onSaved: () => void) => Promise<boolean>;
} {
  const client = useClient();
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<SaveHint>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hint?.kind === "saved") {
      timer.current = setTimeout(() => {
        setHint(null);
      }, SAVED_HINT_MS);
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [hint]);
  async function save(dirtyKeyValues: Record<string, string>, onSaved: () => void): Promise<boolean> {
    setSaving(true);
    const result = await client.configWrite({ keyValues: dirtyKeyValues });
    setSaving(false);
    if (result.ok) {
      onSaved();
      setHint({ kind: "saved" });
      return true;
    }
    setHint({ kind: "failed", reason: result.error.message });
    return false;
  }
  return { saving, hint, save };
}

/** 分区整页容器（纯壳：保存控件在分区选单行，见 SaveControls） */
export function SectionShell({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <section className={styles.sectionPage} data-testid="section-page">
      {children}
    </section>
  );
}

/** 保存控件组（分区选单行右位；display:contents 让 hint/按钮/失败行并入选单行排布） */
export function SaveControls({
  keys,
  draft,
  saved,
  onSavedKeys,
  saveBlocked = false,
  blockedReason,
}: {
  /** 本分区草稿键（dirty 计算 = 任一键离开已保存值） */
  keys: readonly string[];
  draft: Record<string, string>;
  saved: Record<string, string>;
  /** 保存成功回调（父级把这些键的 saved 基线推进为草稿值） */
  onSavedKeys: (keys: string[], values: Record<string, string>) => void;
  /** 行内防呆阻断（如勿扰起=止）：阻断保存不落库（后端兜底 CONFIG_VALIDATION_FAILED） */
  saveBlocked?: boolean;
  blockedReason?: string;
}): React.JSX.Element {
  const { saving, hint, save } = useSectionSave();
  const dirtyKeys = keys.filter((key) => draft[key] !== saved[key]);
  const dirty = dirtyKeys.length > 0;
  async function doSave(): Promise<void> {
    const dirtyKeyValues = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
    await save(dirtyKeyValues, () => {
      onSavedKeys(dirtyKeys, draft);
    });
  }
  return (
    <span className={styles.saveControls} data-testid="section-save-controls">
      <SaveStateHint hint={hint} />
      <SaveButton saving={saving} dirty={dirty} blocked={saveBlocked} onSave={() => void doSave()} />
      <span className={styles.saveFailWrap}>
        <SaveFailHint hint={hint} blockedReason={saveBlocked ? blockedReason : undefined} />
      </span>
    </span>
  );
}

/** 保存按钮（未保存静态角标● + title；保存中禁用转「保存中…」） */
function SaveButton({
  saving,
  dirty,
  blocked,
  onSave,
}: {
  saving: boolean;
  dirty: boolean;
  blocked: boolean;
  onSave: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <button
      type="button"
      className={styles.saveButton}
      disabled={saving || !dirty || blocked}
      title={dirty ? t("dsh.settings.unsavedTitle") : undefined}
      data-dirty={dirty ? "true" : undefined}
      data-testid="section-save"
      onClick={onSave}
    >
      {saving ? t("dsh.settings.saving") : t("save2")}
      {dirty && !saving && <span className={styles.unsavedDot} aria-hidden="true" data-testid="unsaved-dot" />}
    </button>
  );
}

/** 保存结果 hint（已保存 role=status 4s 自隐；失败/防呆阻断行内呈现保留草稿） */
function SaveStateHint({ hint }: { hint: SaveHint }): React.JSX.Element | null {
  const t = useT();
  if (hint?.kind !== "saved") {
    return null;
  }
  return (
    <span className={styles.savedHint} role="status">
      {t("dsh.settings.saved")}
    </span>
  );
}

/** 失败/阻断行内提示（不弹窗） */
function SaveFailHint({ hint, blockedReason }: { hint: SaveHint; blockedReason?: string }): React.JSX.Element | null {
  const t = useT();
  if (blockedReason !== undefined) {
    return (
      <p className={styles.saveFailHint} role="alert">
        {blockedReason}
      </p>
    );
  }
  if (hint?.kind === "failed") {
    return (
      <p className={styles.saveFailHint} role="status">
        {t("dsh.settings.saveFailed", { reason: hint.reason })}
      </p>
    );
  }
  return null;
}
