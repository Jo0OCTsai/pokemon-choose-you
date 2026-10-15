/**
 * PanelData 组装（Phase B 适配层数据面）：HostClient 读命令 → 面板快照。
 *
 * 实体清单经 `panelSnapshot`（实体读域聚合命令，Phase B 契约缺口补齐）一次灌入：
 * 任务四段/收音机消息五分组/会话账本/分类/当前任务——组件契约是「全量 Task[] +
 * 纯函数重分组」，本层把快照各段按 id 去重合并成 Task[]（model 纯函数重导出的
 * 分组与 host 分段一致）；跟进流与任务级时间线由 taskDetail 在抽屉打开时懒载
 * （TaskDetailDrawer 内接线）。快照失败/旧 host 无此命令 → 空集降级（组件空态）。
 * 其余读面（config/dbStatus/diagnostics/filter/prompt/logQuery）并行逐项兜底；
 * agents 与派发路由从共享设置键解析（`ai_agents` / `dsh:dispatch_routes` JSON——
 * 与主应用「前端整读」同构）；收音机健康优先取快照（host 已归一 client 契约形态），
 * 快照缺勤时从 diagnostics feishu 链路派生（epoch 毫秒 → RFC3339，避免 client
 * timeOf 对 number 取 slice 崩溃）；换装搜索内置主应用 catalog.json
 * （@app-pokemon alias 零拷贝直引，54KB 静态名录随 bundle 分发）。
 */
import catalogJson from "@app-pokemon/catalog.json";
import type { AgentConfig } from "../../host/domain/settings";
import type { Task } from "../../host/domain/tasks";
import type { HostClient, PkyResult } from "../rpc";
import type { DiagnosticsLink, DispatchRoute, PanelSnapshot, RadioHealth } from "../rpcTypes";
import type { Locale } from "../i18n";
import { SUPPORTED_LOCALES } from "../i18n";
import type { PanelData } from "../model";
import type { PokemonCandidate } from "../settings/sections/CategoryTagSection";

/** 共享设置键字面量（单源在 host domain：settings.ts 的 SETTING_KEYS / routes.ts 的 DISPATCH_ROUTES_KEY——两模块引 storage/db（node:sqlite）不可入 client bundle，故此处内联并注释锚定） */
const KEY_LANGUAGE = "language";
const KEY_AGENTS = "ai_agents";
const KEY_ROUTES = "dsh:dispatch_routes";

type CatalogRow = [number, string, string, string, string];
const CATALOG: readonly CatalogRow[] = (catalogJson as { v: number; entries: CatalogRow[] }).entries;

/** 本地日期 YYYY-MM-DD（冒险头「今天」口径） */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 语言键 → Locale（非法值回落 zh-Hans——缺省口径与 I18nProvider 一致） */
export function localeOf(config: Record<string, string>): Locale {
  const raw = config[KEY_LANGUAGE];
  return SUPPORTED_LOCALES.some((l) => l.value === raw) ? (raw as Locale) : "zh-Hans";
}

/** PokeAPI key → 本地化精灵名（chip 运行态前缀等展示面；名录外回落 key 本身） */
export function pokemonNameOf(key: string, locale: Locale): string {
  const row = CATALOG.find((r) => r[1] === key);
  if (row === undefined) {
    return key;
  }
  return locale === "zh-Hant" ? row[3] : locale === "en" ? row[4] : row[2];
}

/** locale memo（chip/面板共用一次 configRead；同一 HostClient 实例只拉一回） */
const localeCache = new WeakMap<HostClient, Promise<Locale>>();

/** 拉当前语言（chip 挂载期初始化用；失败回落 zh-Hans） */
export function loadLocale(client: HostClient): Promise<Locale> {
  let cached = localeCache.get(client);
  if (cached === undefined) {
    cached = client
      .configRead({ keys: [KEY_LANGUAGE] })
      .then((r) => (r.ok ? localeOf(r.data.keyValues) : "zh-Hans"))
      .catch(() => "zh-Hans" as const);
    localeCache.set(client, cached);
  }
  return cached;
}

/** ai_agents JSON → agent 列表（loadAgents 同构：坏数据/空 command 过滤） */
export function agentsOf(config: Record<string, string>): AgentConfig[] {
  let list: AgentConfig[] = [];
  try {
    const parsed: unknown = JSON.parse(config[KEY_AGENTS] ?? "");
    list = Array.isArray(parsed) ? (parsed as AgentConfig[]) : [];
  } catch {
    list = [];
  }
  return list.filter((a) => typeof a?.command === "string" && a.command.trim() !== "");
}

/** dsh:dispatch_routes JSON → 路由数组（tag 并入条目——PanelData.routes 视图形态） */
export function routesOf(config: Record<string, string>): DispatchRoute[] {
  let map: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(config[KEY_ROUTES] ?? "");
    map =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    map = {};
  }
  return Object.entries(map).map(([tag, value]) => ({ tag, ...(value as Omit<DispatchRoute, "tag">) }));
}

/** 诊断六态 → 收音机健康三档（ok/idle → ok；paused/degraded → warn；down → fail） */
function healthLevel(status: string | undefined): RadioHealth["level"] {
  if (status === "down") {
    return "fail";
  }
  return status === "paused" || status === "degraded" ? "warn" : "ok";
}

/** feishu 链路 → 收音机健康四元组（nextPollAt 宿主承载为 epoch 毫秒、client 契约为 RFC3339 串——本层归一；链路缺勤 = 健康绿灯空态） */
function healthFromLinks(links: readonly DiagnosticsLink[]): RadioHealth {
  const feishu = links.find((l) => l.provider === "feishu");
  if (feishu === undefined) {
    return { level: "ok", lastSuccessAt: null, nextPollAt: null, consecutiveFailures: 0, pendingCount: 0 };
  }
  const nextPollAt = feishu.nextPollAt === null ? null : new Date(feishu.nextPollAt as string | number).toISOString();
  return {
    level: healthLevel(feishu.level),
    lastSuccessAt: feishu.lastSuccessAt,
    nextPollAt,
    consecutiveFailures: feishu.consecutiveFailures,
    pendingCount: feishu.pendingCount,
  };
}

/** feishu 链路 → 授权态（off = lark-cli 未配置 → 未授权横幅；失效信号未有承载位，v1 恒 false） */
function authFromLinks(links: readonly DiagnosticsLink[]): { authorized: boolean; expired: boolean } {
  const feishu = links.find((l) => l.provider === "feishu");
  return { authorized: feishu?.level !== "off", expired: false };
}

/** 名录行命中：简/繁名按原文包含、英文与 key 小写包含、编号精确等值 */
function matchesRow(row: CatalogRow, query: string, lower: string): boolean {
  const [id, key, hans, hant, en] = row;
  return (
    hans.includes(query) ||
    hant.includes(query) ||
    en.toLowerCase().includes(lower) ||
    key.toLowerCase().includes(lower) ||
    String(id) === lower
  );
}

/** 换装搜索（1025 只名录本地搜索：名称/繁名/英文名/key/编号包含匹配，上限 30 条） */
export function createPokemonSearch(locale: Locale): (query: string) => Promise<PokemonCandidate[]> {
  const nameOf = (row: CatalogRow): string => (locale === "zh-Hant" ? row[3] : locale === "en" ? row[4] : row[2]);
  return (query) => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed === "") {
      return Promise.resolve([]);
    }
    const hits: PokemonCandidate[] = [];
    for (const row of CATALOG) {
      if (matchesRow(row, trimmed, lower)) {
        hits.push({ key: row[1], name: nameOf(row), number: row[0], english: row[4] });
        if (hits.length >= 30) {
          break;
        }
      }
    }
    return Promise.resolve(hits);
  };
}

/** 信封结果 → data（失败/异常统一回落缺省值——单项读失败不拖垮整页的取数件） */
function dataOf<T>(result: PkyResult<T> | null, fallback: T): T {
  return result?.ok === true ? result.data : fallback;
}

/** 快照各任务段合并去重（组件契约 = 全量 Task[] + model 纯函数重分组，与 host 分段一致） */
function snapshotTasks(snapshot: PanelSnapshot | null): Task[] {
  if (snapshot === null) {
    return [];
  }
  const segments: Task[] = [
    ...snapshot.adventure.active,
    ...snapshot.adventure.dueToday,
    ...snapshot.adventure.overdue,
    ...snapshot.grass,
    ...snapshot.route,
    ...snapshot.dex.done,
    ...snapshot.dex.cancelled,
  ];
  const seen = new Set<number>();
  const merged: Task[] = [];
  for (const task of segments) {
    if (!seen.has(task.id)) {
      seen.add(task.id);
      merged.push(task);
    }
  }
  return merged;
}

/** 快照五分组消息合成（client suggestionGroups 会重分组——顺序仅组内展示序） */
function snapshotMessages(snapshot: PanelSnapshot | null): PanelData["messages"] {
  if (snapshot === null) {
    return [];
  }
  return [
    ...snapshot.radio.pending,
    ...snapshot.radio.none,
    ...snapshot.radio.error,
    ...snapshot.radio.escaped,
    ...snapshot.radio.accepted,
  ];
}

/** 组装面板快照（读命令并行、逐项兜底；实体段从 panelSnapshot 灌入） */
export async function fetchPanelData(client: HostClient): Promise<PanelData> {
  const [configR, dbR, diagR, filtersR, promptsR, snapR] = await Promise.all([
    client.configRead({}).catch(() => null),
    client.dbStatus().catch(() => null),
    client.diagnosticsSnapshot().catch(() => null),
    client.filterList().catch(() => null),
    client.promptList().catch(() => null),
    client.panelSnapshot().catch(() => null),
  ]);
  const config = dataOf(configR, { keyValues: {} as Record<string, string> }).keyValues;
  const links = dataOf(diagR, { links: [] as DiagnosticsLink[] }).links;
  const snapshot = snapR?.ok === true ? snapR.data : null;
  return {
    locale: localeOf(config),
    today: localToday(),
    tasks: snapshotTasks(snapshot),
    categories: snapshot?.categories ?? [],
    messages: snapshotMessages(snapshot),
    health: snapshot?.radio.health ?? healthFromLinks(links),
    auth: authFromLinks(links),
    followups: {},
    dispatches: {},
    sessions: snapshot?.logs ?? [],
    routes: routesOf(config),
    config,
    dbStatus: dataOf(dbR, null as PanelData["dbStatus"]),
    agents: agentsOf(config),
    promptSpecs: dataOf(promptsR, { specs: [] as NonNullable<PanelData["promptSpecs"]> }).specs,
    filters: dataOf(filtersR, { chats: [], counts: {}, lastPollAt: null }).chats,
    filterLastPollAt: dataOf(filtersR, { chats: [], counts: {}, lastPollAt: null }).lastPollAt ?? null,
    pokemonSearch: createPokemonSearch(localeOf(config)),
  };
}
