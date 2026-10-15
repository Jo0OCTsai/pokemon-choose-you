/**
 * host 命令 · 背包域（AD §4.1.1 背包行，配置 100% 对齐 §8⑨）：categoryUpsert /
 * categoryDelete / tagUpsert / tagDelete / dimensionUpdate / filterList /
 * filterUpsert / agentUpsert / agentDelete / promptList / promptGet /
 * promptOverride / promptReset——薄转发 domain 词表与配置原语；另含复盘向导
 * 「标签体检」3 条（tagCheckup 本地预筛报告只读 + tagMerge/tagMoveDimension 治理写）。
 * agent 工具面 3 条（agentTest 连接探针 / pkSkillCheck / pkSkillInstall 本机分发）
 * 拆 commands/agentToolsCommands.ts。
 */
import type { CommandTable } from "./context";
import { categoryDelete, categoryUpsert } from "../domain/vocabulary";
import { dimensionUpdate, tagDelete, tagUpsert } from "../domain/vocabulary-tags";
import { mergeTag, moveTagsToDimension, tagCheckup } from "../domain/tag-health";
import { filterList, filterUpsert, type FilterState } from "../domain/vocabulary-filters";
import { agentDelete, agentUpsert, type AgentConfig } from "../domain/settings";
import { promptGet, promptList, promptOverride, promptReset } from "../domain/prompt-overrides";
import { FEISHU } from "../health/snapshot";

/** 词表段（分类/标签/维度/会话过滤，7 条） */
function vocabularyCommands(): CommandTable {
  return {
    categoryUpsert: (p, deps) => {
      const out = categoryUpsert(deps.conn, p as Parameters<typeof categoryUpsert>[1]);
      deps.onWrites();
      return out;
    },
    categoryDelete: (p, deps) => {
      const out = categoryDelete(deps.conn, (p as { id: number }).id);
      deps.onWrites();
      return out;
    },
    tagUpsert: (p, deps) => {
      const out = tagUpsert(deps.conn, p as Parameters<typeof tagUpsert>[1]);
      deps.onWrites();
      return out;
    },
    tagDelete: (p, deps) => {
      const out = tagDelete(deps.conn, (p as { id: number }).id);
      deps.onWrites();
      return out;
    },
    dimensionUpdate: (p, deps) => {
      const out = dimensionUpdate(deps.conn, p as Parameters<typeof dimensionUpdate>[1]);
      deps.onWrites();
      return out;
    },
    // lastPollAt = 飞书链路最近一次成功拉取（health 单源）——会话过滤快照新鲜度口径
    filterList: (_p, deps) => ({
      ...filterList(deps.conn),
      lastPollAt: deps.health.snapshot(FEISHU).lastSuccessAt,
    }),
    filterUpsert: (p, deps) => {
      const out = filterUpsert(deps.conn, (p as { chatId: string }).chatId, (p as { state: FilterState }).state);
      deps.onWrites();
      return out;
    },
  };
}

/** 复盘向导「标签体检」段（3 条）：本地预筛报告只读；合并/迁维度为治理写。LLM 复核为桌面专属，judged 恒 false */
function tagHealthCommands(): CommandTable {
  return {
    tagCheckup: (_p, deps) => tagCheckup(deps.conn),
    tagMerge: (p, deps) => {
      const args = p as { fromId: number; intoId: number };
      mergeTag(deps.conn, args.fromId, args.intoId);
      deps.onWrites();
      return { ok: true };
    },
    tagMoveDimension: (p, deps) => {
      const args = p as { tagIds: number[]; key: string; name: string };
      moveTagsToDimension(deps.conn, args.tagIds, args.key, args.name);
      deps.onWrites();
      return { ok: true };
    },
  };
}

/** agent 与提示词覆盖段（6 条，A24 修订检测） */
function agentPromptCommands(): CommandTable {
  return {
    agentUpsert: (p, deps) => {
      const args = p as { agent: AgentConfig; expectedAgentIds?: string[]; force?: boolean };
      const agents = agentUpsert(deps.conn, args.agent, { expectedAgentIds: args.expectedAgentIds, force: args.force });
      deps.onWrites();
      return { agents };
    },
    agentDelete: (p, deps) => {
      const args = p as { id: string; expectedAgentIds?: string[]; force?: boolean };
      const agents = agentDelete(deps.conn, args.id, { expectedAgentIds: args.expectedAgentIds, force: args.force });
      deps.onWrites();
      return { agents };
    },
    promptList: (_p, deps) => ({ specs: promptList(deps.conn) }),
    promptGet: (p, deps) => promptGet(deps.conn, (p as { key: string }).key),
    promptOverride: (p, deps) => {
      const args = p as { key: string; value: string; expectedValue?: string; force?: boolean };
      const out = promptOverride(deps.conn, args.key, args.value, {
        expectedValue: args.expectedValue,
        force: args.force,
      });
      deps.onWrites();
      return out;
    },
    promptReset: (p, deps) => {
      const args = p as { key: string; expectedValue?: string; force?: boolean };
      const out = promptReset(deps.conn, args.key, { expectedValue: args.expectedValue, force: args.force });
      deps.onWrites();
      return out;
    },
  };
}

/** 背包域命令表（16 条；agent 工具面 3 条拆 agentToolsCommands.ts——棘轮拆分） */
export function backpackCommands(): CommandTable {
  return { ...vocabularyCommands(), ...tagHealthCommands(), ...agentPromptCommands() };
}
