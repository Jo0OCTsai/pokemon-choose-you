/**
 * 未保存离开确认弹层（U21）：背包任一分区有未保存变更且训练家离开背包（切分段/关页面/
 * chip 或桌宠跳转）时呈现——「背包还有未保存的修改。」［保存并离开］［放弃修改］
 * ［留在这里］；focus trap 同确认弹层范式；保存失败留在当前分区（不丢草稿）。
 */
import { useT } from "../i18n";
import { Modal } from "../ui/Modal";

export function UnsavedLeaveDialog({
  onSaveLeave,
  onDiscard,
  onStay,
  saveBusy = false,
}: {
  /** 保存并离开：先提交成功再离开；失败留在当前分区 */
  onSaveLeave: () => void;
  onDiscard: () => void;
  onStay: () => void;
  saveBusy?: boolean;
}): React.JSX.Element {
  const t = useT();
  return (
    <Modal
      title={t("dsh.settings.leaveTitle")}
      actions={[
        { label: t("dsh.settings.leaveStay"), onChoose: onStay },
        { label: t("dsh.settings.leaveDiscard"), onChoose: onDiscard, variant: "danger" },
        {
          label: saveBusy ? t("dsh.settings.saving") : t("dsh.settings.leaveSave"),
          onChoose: onSaveLeave,
          variant: "primary",
          disabled: saveBusy,
        },
      ]}
      onClose={onStay}
      ariaLabel={t("dsh.settings.leaveTitle")}
    />
  );
}
