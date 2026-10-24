/**
 * mockHost 命令组 · 复盘向导标签体检（从 mockPanels 词表段拆出以控函数规模）：
 * tagCheckup 固定报告回放（state.tagCheckup 夹具）+ tagMerge/tagMoveDimension 在 mock
 * 词表上真实移改（任务 TagRef 改挂/去重、维度复用或新建、配额口径；usage 按引用重算）。
 */
import { PkyError } from "../host/storage/errors";
import type { TagDimension } from "../host/domain/vocabulary-tags";
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

/** 标签体检三件（tagDelete 僵尸放生走 mockPanels 词表段，同在 state.tags 上移改） */
export function tagHealthCommands(ctx: MockContext): Pick<HostClient, "tagCheckup" | "tagMerge" | "tagMoveDimension"> {
  return { ...checkupCommand(ctx), ...mergeCommand(ctx), ...dimensionCommand(ctx) };
}

function checkupCommand(ctx: MockContext): Pick<HostClient, "tagCheckup"> {
  return {
    async tagCheckup() {
      ctx.record("tagCheckup");
      return { ok: true, data: ctx.state.tagCheckup };
    },
  };
}

/** 合并：任务 TagRef 改挂 into（同名同维度去重）→ 删 from → 按引用重算 usage */
function mergeCommand(ctx: MockContext): Pick<HostClient, "tagMerge"> {
  return {
    async tagMerge(params) {
      ctx.record("tagMerge", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const from = ctx.state.tags.find((t) => t.id === params.fromId);
      const into = ctx.state.tags.find((t) => t.id === params.intoId);
      if (from === undefined || into === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", "标签不存在").toShape() };
      }
      if (from.id === into.id) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "不能合并到自身").toShape() };
      }
      reassignTaskTags(ctx, from, into);
      ctx.state.tags = ctx.state.tags.filter((t) => t.id !== from.id);
      recomputeUsage(ctx);
      return { ok: true, data: { ok: true } };
    },
  };
}

/** from 维度引用全部改挂 into（同名同维度去重） */
function reassignTaskTags(
  ctx: MockContext,
  from: { name: string; dimension: string },
  into: { name: string; dimension: string },
): void {
  for (const task of ctx.state.tasks) {
    if (task.tags.some((r) => r.name === from.name && r.dimension === from.dimension)) {
      const rest = task.tags.filter((r) => !(r.name === from.name && r.dimension === from.dimension));
      if (!rest.some((r) => r.name === into.name && r.dimension === into.dimension)) {
        rest.push({ name: into.name, dimension: into.dimension });
      }
      task.tags = rest;
    }
  }
}

/** 迁维度：key 命中复用，否则新建（建后再查配额——host 同序，新建维度行不因配额报错回滚） */
function dimensionCommand(ctx: MockContext): Pick<HostClient, "tagMoveDimension"> {
  return {
    async tagMoveDimension(params) {
      ctx.record("tagMoveDimension", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const name = params.name.trim();
      if (name === "" || params.tagIds.length === 0) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "维度名与标签列表不能为空").toShape() };
      }
      const found = ctx.state.dimensions.find((d) => d.key === params.key);
      const dim = found ?? createDimension(ctx, params.key, name);
      if (dim === null) {
        return {
          ok: false,
          error: new PkyError("INVALID_ARGUMENT", "维度 key 只能包含小写字母、数字、-、_").toShape(),
        };
      }
      const moving = ctx.state.tags.filter((t) => params.tagIds.includes(t.id) && t.dimension !== dim.key);
      const used = ctx.state.tags.filter((t) => t.dimension === dim.key).length;
      if (dim.maxTags - used < moving.length) {
        return {
          ok: false,
          error: new PkyError("INVALID_ARGUMENT", "目标维度剩余名额不足，先清理或调高上限").toShape(),
        };
      }
      for (const tag of moving) {
        tag.dimension = dim.key;
      }
      return { ok: true, data: { ok: true } };
    },
  };
}

/** 新建 mock 维度（key 归一校验失败返回 null 不落库） */
function createDimension(ctx: MockContext, rawKey: string, name: string): TagDimension | null {
  const key = rawKey.trim().toLowerCase();
  if (key === "" || !/^[a-z0-9_-]+$/.test(key)) {
    return null;
  }
  const dim: TagDimension = {
    id: ctx.state.dimensions.reduce((max, d) => Math.max(max, d.id), 0) + 1,
    key,
    name,
    cardinality: "multi",
    maxTags: 30,
    sort: ctx.state.dimensions.reduce((max, d) => Math.max(max, d.sort), 0) + 1,
    enabled: true,
  };
  ctx.state.dimensions.push(dim);
  return dim;
}

/** 按任务标签引用重算 usage（merge 后保持 mock 词表计数一致） */
function recomputeUsage(ctx: MockContext): void {
  for (const tag of ctx.state.tags) {
    tag.usage = ctx.state.tasks.filter((task) =>
      task.tags.some((r) => r.name === tag.name && r.dimension === tag.dimension),
    ).length;
  }
}
