/**
 * 部署表单弹窗（U23 · 新增/编辑双模式）：别名（OpenSSH 别名——凭据由别名承载，插件不存
 * 私钥）/ 远端 Node 路径 / 默认远端工作目录 / 备注。行内校验：别名不能为空 / Node 路径不能为
 * 空（保存禁用 + 行内红字）；`~` 前缀与重复别名由 host 校验回显（error.message 行内）。
 * 编辑保存成功后回落未就绪——提示重跑开通向导复核（§8「部署编辑回落」）。
 */
import { useState } from "react";
import type { DeploymentEntity } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Modal } from "../../ui/Modal";
import { TextInput } from "../../ui/controls";
import styles from "./deploy.module.css";

/** 表单初值（编辑预填实体字段；新增空态） */
function initialFields(entity: DeploymentEntity | undefined): {
  alias: string;
  nodePath: string;
  workdir: string;
  note: string;
} {
  return {
    alias: entity?.alias ?? "",
    nodePath: entity?.nodePath ?? "",
    workdir: entity?.workdir ?? "",
    note: entity?.note ?? "",
  };
}

/** 弹窗标题键（编辑/新增） */
function formTitleKey(entity: DeploymentEntity | undefined): string {
  return entity === undefined ? "dsh.deploy.form.addTitle" : "dsh.deploy.form.editTitle";
}

export function DeployFormModal({
  entity,
  readonly,
  onClose,
  onSaved,
}: {
  /** 缺省 = 新增模式；有值 = 编辑模式（预填实体字段） */
  entity?: DeploymentEntity;
  readonly: boolean;
  onClose: () => void;
  onSaved: (deployment: DeploymentEntity, created: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const editing = entity !== undefined;
  const initial = initialFields(entity);
  const [alias, setAlias] = useState(initial.alias);
  const [nodePath, setNodePath] = useState(initial.nodePath);
  const [workdir, setWorkdir] = useState(initial.workdir);
  const [note, setNote] = useState(initial.note);
  const [saving, setSaving] = useState(false);
  const [aliasError, setAliasError] = useState("");
  const [pathError, setPathError] = useState("");
  const [serverError, setServerError] = useState("");

  async function save(): Promise<void> {
    setAliasError("");
    setPathError("");
    setServerError("");
    if (alias.trim() === "") {
      setAliasError(t("dsh.deploy.form.aliasRequired"));
      return;
    }
    if (!editing && nodePath.trim() === "") {
      setPathError(t("dsh.deploy.form.pathRequired"));
      return;
    }
    setSaving(true);
    const result = await client.deploymentUpsert({
      id: entity?.id,
      alias: alias.trim(),
      nodePath: nodePath.trim(),
      workdir: workdir.trim(),
      note,
    });
    setSaving(false);
    if (result.ok) {
      onSaved(result.data.deployment, !editing);
      onClose();
    } else {
      setServerError(result.error.message);
    }
  }

  return (
    <Modal
      title={t(formTitleKey(entity))}
      ariaLabel={t(formTitleKey(entity))}
      actions={[
        { label: t("save2"), onChoose: () => void save(), variant: "primary", disabled: saving || readonly },
        { label: t("cancel"), onChoose: onClose },
      ]}
      onClose={onClose}
    >
      <div data-testid="deploy-form">
        <label className={styles.formRow}>
          <span className={styles.formLabel}>{t("dsh.deploy.form.alias")}</span>
          <TextInput value={alias} onChange={setAlias} ariaLabel={t("dsh.deploy.form.alias")} />
        </label>
        {aliasError !== "" && (
          <p className={styles.formError} role="alert">
            ❌ {aliasError}
          </p>
        )}
        <label className={styles.formRow}>
          <span className={styles.formLabel}>{t("dsh.deploy.form.nodePath")}</span>
          <TextInput
            value={nodePath}
            onChange={setNodePath}
            placeholder="/usr/local/bin/node"
            ariaLabel={t("dsh.deploy.form.nodePath")}
          />
        </label>
        {pathError !== "" && (
          <p className={styles.formError} role="alert">
            ❌ {pathError}
          </p>
        )}
        <label className={styles.formRow}>
          <span className={styles.formLabel}>{t("dsh.deploy.form.workdir")}</span>
          <TextInput
            value={workdir}
            onChange={setWorkdir}
            placeholder="/srv/work"
            ariaLabel={t("dsh.deploy.form.workdir")}
          />
        </label>
        <label className={styles.formRow}>
          <span className={styles.formLabel}>{t("dsh.deploy.form.note")}</span>
          <TextInput value={note} onChange={setNote} ariaLabel={t("dsh.deploy.form.note")} />
        </label>
        {serverError !== "" && (
          <p role="alert" data-testid="deploy-form-error">
            ❌ {serverError}
          </p>
        )}
      </div>
    </Modal>
  );
}
