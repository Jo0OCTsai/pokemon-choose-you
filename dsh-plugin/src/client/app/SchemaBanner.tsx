/**
 * 库版本拒绝持久横幅（FR-X2 / §4.2 异常态）：DB_SCHEMA_TOO_NEW 只读模式——顶部持久
 * 横幅 +「只读模式」标记；只读标志向全部写操作面传播（禁用清单见各组件 disabled 取值）。
 */
import { useT } from "../i18n";
import styles from "./app.module.css";

export function SchemaBanner(): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.schemaBanner} role="status" data-testid="schema-banner">
      <span aria-hidden="true">⚠</span>
      <span>{t("dsh.schema.tooNew")}</span>
      <span className={styles.schemaReadonlyTag}>{t("dsh.schema.readonly")}</span>
    </div>
  );
}
