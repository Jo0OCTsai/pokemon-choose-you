/**
 * 番茄相位最新帧（helper `pomo-state` 上行的宿主侧内存承载，不落库）：D2 本地计时态
 * 的唯一下行出口——petStatus 随行给 conversation chip 精确倒计时 / 短休息态。
 * 到期帧按 now 判空（helper 的到期置空消息由 1s tick 判定，可能迟到一拍）。
 */
import type { PomoStateMsg } from "../../../helper/src/bridge/protocol";

export interface PomoPhaseView {
  kind: "focus" | "break" | "trial";
  /** 到期时刻（RFC3339） */
  endAt: string;
  /** focus 档位分钟（break/trial 无） */
  durationMin: number | null;
  /** 相位归属任务（helper 发送时的 activeTask；null = 无归属） */
  taskId: number | string | null;
}

export class PomoStateStore {
  private latest: PomoStateMsg | null = null;

  set(msg: PomoStateMsg): void {
    this.latest = msg;
  }

  reset(): void {
    this.latest = null;
  }

  view(now = Date.now()): PomoPhaseView | null {
    const latest = this.latest;
    if (latest === null || latest.phase === null || latest.phase.endAt <= now) {
      return null;
    }
    return {
      kind: latest.phase.kind,
      endAt: new Date(latest.phase.endAt).toISOString(),
      durationMin: latest.phase.durationMin ?? null,
      taskId: latest.taskId,
    };
  }
}
