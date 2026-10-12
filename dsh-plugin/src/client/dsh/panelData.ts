/**
 * PanelData 组装（Phase B 适配层数据面）：HostClient 读命令 → 面板快照。
 *
 * 50 命令面（Phase A 上线）只含触发类写命令 + 六个读面（configRead / dbStatus /
 * diagnosticsSnapshot / filterList / promptList / logQuery——logQuery 由诊断分区页内
 * 自查）；任务/建议/会话/派发/跟进/分类等实体清单没有对应读命令，本层以空集装配
 * （组件空态呈现），读命令补齐是后续接面（docs/debt.md 已记）。agents 与派发路由
 * 从共享设置键解析（`ai_agents` / `dsh:dispatch_routes` JSON——与主应用「前端整读」
 * 同构）；收音机健康与授权态从 diagnostics feishu 链路派生（epoch 毫秒 → RFC3339，
 * 避免 client timeOf 对 number 取 slice 崩溃）；换装搜索内置主应用 catalog.json
 * （@app-pokemon alias 零拷贝直引，54KB 静态名录随 bundle 分发）。
 */
import catalogJson from "@app-pokemon/catalog.json";
import type { AgentConfig } from "../../host/domain/settings";
import type { HostClient, PkyResult } from "../rpc";
import type { DiagnosticsLink, DispatchRoute, RadioHealth } from "../rpcTypes";
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

/** 组装面板快照（读命令并行、逐项兜底；实体清单空集见文件头） */
export async function fetchPanelData(client: HostClient): Promise<PanelData> {
  const [configR, dbR, diagR, filtersR, promptsR] = await Promise.all([
    client.configRead({}).catch(() => null),
    client.dbStatus().catch(() => null),
    client.diagnosticsSnapshot().catch(() => null),
    client.filterList().catch(() => null),
    client.promptList().catch(() => null),
  ]);
  const config = dataOf(configR, { keyValues: {} as Record<string, string> }).keyValues;
  const links = dataOf(diagR, { links: [] as DiagnosticsLink[] }).links;
  return {
    locale: localeOf(config),
    today: localToday(),
    tasks: [],
    categories: [],
    messages: [],
    health: healthFromLinks(links),
    auth: authFromLinks(links),
    followups: {},
    dispatches: {},
    sessions: [],
    routes: routesOf(config),
    config,
    dbStatus: dataOf(dbR, null as PanelData["dbStatus"]),
    agents: agentsOf(config),
    promptSpecs: dataOf(promptsR, { specs: [] as NonNullable<PanelData["promptSpecs"]> }).specs,
    filters: dataOf(filtersR, { chats: [], counts: {} }).chats,
    pokemonSearch: createPokemonSearch(localeOf(config)),
  };
}
