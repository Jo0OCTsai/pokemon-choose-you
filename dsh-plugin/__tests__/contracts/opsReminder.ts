/**
 * 契约 op · 提醒 / 连胜面（Rust oracle 同名 op 的 TS 镜像，PROTOCOL §5 补记）：
 * reminder_tick / reminder_claim 直接驱动 src/host/reminder 域原语（与 Rust oracle
 * 直调 scheduler.rs 抽取原语同构，禁止第二套语义）；streak_eval 直调 domain/streak
 * 纯核心。reminder_tick 的 now 缺省 = 场景 now（ctx.now）；时区 = now 自带偏移
 * （datetime-local 解析与勿扰本地时刻都按此时区——oracle `*dt.offset()` 同口径）。
 */
import { parseDay, streakEval } from "../../src/host/domain/streak";
import {
  claimReminded,
  duePrecise,
  formatRfc3339Utc,
  loadReminderSettings,
  parseRfc3339,
  queryDueRows,
  type Reminder,
} from "../../src/host/reminder/query";
import { decideDelivery } from "../../src/host/reminder/aggregate";
import type { OpFn } from "./harness";
import { run, TagError } from "./opsTask";

/** reminder_tick：设置快照 → 粗筛 → 精判 → CAS 抢占 → 勿扰滤网 + 聚合文案 */
const reminderTick: OpFn = (ctx, args) =>
  run(() => {
    const nowStr = typeof args.now === "string" ? args.now : ctx.now;
    const parsed = parseRfc3339(nowStr);
    if (parsed === null) {
      throw new TagError(`now-invalid:${nowStr}`);
    }
    const conn = ctx.conn(ctx.route);
    const settings = loadReminderSettings(conn);
    const nowLeadMs = parsed.epochMs + settings.leadMinutes * 60_000;
    const rows = queryDueRows(conn, formatRfc3339Utc(nowLeadMs + 86_400_000));
    const due = duePrecise(parsed.offsetMinutes, rows, nowLeadMs);
    const claimed = claimReminded(conn, due);
    // 勿扰判定的本地时刻 = now（未前移提前量）按其偏移折回的墙上钟（oracle 同款）
    const localMinutes = Math.floor((parsed.epochMs + parsed.offsetMinutes * 60_000) / 60_000) % 1440;
    const decision = decideDelivery(settings, claimed, localMinutes);
    return {
      due: due.map((r) => r.id),
      claimed: claimed.map((r) => r.id),
      delivered: decision.deliver.map((r) => r.id),
      quiet: decision.quiet,
      silenced: decision.silenced,
      notifyOn: settings.notifyOn,
      notification: decision.notification,
      pet: decision.pet,
    };
  });

/** reminder_claim：直接驱动 reminded CAS 原语（模拟「粗筛+精判已看到该任务」的抢占
 * 入口——锁 affected=0 让位语义，不受 SQL 预筛 reminded=0 掩盖） */
const reminderClaim: OpFn = (ctx, args) =>
  run(() => {
    if (!Array.isArray(args.taskIds)) {
      throw new TagError("task-ids-missing");
    }
    const taskIds = args.taskIds.filter((x): x is number => typeof x === "number");
    const conn = ctx.conn(ctx.route);
    const stmt = conn.prepare(
      "SELECT t.id, t.title, t.priority, c.pokemon FROM tasks t " +
        "LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?",
    );
    const candidates: Reminder[] = [];
    for (const id of taskIds) {
      const row = stmt.get(id) as Reminder | undefined;
      if (row === undefined) {
        throw new TagError("task-not-found");
      }
      candidates.push({ id: row.id, title: row.title, priority: row.priority, pokemon: row.pokemon });
    }
    const won = new Set(claimReminded(conn, candidates).map((r) => r.id));
    return {
      won: taskIds.filter((id) => won.has(id)),
      yielded: taskIds.filter((id) => !won.has(id)),
    };
  });

/** streak_eval：连胜纯核心直供（doneDays = done 本地日集合，today/todayCount 显式
 * 入参保证跨时区确定性——PROTOCOL §5 补记口径） */
const streakEvalOp: OpFn = (_ctx, args) =>
  run(() => {
    const today = args.today;
    if (typeof today !== "string") {
      throw new TagError("today-missing");
    }
    if (parseDay(today) === null) {
      throw new TagError(`today-invalid:${today}`);
    }
    const doneDays = new Set(
      Array.isArray(args.doneDays)
        ? args.doneDays.filter((s): s is string => typeof s === "string" && parseDay(s) !== null)
        : [],
    );
    const todayCount = typeof args.todayCount === "number" ? args.todayCount : 0;
    return streakEval(doneDays, today, todayCount);
  });

/** 提醒 / 连胜面 op 表 */
export function reminderOps(): Record<string, OpFn> {
  return {
    reminder_tick: reminderTick,
    reminder_claim: reminderClaim,
    streak_eval: streakEvalOp,
  };
}
