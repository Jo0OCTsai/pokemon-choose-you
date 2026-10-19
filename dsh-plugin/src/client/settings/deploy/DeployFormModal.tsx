/**
 * 部署表单弹窗（U23 · 新增/编辑双模式）：别名（OpenSSH 别名下拉——数据源 sshAliasList
 * 读本机 ~/.ssh/config，凭据由别名承载，插件不存私钥；编辑态当前别名不在列表时保留
 * 可选——config 漂移不吞既有值）/ 远端 Node 路径 / 默认远端工作目录 / 备注。行内校验：
 * 别名不能为空 / Node 路径不能为空（保存禁用 + 行内红字）；`~` 前缀与重复别名由 host
 * 校验回显（error.message 行内）。编辑保存成功后回落未就绪——提示重跑开通向导复核
 * （§8「部署编辑回落」）。
 */
import { useEffect, useState } from "react";
import type { DeploymentEntity } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Modal } from "../../ui/Modal";
import { SelectInput, TextInput } from "../../ui/controls";
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

/** 下拉选项组装：空态提示 / 占位 / 编辑态当前别名保留（config 漂移不吞既有值）/ config 别名 */
function buildAliasOptions(args: {
  aliasList: string[];
  loaded: boolean;
  preserveCurrent: boolean;
  currentAlias: string;
  alias: string;
  emptyLabel: string;
  placeholderLabel: string;
}): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  if (args.loaded && args.aliasList.length === 0 && !args.preserveCurrent) {
    options.push({ value: "", label: args.emptyLabel });
    return options;
  }
  if (args.alias === "") {
    options.push({ value: "", label: args.placeholderLabel });
  }
  if (args.preserveCurrent) {
    options.push({ value: args.currentAlias, label: args.currentAlias });
  }
  for (const name of args.aliasList) {
    options.push({ value: name, label: name });
  }
  return options;
}

/** 行内校验（返回首个错误的 i18n 键尾段；null = 通过——Node 路径仅新增模式必填） */
function validateForm(alias: string, nodePath: string, editing: boolean): "aliasRequired" | "pathRequired" | null {
  if (alias.trim() === "") return "aliasRequired";
  if (!editing && nodePath.trim() === "") return "pathRequired";
  return null;
}

/** 行内错误段（空串不渲染） */
function FieldError({
  message,
  className,
  testId,
}: {
  message: string;
  className?: string;
  testId?: string;
}): React.JSX.Element | null {
  if (message === "") return null;
  return (
    <p className={className} role="alert" data-testid={testId}>
      ❌ {message}
    </p>
  );
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
  const [sshAliases, setSshAliases] = useState<string[] | null>(null);

  // 可选别名加载（sshAliasList 读本机 ~/.ssh/config；失败/缺席 = 空列表走空态提示）
  useEffect(() => {
    let alive = true;
    void client.sshAliasList().then((result) => {
      if (alive) {
        setSshAliases(result.ok ? result.data.aliases : []);
      }
    });
    return () => {
      alive = false;
    };
  }, [client]);

  // 下拉选项：占位（未选/加载中）/ 编辑态当前别名保留（config 漂移不吞既有值）/
  // config 别名；加载完成且无任何可选项 → 空态提示（缺席不是错误态——不报错只提示）
  const aliasList = sshAliases ?? [];
  const currentAlias = entity?.alias ?? "";
  const preserveCurrent = editing && currentAlias !== "" && !aliasList.includes(currentAlias);
  const aliasOptions = buildAliasOptions({
    aliasList,
    loaded: sshAliases !== null,
    preserveCurrent,
    currentAlias,
    alias,
    emptyLabel: t("dsh.deploy.form.aliasEmpty"),
    placeholderLabel: t("dsh.deploy.form.aliasPlaceholder"),
  });

  async function save(): Promise<void> {
    setAliasError("");
    setPathError("");
    setServerError("");
    const invalid = validateForm(alias, nodePath, editing);
    if (invalid !== null) {
      (invalid === "aliasRequired" ? setAliasError : setPathError)(t(`dsh.deploy.form.${invalid}`));
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
          <SelectInput
            value={alias}
            onChange={setAlias}
            options={aliasOptions}
            ariaLabel={t("dsh.deploy.form.alias")}
          />
        </label>
        <FieldError message={aliasError} className={styles.formError} />
        <label className={styles.formRow}>
          <span className={styles.formLabel}>{t("dsh.deploy.form.nodePath")}</span>
          <TextInput
            value={nodePath}
            onChange={setNodePath}
            placeholder="/usr/local/bin/node"
            ariaLabel={t("dsh.deploy.form.nodePath")}
          />
        </label>
        <FieldError message={pathError} className={styles.formError} />
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
        <FieldError message={serverError} testId="deploy-form-error" />
      </div>
    </Modal>
  );
}
