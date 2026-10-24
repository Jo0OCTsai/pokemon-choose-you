/**
 * Agent 配置卡拆件 · pk 技能行（桌面 skill-line 同构）：状态文案（未检查/未安装/
 * 已装最新/可更新）+ 检查 / 安装-同步 即时动作（command/dir 草稿值优先传 host——
 * 未保存也能按当前填写检查）。自持状态，从 AgentEditForm 拆出（复杂度棘轮拆分）。
 */
import { useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { FormRow } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** pk 技能检查结果（pkSkillCheck 数据面） */
interface SkillStatus {
  installed: boolean;
  installedVersion: string | null;
  bundledVersion: string;
}

/** 技能状态文案（桌面 skillText 同构） */
function skillText(t: (key: string, params?: Record<string, string>) => string, skill: SkillStatus | null): string {
  if (skill === null) {
    return t("ai.skillUnknown");
  }
  if (!skill.installed) {
    return t("ai.skillNotInstalled");
  }
  return skill.installedVersion === skill.bundledVersion
    ? t("ai.skillUpToDate", { v: skill.installedVersion ?? "?" })
    : t("ai.skillOutdated", { v: skill.installedVersion ?? "?", b: skill.bundledVersion });
}

export function AgentSkillRow({
  agentId,
  command,
  dir,
  commandInvalid,
}: {
  agentId: string;
  command: string;
  dir: string;
  commandInvalid: boolean;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillMsg, setSkillMsg] = useState<string | null>(null);
  /** 命令与技能根目录用编辑草稿值（未保存也能按当前填写检查） */
  const params = { agentId, command, dir };

  async function checkSkill(): Promise<void> {
    setSkillBusy(true);
    setSkillMsg(null);
    const result = await client.pkSkillCheck(params);
    setSkillBusy(false);
    if (result.ok) {
      setSkill(result.data);
    } else {
      setSkillMsg(result.error.message);
    }
  }

  async function installSkill(): Promise<void> {
    setSkillBusy(true);
    setSkillMsg(t("ai.skillInstalling"));
    const result = await client.pkSkillInstall(params);
    setSkillBusy(false);
    if (!result.ok) {
      setSkillMsg(result.error.message);
      return;
    }
    setSkillMsg(
      result.data.previousVersion !== null
        ? t("ai.skillUpdated", { v: result.data.version, prev: result.data.previousVersion, where: t("ai.local") })
        : t("ai.skillInstalled", { v: result.data.version, where: t("ai.local") }),
    );
    const fresh = await client.pkSkillCheck(params);
    if (fresh.ok) {
      setSkill(fresh.data);
    }
  }

  return (
    <>
      <FormRow label={t("ai.skill")} labelWidth={128} wide>
        <div className={styles.entityLine} data-testid="agent-skill-line">
          <span className={`${styles.grow} ${ui.muted}`}>{skillText(t, skill)}</span>
          <button
            type="button"
            className={ui.button}
            disabled={skillBusy || commandInvalid}
            onClick={() => void checkSkill()}
          >
            {t("ai.skillCheck")}
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={skillBusy || commandInvalid}
            onClick={() => void installSkill()}
          >
            {t("ai.skillInstall")}
          </button>
        </div>
      </FormRow>
      {skillMsg !== null && <p className={styles.cardHint}>{skillMsg}</p>}
    </>
  );
}
