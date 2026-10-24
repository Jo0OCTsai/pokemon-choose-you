/**
 * 通用分区页（⚙️）：复盘提醒（开关+星期）/备份（开关+保留份数+立即备份+列表+恢复升级【U25】）/
 * 待办库状态（dbStatus 即时查询，挂载即探测一次供只读判定）/
 * 数据导出（全量 JSON/任务 CSV/今日日报 +「导入 JSON」「打开导出目录」【U25】）
 * /使用指南链接。语言与显示偏好在显示分区页。关闭到托盘不在此呈现（dsh 无主窗口
 * 关闭行为——纯主应用项，dsh 背包不读写该键，值随主应用自管）。
 * 备份卡/导出卡拆件 = BackupCard.tsx / ExportCard.tsx（复杂度棘轮拆分，本文件消费）。
 */
import { useEffect, useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import type { DbStatus } from "../../rpc";
import { SectionShell } from "../SectionShell";
import { BackupCard } from "./BackupCard";
import { ExportCard } from "./ExportCard";
import styles from "../settings.module.css";

/** 使用指南文档（GitHub 主分支 · dsh 形态章节锚点；文档不入插件 bundle，点击在浏览器打开） */
const USER_GUIDE_URL =
  "https://github.com/Jo0OCTsai/pokemon-choose-you/blob/main/docs/USER_GUIDE.md#dsh-%E6%8F%92%E4%BB%B6%E5%BD%A2%E6%80%81%E7%AC%AC%E4%BA%8C%E5%BD%A2%E6%80%81";

export function GeneralSection(props: SectionProps & { onChanged?: () => void }): React.JSX.Element {
  const { draft, onField, onChanged } = props;
  /** 导入/恢复成功后的面板刷新（缺省 = 无操作——设置区测试可不注入） */
  const notifyChanged = onChanged ?? (() => undefined);
  const t = useT();
  const client = useClient();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  // 只读模式（库版本较新）：写动作按钮统一禁用（桌面无此态，dsh 按 §4.2 禁用清单口径）
  const readonly = dbStatus?.mode === "readonly";

  // 挂载即探测库状态（只读判定）
  useEffect(() => {
    void (async () => {
      const status = await client.dbStatus();
      if (status.ok) {
        setDbStatus(status.data);
      }
    })();
  }, [client]);

  return (
    <SectionShell>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("reviewCfg.title")}</h4>
        <Toggle
          label={t("reviewCfg.enable")}
          tip={t("reviewCfg.enableDesc")}
          checked={draft["review_enabled"] === "true"}
          onChange={(v) => onField("review_enabled", String(v))}
        />
        <Select
          label={t("reviewCfg.dow")}
          value={draft["review_dow"]}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: t(`reviewDow.${n}`) }))}
          onChange={(v) => onField("review_dow", v)}
        />
      </div>
      <BackupCard draft={draft} onField={onField} readonly={readonly} onChanged={notifyChanged} />
      <ExportCard readonly={readonly} onChanged={notifyChanged} />
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("dsh.settings.dbStatusTitle")}</h4>
        <div className={styles.filterRow}>
          <button
            type="button"
            className={ui.button}
            onClick={async () => {
              const result = await client.dbStatus();
              if (result.ok) {
                setDbStatus(result.data);
              }
            }}
          >
            {t("dsh.settings.dbStatusQuery")}
          </button>
          {dbStatus !== null && (
            <span className={ui.muted}>
              {t("dsh.settings.dbUserVersion", {
                v: dbStatus.userVersion,
                mode: dbStatus.mode === "readonly" ? t("dsh.settings.dbModeRo") : t("dsh.settings.dbModeRw"),
              })}
            </span>
          )}
        </div>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("dsh.settings.guideTitle")}</h4>
        <a
          className={styles.guideLink}
          href={USER_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="guide-link"
        >
          {t("dsh.settings.guideLink")}
        </a>
      </div>
    </SectionShell>
  );
}
