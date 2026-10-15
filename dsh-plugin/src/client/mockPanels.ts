/**
 * mockHost 命令组 · 设置与背包：configRead/configWrite（勿扰起=止与 HH:MM 校验兜底）、
 * routeUpsert/larkAuth/larkTest；分类（upsert/放生级联归第一个分类）、标签/维度、
 * 会话过滤三态、agent 列表（空命令拒绝 + expectedAgentIds 修订检测，A24）、
 * 提示词 4 键（长度/占位符校验 + overrideText 基线修订检测）。
 */
import { PkyError } from "../host/storage/errors";
import type { Category } from "../host/domain/vocabulary";
import type { Tag, TagDimension } from "../host/domain/vocabulary-tags";
import type { FilterItem } from "../host/domain/vocabulary-filters";
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

/** 设置命令：configRead 过滤 / configWrite 校验（时钟格式 + 起止不同）+ 落库 */
export function settingsCommands(
  ctx: MockContext,
): Pick<HostClient, "configRead" | "configWrite" | "routeUpsert" | "larkAuth" | "larkTest"> {
  return {
    async configRead(params) {
      ctx.record("configRead", params);
      const keys = params?.keys;
      const keyValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(ctx.state.settings)) {
        if (keys === undefined || keys.includes(key)) {
          keyValues[key] = value;
        }
      }
      return { ok: true, data: { keyValues } };
    },
    async configWrite(params) {
      ctx.record("configWrite", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const invalid = validateConfig(params.keyValues);
      if (invalid !== null) {
        return { ok: false, error: invalid.toShape() };
      }
      Object.assign(ctx.state.settings, params.keyValues);
      return { ok: true, data: { ok: true } };
    },
    async routeUpsert(params) {
      ctx.record("routeUpsert", params);
      return { ok: true, data: params.route };
    },
    async larkAuth() {
      ctx.record("larkAuth");
      ctx.state.larkAuthorized = true;
      return { ok: true, data: { launched: true } };
    },
    async larkTest() {
      ctx.record("larkTest");
      if (!ctx.state.larkAuthorized) {
        return { ok: false, error: new PkyError("LARK_UNAUTHORIZED", "飞书未授权").toShape() };
      }
      return { ok: true, data: { identity: "训练家", chatCount: 12 } };
    },
  };
}

/** 配置写入校验（U20 行内防呆的后端兜底口径） */
function validateConfig(keyValues: Record<string, string>): PkyError | null {
  for (const [key, value] of Object.entries(keyValues)) {
    if ((key === "quiet_start" || key === "quiet_end") && !/^\d{2}:\d{2}$/.test(value)) {
      return new PkyError("CONFIG_VALIDATION_FAILED", `「${key}」必须为 HH:MM 格式`);
    }
  }
  if (keyValues["quiet_start"] !== undefined && keyValues["quiet_start"] === keyValues["quiet_end"]) {
    return new PkyError("CONFIG_VALIDATION_FAILED", "勿扰起止不能相同");
  }
  return null;
}

/** agent 修订检测：expectedAgentIds 基线失配 → SETTING_MODIFIED_ELSEWHERE（force 覆盖） */
function assertAgentRevision(
  ctx: MockContext,
  expectedAgentIds: string[] | undefined,
  force: boolean | undefined,
): PkyError | null {
  if (force || expectedAgentIds === undefined) {
    return null;
  }
  const currentIds = ctx.state.agents
    .map((a) => a.id)
    .sort()
    .join("\n");
  if (currentIds !== [...expectedAgentIds].sort().join("\n")) {
    return new PkyError("SETTING_MODIFIED_ELSEWHERE", "agent 列表已在另一处被修改", "确认覆盖请带 force 重发整值");
  }
  return null;
}

type CategoryUpsertParams = Parameters<HostClient["categoryUpsert"]>[0];

/** 未传字段回落已有值（覆盖语义缺省） */
function pick<T>(incoming: T | undefined, current: T): T {
  return incoming ?? current;
}

/** 分类 upsert 实现：无 id = 新建（缺省空值）；有 id = 局部覆盖（未传字段保持） */
function upsertCategory(ctx: MockContext, params: CategoryUpsertParams): Category {
  if (params.id === undefined) {
    const category = withDefaults(params, { name: "", pokemon: "", sprite: "", description: "", enabled: true });
    category.id = ctx.state.categories.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    ctx.state.categories.push(category);
    return category;
  }
  const existing = ctx.state.categories.find((c) => c.id === params.id) as Category;
  Object.assign(existing, withDefaults(params, existing));
  return existing;
}

/** upsert 入参 → 完整分类形态（id 占位 0，新建时重排） */
function withDefaults(params: CategoryUpsertParams, base: Omit<Category, "id">): Category {
  return {
    id: params.id ?? 0,
    name: pick(params.name, base.name),
    pokemon: pick(params.pokemon, base.pokemon),
    sprite: pick(params.sprite, base.sprite),
    enabled: pick(params.enabled, base.enabled),
    description: pick(params.description, base.description),
  };
}

/** 分类命令：upsert（新增/改名/换装/启停）+ 放生级联（任务归第一个分类） */
export function categoryCommands(ctx: MockContext): Pick<HostClient, "categoryUpsert" | "categoryDelete"> {
  return {
    async categoryUpsert(params) {
      ctx.record("categoryUpsert", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      return { ok: true, data: upsertCategory(ctx, params) };
    },
    async categoryDelete(params) {
      ctx.record("categoryDelete", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      if (ctx.state.categories.length <= 1) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "至少保留一个分类").toShape() };
      }
      const index = ctx.state.categories.findIndex((c) => c.id === params.id);
      if (index < 0) {
        return { ok: false, error: new PkyError("NOT_FOUND", `分类 ${params.id} 不存在`).toShape() };
      }
      ctx.state.categories.splice(index, 1);
      const fallback = ctx.state.categories[0];
      const movedTaskCount = ctx.state.tasks.filter((t) => t.categoryId === params.id).length;
      for (const task of ctx.state.tasks) {
        if (task.categoryId === params.id) {
          task.categoryId = fallback.id;
        }
      }
      return { ok: true, data: { id: params.id, movedTaskCount } };
    },
  };
}

/** 标签与维度命令（tagDelete 同步移除 mock 词表行——僵尸放生与词表夹具保持一致） */
export function vocabularyCommands(ctx: MockContext): Pick<HostClient, "tagUpsert" | "tagDelete" | "dimensionUpdate"> {
  return {
    async tagUpsert(params) {
      ctx.record("tagUpsert", params);
      const tag: Tag = {
        id: params.id ?? 1,
        name: params.name,
        description: params.description ?? "",
        dimension: params.dimension,
        origin: "manual",
        createdAt: "2026-10-11T09:00:00+08:00",
        usage: 0,
      };
      return { ok: true, data: tag };
    },
    async tagDelete(params) {
      ctx.record("tagDelete", params);
      ctx.state.tags = ctx.state.tags.filter((t) => t.id !== params.id);
      return { ok: true, data: { id: params.id } };
    },
    async dimensionUpdate(params) {
      ctx.record("dimensionUpdate", params);
      const dimension: TagDimension = {
        id: 1,
        key: params.key,
        name: params.name,
        cardinality: "multi",
        maxTags: params.maxTags ?? 12,
        sort: 1,
        enabled: params.enabled ?? true,
      };
      return { ok: true, data: dimension };
    },
  };
}

/** 会话过滤三态清单与写入（follow = 删偏好行口径） */
export function filterCommands(ctx: MockContext): Pick<HostClient, "filterList" | "filterUpsert"> {
  return {
    async filterList() {
      ctx.record("filterList");
      const counts = { follow: 0, always_filter: 0, always_pull: 0 };
      for (const chat of ctx.state.filters) {
        counts[chat.state] += 1;
      }
      return { ok: true, data: { chats: ctx.state.filters, counts, lastPollAt: ctx.state.health.lastSuccessAt } };
    },
    async filterUpsert(params) {
      ctx.record("filterUpsert", params);
      const existing = ctx.state.filters.find((c) => c.chatId === params.chatId);
      if (existing !== undefined) {
        existing.state = params.state;
        return { ok: true, data: existing };
      }
      const item: FilterItem = {
        chatId: params.chatId,
        chatName: params.chatId,
        chatType: "group",
        state: params.state,
        updatedAt: "2026-10-11T09:00:00+08:00",
      };
      ctx.state.filters.push(item);
      return { ok: true, data: item };
    },
  };
}

/** agent 列表（空命令拒绝 + expectedAgentIds 修订检测，A24） */
export function agentCommands(ctx: MockContext): Pick<HostClient, "agentUpsert" | "agentDelete"> {
  return {
    async agentUpsert(params) {
      ctx.record("agentUpsert", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      if (params.agent.command.trim() === "") {
        return { ok: false, error: new PkyError("AGENT_COMMAND_INVALID", "agent 命令不能为空").toShape() };
      }
      const conflict = assertAgentRevision(ctx, params.expectedAgentIds, params.force);
      if (conflict !== null) {
        return { ok: false, error: conflict.toShape() };
      }
      const index = ctx.state.agents.findIndex((a) => a.id === params.agent.id);
      if (index >= 0) {
        ctx.state.agents[index] = params.agent;
      } else {
        ctx.state.agents.push(params.agent);
      }
      return { ok: true, data: { agents: [...ctx.state.agents] } };
    },
    async agentDelete(params) {
      ctx.record("agentDelete", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const conflict = assertAgentRevision(ctx, params.expectedAgentIds, params.force);
      if (conflict !== null) {
        return { ok: false, error: conflict.toShape() };
      }
      ctx.state.agents = ctx.state.agents.filter((a) => a.id !== params.id);
      return { ok: true, data: { agents: [...ctx.state.agents] } };
    },
  };
}
