/**
 * 共享配置键面（AD §5.2）：36 共享设置键全量读写 + `ai_agents` 列表条级 CRUD
 * （整读-改-整写 + 修订检测，A24）。提示词覆盖（ai_prompt_* 4 键）见
 * prompt-overrides.ts。SETTING_KEYS 与主应用 src/stores/settings.ts 逐字一致。
 */
import { txImmediate, type Conn } from "../storage/db";
import { PkyError, paramError } from "../storage/errors";

/**
 * 36 共享设置键全集（与主应用 src/stores/settings.ts SETTING_KEYS 逐字一致——
 * 测试断言键集相等；配置 100% 对齐，§8⑨）。键值面等效：两形态任一处改、另一处读同值。
 */
export const SETTING_KEYS = [
  "language",
  "pomodoro_enabled",
  "pomodoro_minutes",
  "break_minutes",
  "pomodoro_notify",
  "pomodoro_chime",
  "notifications_enabled",
  "remind_ahead_minutes",
  "quiet_hours_enabled",
  "quiet_start",
  "quiet_end",
  "reduce_motion",
  "overdue_mode",
  "date_format",
  "time_format",
  "due_relative",
  "close_to_tray",
  "backup_enabled",
  "backup_keep",
  "review_enabled",
  "review_dow",
  "main_pokemon",
  "pokemon_quotes",
  "pet_input_response",
  "pet_input_response_working",
  "pet_voice",
  "pet_mate",
  "feishu_poll_interval",
  "feishu_my_names",
  "ai_agents",
  "ai_agent_id",
  "terminal_preference",
  "dispatch_auto_enabled",
  "dispatch_max_concurrent",
  "dispatch_worktree",
  "feishu_enabled",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// ---- 基础读写 ----

/** 读一条设置（找不到 key 时返回 null） */
export function getSetting(conn: Conn, key: string): string | null {
  const row = conn.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** 写一条设置（INSERT OR REPLACE，与主应用 set_setting 同款） */
export function setSetting(conn: Conn, key: string, value: string): void {
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

/** 删一条设置行 */
export function deleteSetting(conn: Conn, key: string): void {
  conn.prepare("DELETE FROM settings WHERE key=?").run(key);
}

/** 批量读（keys 省略 = 全部行；dsh: 内部键与 ai_prompt_* 旁路键同路可读——主应用同口径） */
export function readSettings(conn: Conn, keys?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (keys === undefined) {
    for (const row of conn.prepare("SELECT key, value FROM settings").all() as Array<{
      key: string;
      value: string;
    }>) {
      out[row.key] = row.value;
    }
    return out;
  }
  const stmt = conn.prepare("SELECT value FROM settings WHERE key=?");
  for (const key of keys) {
    const row = stmt.get(key) as { value: string } | undefined;
    if (row !== undefined) {
      out[key] = row.value;
    }
  }
  return out;
}

/** 必须为正整数的数值键（写入校验口径；主应用同键语义） */
const POSITIVE_INT_KEYS = new Set([
  "pomodoro_minutes",
  "break_minutes",
  "remind_ahead_minutes",
  "backup_keep",
  "review_dow",
  "feishu_poll_interval",
  "dispatch_max_concurrent",
]);

/** HH:MM 形态的时钟键 */
const CLOCK_KEYS = new Set(["quiet_start", "quiet_end"]);

/**
 * 共享配置批量写入校验（CONFIG_VALIDATION_FAILED 的写入侧兜底——主应用校验在
 * 前端，插件面在 domain 层强校验）：键非空字符串、数值键为正整数、时钟键为 HH:MM。
 */
export function validateConfigWrite(keyValues: Record<string, string>): void {
  for (const [key, value] of Object.entries(keyValues)) {
    if (key.trim() === "") {
      throw new PkyError("CONFIG_VALIDATION_FAILED", "设置键不能为空");
    }
    if (POSITIVE_INT_KEYS.has(key) && (!/^\d+$/.test(value) || Number(value) < 1)) {
      throw new PkyError("CONFIG_VALIDATION_FAILED", `「${key}」必须为正整数`);
    }
    if (CLOCK_KEYS.has(key) && !/^\d{2}:\d{2}$/.test(value)) {
      throw new PkyError("CONFIG_VALIDATION_FAILED", `「${key}」必须为 HH:MM 格式`);
    }
  }
}

/** 批量写（单条 BEGIN IMMEDIATE 整批原子；校验先行） */
export function writeSettings(conn: Conn, keyValues: Record<string, string>): void {
  validateConfigWrite(keyValues);
  txImmediate(conn, () => {
    for (const [key, value] of Object.entries(keyValues)) {
      setSetting(conn, key, value);
    }
  });
}

// ---- agent 列表（ai_agents JSON 数组键：整读-改-整写，A24 ①） ----

/** 一个 AI agent CLI 的调用配置（与 ai/config.rs AgentConfig 字段一一对应） */
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  historyArgs: string;
  workdir: string;
  skillDir?: string | null;
  timeoutSecs: number;
  enabled: boolean;
  /**
   * 绑定的远程部署 alias（dsh 扩展字段，Rust 侧未知字段容忍）：非空 = 该 agent 派发到
   * 对应部署执行（执行世界单源；桌面 serde 与前端展开式回写均保留未知字段）。
   * 存在性校验在命令层（domain 不反向依赖 remote/）。
   */
  deployment?: string | null;
}

/** 从 ai_agents 设置解析 agent 列表（load_agents 同构：坏数据按未配置、空 command 过滤） */
export function loadAgents(conn: Conn): AgentConfig[] {
  const raw = getSetting(conn, "ai_agents") ?? "";
  let list: AgentConfig[] = [];
  try {
    list = JSON.parse(raw) as AgentConfig[];
    if (!Array.isArray(list)) {
      list = [];
    }
  } catch {
    list = [];
  }
  return list.filter((a) => (a.command ?? "").trim() !== "");
}

/**
 * agents 整写（remote/ 级联消费：部署改名级联更新 agent 绑定——执行世界单源）。
 * 落库前剥离退役的 remote 键（ADR-0003 AgentRemote 退役）：与 Rust 类型化往返
 * （无该字段即不序列化）字节对齐，契约 fixtures 依赖此口径。
 */
export function storeAgents(conn: Conn, agents: AgentConfig[]): void {
  const stripped = agents.map((a) => {
    const rest: AgentConfig = { ...(a as AgentConfig & { remote?: unknown }) };
    delete (rest as { remote?: unknown }).remote;
    return rest as AgentConfig;
  });
  setSetting(conn, "ai_agents", JSON.stringify(stripped));
}

function agentIdsSignature(agents: AgentConfig[]): string {
  return agents
    .map((a) => a.id)
    .sort()
    .join("\n");
}

/** expectedAgentIds 基线比对失配 → SETTING_MODIFIED_ELSEWHERE（A24：确认后 force 重发） */
function assertRevisionAgents(conn: Conn, expectedAgentIds: string[] | undefined, force: boolean): AgentConfig[] {
  const current = loadAgents(conn);
  if (
    !force &&
    expectedAgentIds !== undefined &&
    agentIdsSignature(current) !== agentIdsSignature(expectedAgentIds.map((id) => ({ id }) as AgentConfig))
  ) {
    throw new PkyError("SETTING_MODIFIED_ELSEWHERE", "agent 列表已在另一处被修改", "确认覆盖请带 force 重发整值");
  }
  return current;
}

export interface AgentUpsertOptions {
  expectedAgentIds?: string[];
  force?: boolean;
}

/**
 * agent 条级 upsert（A24 ①：单条 BEGIN IMMEDIATE 内「整读 → 比对 → 改 → 整写」
 * 原子完成；空 command 拒绝——对齐 load_agents 过滤语义，写入即需可读出）。
 * 返回保存后完整列表（前端零推导）。
 */
export function agentUpsert(conn: Conn, agent: AgentConfig, opts: AgentUpsertOptions = {}): AgentConfig[] {
  if ((agent.command ?? "").trim() === "") {
    throw new PkyError("AGENT_COMMAND_INVALID", "agent 命令不能为空", "填入可执行文件名或绝对路径");
  }
  if ((agent.id ?? "").trim() === "") {
    throw paramError("agent id 不能为空");
  }
  return txImmediate(conn, () => {
    const current = assertRevisionAgents(conn, opts.expectedAgentIds, opts.force ?? false);
    const idx = current.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      current[idx] = agent;
    } else {
      current.push(agent);
    }
    storeAgents(conn, current);
    return current;
  });
}

/**
 * agent 删除（修订检测同上）：「用于收音机分类」正指向被删 id 时 ai_agent_id 一并清空
 * （主应用现行前端行为同构化）。
 */
export function agentDelete(conn: Conn, id: string, opts: AgentUpsertOptions = {}): AgentConfig[] {
  return txImmediate(conn, () => {
    const current = assertRevisionAgents(conn, opts.expectedAgentIds, opts.force ?? false);
    const next = current.filter((a) => a.id !== id);
    if (next.length === current.length) {
      throw paramError(`agent ${id} 不存在`);
    }
    storeAgents(conn, next);
    if (getSetting(conn, "ai_agent_id") === id) {
      setSetting(conn, "ai_agent_id", "");
    }
    return next;
  });
}

/** 收音机分类使用的 agent：优先 ai_agent_id 指定的启用项，否则第一个启用项（primary_agent 同构） */
export function primaryAgent(conn: Conn): AgentConfig | null {
  const agents = loadAgents(conn);
  const preferred = getSetting(conn, "ai_agent_id") ?? "";
  return agents.find((a) => a.enabled && a.id === preferred) ?? agents.find((a) => a.enabled) ?? null;
}
