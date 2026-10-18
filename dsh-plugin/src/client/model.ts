/**
 * 面板视图模型（纯函数派生）：五呈现 / 冒险快照 / 路线分组 / 图鉴统计 / 派发徽标。
 * 状态语义 = host 域六态（inbox/scheduled/active/paused/done/cancelled），呈现语义 =
 * UIUX §1 展示字段表（卡片五呈现 + 派发徽标五态）。
 */
import type {
  AgentSessionEntry,
  DbStatus,
  DispatchRoute,
  DispatchView,
  FollowupNote,
  RadioHealth,
  RadioMessage,
} from "./rpc";
import type { Task } from "../host/domain/tasks";
import type { AgentConfig } from "../host/domain/settings";
import type { PromptSpecInfo } from "../host/domain/prompt-overrides";
import type { Category } from "../host/domain/vocabulary";
import type { Tag, TagDimension } from "../host/domain/vocabulary-tags";
import type { FilterItem } from "../host/domain/vocabulary-filters";
import type { PokemonCandidate } from "./settings/sections/CategoryTagSection";

/** 面板数据快照（dsh 适配层组装；组件层对 rpc mock 可测的输入面） */
export interface PanelData {
  locale: "zh-Hans" | "zh-Hant" | "en";
  /** 冒险头展示的「今天」（YYYY-MM-DD；测试可注入） */
  today: string;
  tasks: Task[];
  categories: Category[];
  messages: RadioMessage[];
  health: RadioHealth;
  auth: { authorized: boolean; expired: boolean };
  /** taskId → 跟进记录流 */
  followups: Record<number, FollowupNote[]>;
  /** taskId → 派发执行视图（无行 = 未派发） */
  dispatches: Record<number, DispatchView>;
  /** agent 会话账本（日志分段 + 详情时间线共用） */
  sessions: AgentSessionEntry[];
  /** 项目派发路由（dsh:dispatch_routes） */
  routes: DispatchRoute[];
  /** 共享设置值（背包分区页 + 显示偏好驱动面板呈现） */
  config: Record<string, string>;
  /** null = 未知（未探测）；mode=ro → 只读横幅 + 写操作禁用 */
  dbStatus: DbStatus | null;
  /** 背包实体面（分区整页按需消费；可选降低任务面夹具负担） */
  dimensions?: TagDimension[];
  tags?: Tag[];
  agents?: AgentConfig[];
  promptSpecs?: PromptSpecInfo[];
  filters?: FilterItem[];
  /** 会话过滤快照时间（host filterList.lastPollAt——health 最近一次成功拉取） */
  filterLastPollAt?: string | null;
  /** 换装搜索（1025 只名录；适配层接 host 搜索） */
  pokemonSearch?: (query: string) => Promise<PokemonCandidate[]>;
  loading?: boolean;
}

/** 卡片五呈现（active 与 paused 共享「进行中」面但降饱和角标不同） */
export type TaskPresentation = "normal" | "active" | "activePaused" | "done" | "escaped";

export function taskPresentation(task: Task): TaskPresentation {
  switch (task.status) {
    case "active":
      return "active";
    case "paused":
      return task.startedAt !== null ? "activePaused" : "normal";
    case "done":
      return "done";
    case "cancelled":
      return "escaped";
    default:
      return "normal";
  }
}

/** RFC3339 → YYYY-MM-DD（本地口径取字面前 10 位——库内时间为本地时间串） */
export function dateOf(iso: string | null): string | null {
  if (iso === null || iso.length < 10) {
    return null;
  }
  return iso.slice(0, 10);
}

/** 逾期：有截止、未完成、截止日期早于今天（昨日及以前 = 「昨天有 N 只溜走了」折叠行） */
export function isOverdue(task: Task, today: string): boolean {
  if (task.status === "done" || task.status === "cancelled") {
    return false;
  }
  const due = dateOf(task.dueAt);
  return due !== null && due < today;
}

export interface AdventureSnapshot {
  /** 今日到期 + 进行中（含暂停变体） */
  todayTasks: Task[];
  /** CAUGHT x/y 的 y */
  total: number;
  /** CAUGHT x/y 的 x（今日已完成） */
  caught: number;
  overdueTasks: Task[];
}

/** 冒险分段快照：进行中/暂停 + 今日到期 + 逾期折叠集 */
export function adventureSnapshot(tasks: Task[], today: string): AdventureSnapshot {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const activeOrPaused = open.filter((t) => t.status === "active" || t.status === "paused");
  const dueToday = open.filter((t) => t.status !== "active" && t.status !== "paused" && dateOf(t.dueAt) === today);
  const doneToday = tasks.filter((t) => t.status === "done" && dateOf(t.completedAt) === today);
  return {
    todayTasks: [...activeOrPaused, ...dueToday],
    total: activeOrPaused.length + dueToday.length + doneToday.length,
    caught: doneToday.length,
    overdueTasks: open.filter((t) => isOverdue(t, today)),
  };
}

/** 路线分组：scheduled（有截止未出发）按日期升序分组 */
export function routeGroups(tasks: Task[]): Array<{ date: string; tasks: Task[] }> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.status !== "scheduled") {
      continue;
    }
    const due = dateOf(task.dueAt) ?? "";
    const bucket = groups.get(due);
    if (bucket === undefined) {
      groups.set(due, [task]);
    } else {
      bucket.push(task);
    }
  }
  return [...groups.entries()]
    .filter(([date]) => date !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, tasks: list }));
}

/** 草丛：inbox（无截止从未出发） */
export function grassTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === "inbox");
}

export interface DexStats {
  caught: number;
  escaped: number;
  /** 里程碑贺词档位键（m0/m1/m10/m50/m100/m200，借 dexStats.milestone.*） */
  milestone: string;
  milestoneParam: number;
}

/** 图鉴统计 + 里程碑档位 */
export function dexStats(tasks: Task[]): DexStats {
  const caught = tasks.filter((t) => t.status === "done").length;
  const escaped = tasks.filter((t) => t.status === "cancelled").length;
  let milestone = "m0";
  if (caught >= 200) {
    milestone = "m200";
  } else if (caught >= 100) {
    milestone = "m100";
  } else if (caught >= 50) {
    milestone = "m50";
  } else if (caught >= 10) {
    milestone = "m10";
  } else if (caught >= 1) {
    milestone = "m1";
  }
  return { caught, escaped, milestone, milestoneParam: caught };
}

/** 派发徽标五态 → tooltip 键（dsh.dispatch.tooltip*） */
export function dispatchTooltipKey(state: string | null): string | null {
  switch (state) {
    case "queued":
      return "dsh.dispatch.tooltipQueued";
    case "running":
      return "dsh.dispatch.tooltipRunning";
    case "done":
      return "dsh.dispatch.tooltipDone";
    case "failed":
      return "dsh.dispatch.tooltipFailed";
    default:
      return null;
  }
}

/** 建议流五分组：待处理 / 无动作 / 判定失败 / 已捕捉 / 已逃走（后两组默认折叠） */
export interface SuggestionGroups {
  pending: RadioMessage[];
  none: RadioMessage[];
  failed: RadioMessage[];
  caught: RadioMessage[];
  escaped: RadioMessage[];
}

export function suggestionGroups(messages: RadioMessage[]): SuggestionGroups {
  const groups: SuggestionGroups = { pending: [], none: [], failed: [], caught: [], escaped: [] };
  for (const message of messages) {
    if (message.reviewStatus === "accepted") {
      groups.caught.push(message);
    } else if (message.reviewStatus === "dismissed") {
      groups.escaped.push(message);
    } else if (message.aiStatus === "error") {
      groups.failed.push(message);
    } else if (message.aiStatus === "judging" || message.aiStatus === "pending") {
      // 判定中与待判定同观感（im.status.judging 口径）
      groups.pending.push(message);
    } else if (message.aiStatus === "todo" || message.aiStatus === "update") {
      groups.pending.push(message);
    } else {
      groups.none.push(message);
    }
  }
  return groups;
}

/** 分段导航七段键（锚点参数：panel = 面板首段 / settings = 背包；草丛排在路线后——2026-10-18 用户裁决） */
export const SEGMENTS = ["adventure", "route", "grass", "dex", "radio", "logs", "settings"] as const;
export type SegmentKey = (typeof SEGMENTS)[number];

/** 分段名 → 主应用字典键（同名同义词汇，A16） */
export const SEGMENT_LABEL_KEYS: Record<SegmentKey, string> = {
  adventure: "tabs.today",
  grass: "tabs.inbox",
  route: "tabs.scheduled",
  dex: "tabs.done",
  radio: "tabs.im",
  logs: "tabs.sessions",
  settings: "tabs.settings",
};

/** 背包各分区是否有未保存草稿（SectionNav 静态点提示用；纯函数） */
export function dirtySectionSet(
  draft: Record<string, string>,
  saved: Record<string, string>,
  keySets: Record<string, readonly string[]>,
): Set<string> {
  const dirty = new Set<string>();
  for (const [section, keys] of Object.entries(keySets)) {
    if (keys.some((key) => draft[key] !== saved[key])) {
      dirty.add(section);
    }
  }
  return dirty;
}
