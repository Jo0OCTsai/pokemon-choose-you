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
  /** 标签引用列表（后端聚合返回，按维度序：项目在前） */
  tags: TagRef[];
  /** 派发状态机（null=从未派发 / queued / running / done / failed） */
  dispatchState?: "queued" | "running" | "done" | "failed" | null;
  /** 最近一次派发的 agent 会话 id（claude --session-id/--resume 续接用） */
  dispatchedSession?: string | null;
}

/** 任务上挂的标签引用：名字 + 归属维度 key */
export interface TagRef {
  name: string;
  /** project / context / person / topic / 自定义维度 key；老数据缺省归 topic */
  dimension: string;
}

export interface Category {
  id: number;
  name: string;
  pokemon: string;
  sprite: string;
  /** 停用后不出现在新建/编辑与 AI 分类选项中，已有任务不受影响 */
  enabled: boolean;
}

/** project 标签的派发元数据（后端 tags.meta 列，JSON）：标签 → agent / 工作目录 / 项目上下文 */
export interface TagMeta {
  /** 派发工作目录（按 agent 位置解释：本地 = 本机路径，远程 = 远端路径；~ 前缀展开） */
  workdir?: string | null;
  /** 首选 agent（ai_agents 的 id；空 = 全局默认 agent） */
  agentId?: string | null;
  /** 项目的补充上下文（技术栈/注意事项），拼进派发 prompt */
  context?: string | null;
}

export interface Tag {
  id: number;
  name: string;
  description: string;
  /** 归属维度 key（project/context/person/topic/自定义）；老数据缺省归 topic */
  dimension: string;
  /** manual / ai / nl / agent（谁建的，治理审计用） */
  origin: string;
  /** 挂在多少个任务上（设置页治理展示） */
  usage: number;
  /** 创建时间（RFC3339；僵尸标签的年龄判定用）；老数据可能为空 */
  createdAt?: string;
  /** 派发元数据（仅 project 维度标签有值） */
  meta?: TagMeta | null;
}

/** 标签维度：一组正交的归类面（分面分类）。维度封闭少而稳，标签在维度内开放生长 */
export interface TagDimension {
  id: number;
  /** 稳定标识（AI 协议与 TagRef.dimension 用），内置 project/context/person/topic */
  key: string;
  /** 展示名（项目/场景/人物/主题…） */
  name: string;
  /** single（任务上至多 1 个）/ multi */
  cardinality: "single" | "multi" | string;
  /** 标签数上限（防碎片化） */
  maxTags: number;
  sort: number;
  /** 停用后不进新建/编辑与 AI 选项，已有标签不受影响 */
  enabled: boolean;
}

/** AI 建议的标签：名字 + 归属维度 + 是否词表外新建（isNew 时接受建议才落库） */
export interface ProposedTag {
  name: string;
  dimension: string;
  isNew: boolean;
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
  /** 变更来源：main / pet / radio / migration（历史数据可能还有已下线集成的 todoist） */
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
  suggestedTags: ProposedTag[];
  /** AI 判定理由（为什么是待办 / 为什么不算） */
  suggestedReason?: string | null;
  /** 置信档位 high / medium / low */
  suggestedConfidence?: string | null;
  /** 给出建议的 agent id（判定时刻记录，反馈落库时关联模型） */
  aiAgent?: string;
  /** pending / todo / none / followup / error */
  aiStatus: string;
  reviewStatus: "pending" | "accepted" | "dismissed";
  /** 逃走时选的原因码（duplicate/noise/…；直接逃走为空串）；撤销/恢复即清空 */
  dismissReason?: string;
  /** 该消息已创建的待办 id */
  taskId?: number | null;
  /** update 建议指向的目标待办 id（AI 判定消息是对该待办的变更） */
  updateTaskId?: number | null;
  /** followup 建议并入的目标待办 id（AI 已把消息记为该待办的跟进） */
  followupTaskId?: number | null;
  createdAt: string;
}

/** 收音机快速捕捉的结果：AI 判定后的消息 + todo 时自动落成的待办 id */
export interface CaptureOutcome {
  message: ChatMessage;
  /** action=todo 时已建的待办（撤销调 undoChatReview）；判重类结果为 null */
  taskId: number | null;
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

/** 会话过滤偏好三态（follow = 无手动记录，已由后端解析为显式值） */
export type FeishuChatFilterPreference = "follow" | "always_filter" | "always_pull";

/** 快照计数（摘要行 + 筛选 chips：全部/拉取/过滤/手动） */
export interface FilterCounts {
  total: number;
  pulling: number;
  filtered: number;
  manual: number;
}

/** 单会话过滤行视图：后端把「偏好 × 最近一轮拉取快照」合并后直出（前端零合并逻辑） */
export interface FeishuChatFilterView {
  chatId: string;
  chatName: string;
  /** group=群聊 / p2p=私聊 / bot=机器人（与 chat_messages.chat_type 同词表） */
  chatType: "group" | "p2p" | "bot";
  /** muted / unmuted / unknown（unknown = 上轮该会话所在免打扰查询批次失败） */
  muteOutcome: "muted" | "unmuted" | "unknown";
  /** 手动偏好（点击即写库即时生效，不进设置页保存缓冲） */
  preference: FeishuChatFilterPreference;
  /** pull / filter（filter_decision 现算派生，不落库） */
  effective: "pull" | "filter";
  /** manual / follow / followDegraded（followDegraded = 跟随态且查询失败降级） */
  source: "manual" | "follow" | "followDegraded";
  /** 快照时间 RFC3339（与信封 snapshotAt 同源；沉睡行视图为空串） */
  updatedAt: string;
}

/** 会话过滤总览（设置页「会话过滤」卡）：最近一轮拉取快照 + 偏好合并后的全部会话 */
export interface FeishuChatFilterOverview {
  chats: FeishuChatFilterView[];
  counts: FilterCounts;
  /** 本轮快照时间 RFC3339；null = 从未成功拉取（与「零会话账号」的区分载体） */
  snapshotAt: string | null;
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
  /** 常驻反向隧道：应用驻留期间保持 -R 长连（keepalive + 退避重连），远程随时可调 pk */
  persistent?: boolean | null;
}

/** AI agent CLI 配置（如 Claude Code / OpenCode / Kiro CLI / pi / Qoder CLI），可配置多个 */
export interface AgentConfig {
  id: string;
  name: string;
  /** 可执行文件名或绝对路径，如 claude / opencode / kiro / pi / qoder */
  command: string;
  /** 附加参数（空白分隔）；{prompt} 占位符替换为提示词，缺省时提示词可经标准输入传入 */
  args: string;
  /** 打开历史记录界面的参数，如 claude 的 --resume；空则直接启动 */
  historyArgs: string;
  /** 工作目录：agent 及其工具的相对路径基准，支持 ~ 前缀；空 = ~/.choose-you（远程模式为远程机器上的路径，留空时落在远端登录目录） */
  workdir?: string;
  /** 单次调用超时（秒） */
  timeoutSecs: number;
  enabled: boolean;
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

/** 常驻反向隧道状态（后端 tunnel_status）：state = off / connecting / healthy / retrying */
export interface TunnelStatus {
  state: string;
  detail: string;
}

/** agent 技能检查结果（本地直读；远程经 ssh 读远端目录） */
export interface AgentSkillStatus {
  agentId: string;
  /** 技能目标类型（claude-code / opencode / kiro / pi / qoder） */
  kind: string;
  /** 技能目录（本地绝对路径；远程为 $HOME 相对路径） */
  dir: string;
  /** 远程机器（null = 本机） */
  remoteHost: string | null;
  installed: boolean;
  installedVersion: string | null;
  /** 应用内置的技能版本 */
  bundledVersion: string;
  upToDate: boolean;
}

/** agent 技能安装/同步结果 */
export interface AgentSkillInstallResult {
  agentId: string;
  kind: string;
  dir: string;
  remoteHost: string | null;
  /** 安装前的旧版本（null = 首次安装） */
  previousVersion: string | null;
  version: string;
  updated: boolean;
}

/** 集成链路健康（诊断页展示）：飞书 / AI */
export interface IntegrationHealth {
  provider: "feishu" | "ai";
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

/** 批量重判「AI 判定失败」的结果：ok = 重新拿到判定的条数，仍失败的逐条汇报 */
export interface RetryAiResult {
  ok: number;
  failed: { id: number; error: string }[];
}

/** 派发确认弹窗里的可改选 agent（启用的） */
export interface DispatchAgentOption {
  id: string;
  name: string;
  /** SSH 目标（null = 本机） */
  sshHost: string | null;
}

/** 派发目标解析结果（任务抽屉展示：agent · 机器 · 目录 · 来源） */
export interface TaskDispatchTarget {
  taskId: number;
  hasProjectTag: boolean;
  projectTag: string | null;
  /** pick（弹窗改选）/ tag（标签 meta 指定）/ default（全局默认） */
  source: string;
  agentId: string | null;
  agentName: string | null;
  sshHost: string | null;
  /** 生效工作目录（空 = 本地 ~/.choose-you / 远端登录目录） */
  workdir: string;
  context: string | null;
  /** 可改选的启用 agent 列表 */
  agents: DispatchAgentOption[];
}

/** 派发结果：channel=interactive/headless；terminal 为唤起的终端程序名（无头为 null）；
 * state 为派发后的状态（running=已启动待回传 / done / failed） */
export interface DispatchResult {
  channel: string;
  terminal: string | null;
  note: string | null;
  session: AgentSession;
  state: string;
}

/** 标签体检（复盘向导）：相似度预筛 + 僵尸标签 + LLM 复核与新维度建议 */
export interface TagCheckupReport {
  merges: {
    fromId: number;
    fromName: string;
    intoId: number;
    intoName: string;
    dimension: string;
    /** 本地预筛相似度 0~1 */
    similarity: number;
    /** LLM 是否已复核（false = 仅相似度预筛，未配置 agent 或判定失败） */
    judged: boolean;
    reason?: string | null;
  }[];
  zombies: { id: number; name: string; dimension: string; origin: string; createdAt: string }[];
  newDimensions: { name: string; tags: string[]; reason?: string | null }[];
  /** LLM 是否参与了本次判定 */
  judged: boolean;
}
