CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    note TEXT,
    category_id INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'inbox',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_at TEXT,
    remind_at TEXT,
    reminded INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'local',
    external_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    focus_seconds INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    cancelled_at TEXT,
    -- 派发状态机（AGENT_DISPATCH_PROPOSAL §8）：NULL=从未派发 / queued / running / done / failed
    dispatch_state TEXT,
    -- 最近一次派发的 agent 会话 id（claude --session-id/--resume 续接用）
    dispatched_session TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(remind_at) WHERE remind_at IS NOT NULL AND reminded = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pokemon TEXT NOT NULL,
    sprite TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    provider TEXT NOT NULL,
    cursor TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider)
);

CREATE TABLE IF NOT EXISTS tag_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- single（任务上至多 1 个该维度标签）/ multi
    cardinality TEXT NOT NULL DEFAULT 'multi',
    -- 该维度标签数上限（防碎片化；AI 新建标签前对照剩余名额）
    max_tags INTEGER NOT NULL DEFAULT 20,
    sort INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- 归属维度（tag_dimensions.id）；DEFAULT 4 = topic：存量行与未指明维度的 INSERT 归主题
    dimension_id INTEGER NOT NULL DEFAULT 4,
    -- manual / ai / nl / agent（谁建的，治理审计用）
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT '',
    -- 派发路由元数据（JSON，仅 project 维度标签使用）：{workdir, agentId, context}，
    -- 见 docs/proposals/AGENT_DISPATCH_PROPOSAL.md §4.1
    meta TEXT,
    UNIQUE (dimension_id, name)
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS task_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);

CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    -- create / update / start / pause / demote / delete / sync_pull / sync_push / sync_close / migrate
    action TEXT NOT NULL,
    field TEXT NOT NULL DEFAULT '',
    old_value TEXT,
    new_value TEXT,
    origin TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    chat_name TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    suggested_title TEXT,
    suggested_category TEXT,
    suggested_due TEXT,
    suggested_priority TEXT,
    suggested_note TEXT,
    suggested_tags TEXT NOT NULL DEFAULT '[]',
    ai_status TEXT NOT NULL DEFAULT 'pending',
    review_status TEXT NOT NULL DEFAULT 'pending',
    task_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    chat_type TEXT NOT NULL DEFAULT '',
    sender_id TEXT NOT NULL DEFAULT '',
    sent_at INTEGER,
    is_self INTEGER NOT NULL DEFAULT 0,
    update_task_id INTEGER,
    followup_task_id INTEGER,
    suggested_reason TEXT,
    suggested_confidence TEXT,
    ai_agent TEXT NOT NULL DEFAULT '',
    dismiss_reason TEXT NOT NULL DEFAULT '',
    content_anon TEXT NOT NULL DEFAULT '',
    at_me TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, sent_at);

CREATE TABLE IF NOT EXISTS feishu_users (
    open_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT ''
);
-- 代号唯一（空串豁免）：懒分配的防碰撞锚点，见 anonymize 模块
CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_users_alias
    ON feishu_users(alias) WHERE alias != '';

CREATE TABLE IF NOT EXISTS chat_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_message_id INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    ai_action TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    reason_code TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_message ON chat_feedback(chat_message_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    agent_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    session_id TEXT,
    command TEXT,
    exit_code INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',
    duration_ms INTEGER,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    -- 会话来源（'' = 早期记录 / 未标注）：classify 收音机分类 / capture 快速捕捉 /
    -- dispatch_headless 无头派发 / dispatch_interactive 交互派发 / pk agent 侧补录
    kind TEXT NOT NULL DEFAULT '',
    -- 执行时工作目录快照：本地 = 展开后的绝对路径；远程 = 远端路径串（'' = 登录目录）。
    -- 回放按此目录路由，不随 agent 配置后续变更漂移
    workdir TEXT NOT NULL DEFAULT '',
    -- 远程交互派发的 tmux 会话名（重连用）；无头 / 本地交互为空串
    tmux_session TEXT NOT NULL DEFAULT '',
    -- 执行时 agent 远端快照（remote_host 空 = 本地执行）：回放到当时的机器，不受配置变更影响
    remote_host TEXT NOT NULL DEFAULT '',
    remote_port INTEGER NOT NULL DEFAULT 0,
    remote_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);

-- 用户手动过滤偏好（飞书会话过滤）：always_filter / always_pull；「跟随」不落库（无行即跟随）
CREATE TABLE IF NOT EXISTS chat_filter_prefs (
    chat_id TEXT PRIMARY KEY,
    preference TEXT NOT NULL CHECK (preference IN ('always_filter','always_pull')),
    updated_at TEXT NOT NULL
);

-- 最近一轮拉取快照（管理界面唯一数据源，行随每轮整表替换生灭）；
-- 快照时间是轮级事实，不设行级列（唯一载体 = settings 键 feishu_snapshot_at，零会话轮无行可携带）
CREATE TABLE IF NOT EXISTS feishu_chats (
    chat_id TEXT PRIMARY KEY,
    chat_name TEXT NOT NULL DEFAULT '',
    chat_type TEXT NOT NULL DEFAULT '',
    -- muted / unmuted / unknown（unknown = 所在查询批次失败，降级不过滤）
    mute_outcome TEXT NOT NULL CHECK (mute_outcome IN ('muted','unmuted','unknown'))
);
