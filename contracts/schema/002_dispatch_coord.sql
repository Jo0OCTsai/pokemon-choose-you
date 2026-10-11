-- 002 · 双形态派发与判定协调（specs/dsh-plugin 并行组 0）
-- 依赖：001_v1 基线。两条增量：
--   ① dispatch_slots：机器级派发并发槽租约表（跨形态全局计数，FR-X1）。
--      领取派发时插入、收口时删除、崩溃后过期回收（A6：租约时长 = 无头超时 + 5 分钟余量）。
--   ② chat_messages.judge_claimed_at：判定 claim 协议的时间戳令牌（A22）。
--      判定发起方把 pending → judging 时写入；落态 UPDATE 携带 claim 守卫，迟到结果按令牌失配丢弃。
-- 迁移铁律：只追加，不修改已发布条目（含 001 基线）。
CREATE TABLE IF NOT EXISTS dispatch_slots (
    -- 'local' 或 'ssh:user@host[:port]'（host_key 归一，跨形态合计计数的键）
    host_key TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    -- 持有方标识：'app' / 'dsh'（崩溃排障用，不参与互斥判定）
    owner TEXT NOT NULL DEFAULT '',
    acquired_at TEXT NOT NULL,
    -- 崩溃自愈：超过该时刻的租约可被回收（扫描方删行不计入并发）
    lease_expires_at TEXT NOT NULL,
    PRIMARY KEY (host_key, task_id)
);
CREATE INDEX IF NOT EXISTS idx_dispatch_slots_lease ON dispatch_slots(lease_expires_at);

ALTER TABLE chat_messages ADD COLUMN judge_claimed_at TEXT NOT NULL DEFAULT '';
