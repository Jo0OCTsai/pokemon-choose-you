/**
 * pet 域消息族（从 protocol.ts 拆出——棘轮 max-lines，等量迁移）：quotes 惰性集、
 * pet-event（提醒敲门/位置复位）、番茄相位快照与上行帧。protocol.ts 再出口保消费面。
 */
/** 番茄相位快照（D2 本地计时态唯一出口——chip 精确倒计时数据源；与 state/pomodoro PomoPhase 同构） */
export interface PomoPhaseSnapshot {
  kind: "focus" | "break" | "trial";
  endAt: number;
  durationMin?: number;
}

/**
 * 番茄相位上行：相位迁移（开始专注/先试/休息、到期置空）与每次 hello 后发送，
 * 宿主只保留最新一帧（不落库）；taskId = 发送时 activeTask（相位归属——chip 跨任务不串台）。
 */
export interface PomoStateMsg {
  type: "pomo-state";
  phase: PomoPhaseSnapshot | null;
  taskId: number | string | null;
  ts: number;
}

/** 每宝可梦自定义台词惰性下发（P1 D2：相关集 = 主宝可梦 + 进行中任务精灵，变化才发） */
export interface QuotesMsg {
  type: "quotes";
  map: Record<string, string[]>;
}

/** 桌宠事件下行（P1 D3/D6：提醒敲门/催促、位置复位） */
export interface PetEventMsg {
  type: "pet-event";
  kind: "reminder" | "reset-pos";
  /** reminder：目标任务（动作条完成/推迟回写用） */
  taskId?: number | string;
  /** reminder：任务标题（气泡文案插值） */
  title?: string;
  /** reminder：紧急优先级（urgent 底态 + 催促文案） */
  urgent?: boolean;
  /** reminder：分类精灵 key（缺省精灵名兜底） */
  pokemon?: string;
}
