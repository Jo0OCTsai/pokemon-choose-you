/**
 * 背包分区里的插件私有配置行（dsh Config 键经 pluginConfig Context 消费——即时写，
 * 不走分区保存制，tip 标注「改值即时生效」）：
 * - JudgeRunnerRow（Agent 分区 · 派发设置卡）：AI 判定方式平铺选择器（用户裁决
 *   2026-10-18）——[dsh 内置通道（建设中）] + [不指定] + agents 单列表收口。选内置
 *   通道写 judgeExecutor=subagent；选 agent/不指定写 judgeExecutor=cli +
 *   ai_agent_id（共享键，主应用同库兼容——「判定用谁」一级决策，两级选择关系消失）。
 * - PetAutoStartRow（桌宠分区）：启动时自动显示桌宠开关。
 * controller 缺席（无 provider，如分区组件单测）行不渲染；有 controller 但 namespace
 * 未被宿主服务（unavailable）→ 一句可操作提示；loading 瞬态零占位。
 */
import { useClient } from "../clientContext";
import { usePluginConfig, usePluginConfigSnapshot } from "../dsh/pluginConfig";
import { useT } from "../i18n";
import { Select, Toggle } from "../ui/controls";

/** 内置通道的 UI 哨兵值（不出现在任何存储键——judgeExecutor/ai_agent_id 均为真实值） */
export const JUDGE_BUILTIN_VALUE = "dsh-subagent";

export function JudgeRunnerRow({
  agentOptions,
  agentId,
  onAgentPicked,
}: {
  /** agent 选项（[不指定] + agents——与 Agent 分区既有 agentOptions 同源） */
  agentOptions: ReadonlyArray<{ value: string; label: string }>;
  /** 当前 ai_agent_id（cli 态显示；"" = 不指定 → 第一个启用的 agent） */
  agentId: string;
  /** agent 侧草稿/基线同步（configWrite 成功后调用：onField + onSavedKeys） */
  onAgentPicked: (value: string) => void;
}): React.JSX.Element | null {
  const config = usePluginConfig();
  const snap = usePluginConfigSnapshot(config);
  const t = useT();
  const client = useClient();
  if (config === null || snap.status === "loading") {
    return null;
  }
  if (snap.status !== "ready") {
    return <p data-testid="plugin-config-unavailable">{t("dsh.config.unavailable")}</p>;
  }
  // hoisted 闭包不继承上面的 null 收窄——经局部常量带入
  const cfg = config;
  const builtin = snap.value?.judgeExecutor === "subagent";
  function pick(next: string): void {
    if (next === JUDGE_BUILTIN_VALUE) {
      void cfg.set("judgeExecutor", "subagent");
      return;
    }
    void cfg.set("judgeExecutor", "cli");
    void client.configWrite({ keyValues: { ai_agent_id: next } }).then((result) => {
      if (result.ok) {
        onAgentPicked(next);
      }
    });
  }
  return (
    <Select
      label={t("dsh.config.judgeExecutor")}
      tip={t("dsh.config.judgeExecutorDesc")}
      disabled={!snap.writable}
      value={builtin ? JUDGE_BUILTIN_VALUE : agentId}
      options={[{ value: JUDGE_BUILTIN_VALUE, label: t("dsh.config.judgeSubagent") }, ...agentOptions]}
      onChange={pick}
    />
  );
}

export function PetAutoStartRow(): React.JSX.Element | null {
  const config = usePluginConfig();
  const snap = usePluginConfigSnapshot(config);
  const t = useT();
  if (config === null || snap.status === "loading") {
    return null;
  }
  if (snap.status !== "ready") {
    return <p data-testid="plugin-config-unavailable">{t("dsh.config.unavailable")}</p>;
  }
  return (
    <Toggle
      label={t("dsh.config.petAutoStart")}
      tip={t("dsh.config.petAutoStartTip")}
      disabled={!snap.writable}
      checked={snap.value?.petAutoStart !== false}
      onChange={(next) => void config.set("petAutoStart", next)}
    />
  );
}
