/**
 * 提示词覆盖编辑（4 处面板：查看/编辑覆盖/恢复默认两层确认 + hint 自隐 4s +
 * SETTING_MODIFIED_ELSEWHERE 冲突刷新；dispatch 只读示例项）——自持保存（实体 CRUD）。
 */
import { useEffect, useState } from "react";
import type { PromptSpecInfo } from "../../../host/domain/prompt-overrides";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { ConfirmDialog } from "../../ui/Modal";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 提示词覆盖编辑（4 处面板：查看/编辑覆盖/恢复默认两层确认 + hint 自隐 4s + 冲突提示刷新） */
export function PromptOverrideEditor({
  specs,
  onSpecChange,
}: {
  specs: PromptSpecInfo[];
  onSpecChange: (specs: PromptSpecInfo[]) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const editableSpecs = specs.filter((s) => s.editable);
  const dispatchSpec = specs.find((s) => !s.editable);

  useEffect(() => {
    if (hint === null) {
      return;
    }
    const timer = setTimeout(() => {
      setHint(null);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [hint]);

  function refreshSpec(key: string, next: PromptSpecInfo): void {
    onSpecChange(specs.map((s) => (s.storageKey === key ? next : s)));
  }

  async function save(spec: PromptSpecInfo): Promise<void> {
    const result = await client.promptOverride({
      key: spec.storageKey ?? "",
      value,
      expectedValue: spec.overrideText ?? undefined,
    });
    if (result.ok) {
      refreshSpec(spec.storageKey ?? "", result.data.spec);
      setEditing(false);
      setError(null);
      setHint(t("prompts.savedHint", { feature: t(`prompts.feature.${spec.id}`) }));
    } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
      // 冲突：刷新为最新版 + 中性提示（A24：确认后 force 重发；此处先刷新展示）
      const fresh = await client.promptGet({ key: spec.storageKey ?? "" });
      if (fresh.ok) {
        refreshSpec(spec.storageKey ?? "", fresh.data);
        setValue(fresh.data.overrideText ?? "");
      }
      setError(t("dsh.prompts.conflictRefreshed"));
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className={ui.card} data-testid="prompt-override-editor">
      <h4 className={styles.cardTitle}>{t("prompts.title")}</h4>
      <p className={styles.cardHint}>{t("prompts.sub")}</p>
      <div className={styles.entityList}>
        {editableSpecs.map((spec) => (
          <div key={spec.id} className={styles.promptPanel} data-testid="prompt-panel">
            <div className={styles.filterRow}>
              <b>{t(`prompts.feature.${spec.id}`)}</b>
              <span className={styles.promptBadge} data-source={spec.source}>
                {spec.source === "custom"
                  ? t("prompts.badgeCustom")
                  : spec.source === "default_warned"
                    ? t("prompts.badgeWarn")
                    : t("prompts.badgeDefault")}
              </span>
              <button
                type="button"
                className={ui.button}
                aria-expanded={openKey === spec.storageKey}
                onClick={() => {
                  setOpenKey(openKey === spec.storageKey ? null : (spec.storageKey ?? null));
                  setEditing(false);
                  setError(null);
                }}
              >
                {t("prompts.edit")}
              </button>
            </div>
            {openKey === spec.storageKey && (
              <>
                {editing ? (
                  <>
                    <textarea
                      className={styles.promptTextarea}
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      aria-label={t("prompts.editorAria", { feature: t(`prompts.feature.${spec.id}`) })}
                    />
                    <div className={styles.filterRow}>
                      <button type="button" className={ui.button} onClick={() => void save(spec)}>
                        {t("prompts.save")}
                      </button>
                      <button
                        type="button"
                        className={ui.button}
                        onClick={() => {
                          setEditing(false);
                          setValue(spec.overrideText ?? spec.defaultText);
                        }}
                      >
                        {t("prompts.cancel")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <pre className={styles.previewLine} style={{ whiteSpace: "pre-wrap" }}>
                      {spec.text}
                    </pre>
                    <div className={styles.filterRow}>
                      <button
                        type="button"
                        className={ui.button}
                        onClick={() => {
                          setValue(spec.overrideText ?? spec.defaultText);
                          setEditing(true);
                        }}
                      >
                        {t("prompts.edit")}
                      </button>
                      <button type="button" className={ui.button} onClick={() => setConfirmReset(true)}>
                        {t("prompts.restore")}
                      </button>
                    </div>
                  </>
                )}
                {error !== null && <span className={styles.saveFailHint}>{error}</span>}
              </>
            )}
          </div>
        ))}
        {dispatchSpec !== undefined && (
          <div className={styles.promptPanel}>
            <div className={styles.filterRow}>
              <b>{t("prompts.feature.dispatch")}</b>
              <span className={styles.promptBadge}>{t("prompts.badgeReadonly")}</span>
            </div>
            <p className={styles.cardHint}>{t("prompts.readonlyNote")}</p>
          </div>
        )}
      </div>
      {hint !== null && (
        <span className={styles.savedHint} role="status">
          {hint}
        </span>
      )}
      {confirmReset && openKey !== null && (
        <ConfirmDialog
          title={t("prompts.restore")}
          body={t("prompts.confirmText")}
          confirmLabel={t("prompts.confirmOk")}
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            const key = openKey;
            void client
              .promptReset({ key, expectedValue: specs.find((s) => s.storageKey === key)?.overrideText ?? undefined })
              .then((result) => {
                if (result.ok) {
                  refreshSpec(key, result.data);
                  setEditing(false);
                  setHint(t("prompts.restoredHint"));
                } else {
                  setError(result.error.message);
                }
              });
          }}
        />
      )}
    </div>
  );
}
