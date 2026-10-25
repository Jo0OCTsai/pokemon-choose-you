/**
 * 迟到判定回看（judge.rs spawn_late_judgment_recheck / LATE_JUDGMENT_GRACE_SECS 同构）：
 * selfLanding 执行方失败（agent 超时被杀、非零退出）时失败挽救已把未落库行标 error，但其派出的
 * `pk suggest` 孤儿子进程常在数秒内自行落库——30s 后回查，error 已翻正为落库态即经 onWrites
 * 通知 UI 刷新（桌面 CHAT_MESSAGES_CHANGED 广播的 TS 等价物）。回看本身不写库。
 */
import type { Conn } from "../storage/db";

/** 回看宽限（LATE_JUDGMENT_GRACE_SECS = 30） */
export const LATE_JUDGMENT_GRACE_MS = 30_000;

export interface LateRecheckDeps {
  conn: Conn;
  /** 写后通知（UI/stateFeed 刷新）——翻正时的广播出口；缺省不回看 */
  onWrites?: () => void;
  /** 延迟调度（测试注入；缺省 setTimeout + unref） */
  scheduleLateRecheck?: (fn: () => void, delayMs: number) => void;
}

/** 缺省延迟调度：setTimeout + unref（宿主退出不被在途回看拖住） */
function defaultSchedule(fn: () => void, delayMs: number): void {
  const timer = setTimeout(fn, delayMs);
  (timer as { unref?: () => void }).unref?.();
}

/** 已落库判定计数（翻正只认 todo/update/followup/none——排除 pending/error/judging） */
function countLanded(conn: Conn, messageIds: string[]): number {
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS n FROM chat_messages WHERE ai_status IN ('todo','update','followup','none') " +
        `AND message_id IN (${messageIds.map(() => "?").join(",")})`,
    )
    .get(...messageIds) as { n: number };
  return Number(row.n);
}

/** 对失败挽救标 error 的行调度回看；连接已关（插件卸载）即放弃不炸宿主 */
export function scheduleLateRecheck(deps: LateRecheckDeps, missed: string[]): void {
  const { onWrites } = deps;
  if (missed.length === 0 || onWrites === undefined) {
    return;
  }
  (deps.scheduleLateRecheck ?? defaultSchedule)(() => {
    try {
      if (countLanded(deps.conn, missed) > 0) {
        onWrites();
      }
    } catch {
      // 连接已关闭（插件卸载）——回看放弃
    }
  }, LATE_JUDGMENT_GRACE_MS);
}
