export interface Task {
  id: number;
  title: string;
  note?: string | null;
  categoryId: number;
  /** inbox=草丛 / scheduled=路线 / active=进行中 / paused=暂停 / done=已完成 / cancelled=已逃走 */
  status: "inbox" | "scheduled" | "active" | "paused" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string | null;
  remindAt?: string | null;
  reminded: boolean;
  source: string;
  externalId?: string | null;
  createdAt: string;
  completedAt?: string | null;
  /** 首次出发时间；无截止时间且从未开始的任务归入草丛 */
  startedAt?: string | null;
  /** 逃走（取消）时间 */
  cancelledAt?: string | null;
  focusSeconds: number;
  /** 标签名列表（后端聚合返回） */
  tags: string[];
}

export interface Category {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  /** 停用后不出现在新建/编辑与 AI 分类选项中，已有任务不受影响 */
  enabled: boolean;
}

export interface Tag {
  id: number;
  name: string;
  description: string;
}

export interface TaskNote {
  id: number;
  taskId: number;
  content: string;
  source: "manual" | "ai" | string;
  createdAt: string;
}

/** 任务操作日志（后端 task_logs 表，编辑弹窗展示历史用） */
export interface TaskLog {
  id: number;
  taskId: number;
  /** create / update / start / pause / demote / delete / sync_pull / sync_push / sync_close / migrate */
  action: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  /** 变更来源：main / pet / radio / todoist / migration */
  origin: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  messageId: string;
  chatName: string;
  sender: string;
  content: string;
  /** 会话 id（同会话消息用于拼 AI 上下文）；老数据为空 */
  chatId?: string;
  /** p2p=单聊 / group=群聊 / bot=与机器人的单聊；老数据为空 */
  chatType?: string;
  /** 发送者 open_id（应用消息为应用 id） */
  senderId?: string;
  /** 消息发送时间（毫秒时间戳）；老数据为空 */
  sentAt?: number | null;
  /** 是否当前授权用户自己发的 */
  isSelf?: boolean;
  suggestedTitle?: string | null;
  suggestedCategory?: string | null;
  suggestedDue?: string | null;
  suggestedPriority?: string | null;
  suggestedNote?: string | null;
  suggestedTags: string[];
  /** AI 判定理由（为什么是待办 / 为什么不算） */
  suggestedReason?: string | null;
  /** 置信档位 high / medium / low */
  suggestedConfidence?: string | null;
  /** 给出建议的 agent id（判定时刻记录，反馈落库时关联模型） */
  aiAgent?: string;
  /** pending / todo / none / followup / error */
  aiStatus: string;
  reviewStatus: "pending" | "accepted" | "dismissed";
  /** 该消息已创建的待办 id */
  taskId?: number | null;
  /** update 建议指向的目标待办 id（AI 判定消息是对该待办的变更） */
  updateTaskId?: number | null;
  /** followup 建议并入的目标待办 id（AI 已把消息记为该待办的跟进） */
  followupTaskId?: number | null;
  createdAt: string;
}

/** Agent 会话记录：分类调用与 agent 代办按次落库（agent_sessions 表） */
export interface AgentSession {
  id: number;
  /** 关联待办 id；null = 收音机分类等非任务场景 */
  taskId?: number | null;
  agentId: string;
  agentName: string;
  /** agent 工具的会话 id（如 claude 的 session_id），可回放转录 */
  sessionId?: string | null;
  command?: string | null;
  exitCode?: number | null;
  /** ok / error */
  status: string;
  durationMs?: number | null;
  /** 本次会话成本（美元） */
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  createdAt: string;
}

/** 数据备份快照（VACUUM INTO 产物，设置页展示与恢复） */
export interface BackupInfo {
  /** 备份文件名（pokemon-choose-you-YYYYMMDD-HHMMSS.db） */
  file: string;
  /** 字节数 */
  size: number;
  /** 备份时间（RFC3339） */
  createdAt: string;
}

/** 飞书用户授权状态（设置页展示） */
export interface FeishuOauthStatus {
  authorized: boolean;
  userName: string;
}

/** SSH 远程执行：agent CLI 装在远程机器上，本地经 `ssh host -- command` 无头调用 */
export interface AgentRemote {
  /** ssh 目标（user@host） */
  host: string;
  /** ssh 端口（默认 22） */
  port: number;
  /** 私钥路径（空走 ssh 默认） */
  keyPath?: string | null;
  /** 反向隧道端口：随 ssh 连接把远程侧 127.0.0.1:<port> 转回本机 sshd，供远程 pk shim 回连 */
  tunnel?: number | null;
}

/** AI agent CLI 配置（如 Claude Code / OpenCode / Kiro CLI），可配置多个 */
export interface AgentConfig {
  id: string;
  name: string;
  /** 可执行文件名或绝对路径，如 claude / opencode / kiro */
  command: string;
  /** 附加参数（空白分隔）；{prompt} 占位符替换为提示词，缺省时提示词可经标准输入传入 */
  args: string;
  /** 打开历史记录界面的参数，如 claude 的 --resume；空则直接启动 */
  historyArgs: string;
  /** 工作目录：agent 及其工具的相对路径基准，支持 ~ 前缀；空 = 应用数据目录（远程模式为远程机器上的路径，留空时落在远端登录目录） */
  workdir?: string;
  /** 单次调用超时（秒） */
  timeoutSecs: number;
  enabled: boolean;
  /** 分类结果回收方式：text=解析输出 JSON（缺省）；tools=agent 经 pk 工具落库、应用回读 */
  mode?: string;
  /** SSH 远程执行（null/缺省 = 本地执行） */
  remote?: AgentRemote | null;
}

/** 一键配置远程 pk 的逐步报告（后端 setup_remote_pk） */
export interface RemotePkStep {
  name: string;
  /** ok / skip（幂等复用）/ fail */
  status: string;
  detail: string;
}

export interface RemotePkReport {
  ok: boolean;
  steps: RemotePkStep[];
  /** 端到端验证拿回的远程 pk 版本 */
  version?: string | null;
}

/** 集成链路健康（诊断页展示）：飞书 / AI / Todoist */
export interface IntegrationHealth {
  provider: "feishu" | "ai" | "todoist";
  configured: boolean;
  /** 飞书的后台轮询开关；其余链路配置即启用 */
  enabled: boolean;
  /** off 未配置 / paused 已配置未启用 / idle 待运行 / ok 正常 / degraded 降级 / down 故障 */
  status: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  consecutiveFailures: number;
  /** 下次预计轮询时间（epoch 毫秒），仅飞书 */
  nextPollAt?: number | null;
  /** 飞书：收音机里待确认的建议数 */
  pendingCount: number;
  /** AI：收音机分类使用的 agent 名称 */
  primaryAgent: string;
}

/** 运行日志条目（tauri-plugin-log 默认格式解析而来） */
export interface LogEntry {
  time: string;
  /** debug / info / warn / error */
  level: string;
  target: string;
  message: string;
}

/** 批量分诊结果：逐条汇报，单条失败不影响其余 */
export interface BatchReviewResult {
  ok: number;
  failed: { id: number; error: string }[];
}
