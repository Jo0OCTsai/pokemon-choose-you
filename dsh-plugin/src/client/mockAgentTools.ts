/**
 * mockHost 命令组 · agent 工具面（agentTest 连接探针 / pkSkillCheck / pkSkillInstall）：
 * 内存语义子集——探针不真跑子进程，返回可配置结果（缺省连通）；技能状态三档可由测试
 * 经 state.pkSkill 预置，安装即置为已装最新。
 */
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

/** mock 技能状态（缺省 unknown → 检查后按 installedVersion 展示） */
export interface MockPkSkillState {
  /** 检查结果：null = 未检查；版本串 = 已装该版 */
  installedVersion: string | null;
  /** 已执行过检查（skillUnknown → 具体Status 的开关） */
  checked: boolean;
}

export function agentToolsCommands(
  ctx: MockContext,
): Pick<HostClient, "agentTest" | "pkSkillCheck" | "pkSkillInstall"> {
  return {
    async agentTest(params) {
      ctx.record("agentTest", params);
      return ctx.ok({ connected: true, message: "Agent 调用成功，pk 工具链已连通（context 正常返回）" });
    },
    async pkSkillCheck(params) {
      ctx.record("pkSkillCheck", params);
      const skill = (ctx.state.pkSkill ??= { installedVersion: null, checked: false });
      skill.checked = true;
      return ctx.ok({
        kind: "claude-code",
        dir: "/tmp/mock/.claude/skills/pokemon-choose-you",
        installed: skill.installedVersion !== null,
        installedVersion: skill.installedVersion,
        bundledVersion: "9",
      });
    },
    async pkSkillInstall(params) {
      ctx.record("pkSkillInstall", params);
      const skill = (ctx.state.pkSkill ??= { installedVersion: null, checked: false });
      const previous = skill.installedVersion;
      skill.installedVersion = "9";
      return ctx.ok({
        kind: "claude-code",
        dir: "/tmp/mock/.claude/skills/pokemon-choose-you",
        previousVersion: previous,
        version: "9",
        path: "/tmp/mock/.claude/skills/pokemon-choose-you/SKILL.md",
      });
    },
  };
}
