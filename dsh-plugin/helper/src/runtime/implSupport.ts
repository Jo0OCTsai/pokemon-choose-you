/**
 * runtime 实现支撑件（从 runtime/impl.ts 拆出——棘轮 max-lines，等量迁移）：
 * 版本/能力位单源 + 任务驻留判定 + 上行 uuid 缺省 + 出发/收尾台词发射（显式依赖注入）。
 */
import type { ActiveTask } from "../bridge/protocol.ts";
import type { Lang } from "../bridge/protocol.ts";
import type { SpriteResolver } from "../sprites.ts";
import type { BubbleTone } from "./index.ts";
import LINES, { formatCatching, formatSettledElsewhere } from "./lines.ts";

export const HELPER_VERSION = "0.1.0";
/** 基础能力位（hello 携带；sys 系统能力位由 sys router 动态并入——impl 构造/变更时发送） */
export const HELPER_CAPS = [
  "task-state",
  "pomodoro-local",
  "focus-settle",
  "quick-dex",
  "sprite-fallback",
  "reduced-motion",
] as const;

/** 仍在进行中驻留（active/paused）的任务，否则 null */
export function residencyTask(task: ActiveTask | null): ActiveTask | null {
  if (!task) return null;
  return task.status === "active" || task.status === "paused" ? task : null;
}

export function defaultUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ls-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 出发/收尾台词发射（UIUX §3.4）：出发双气泡；外部收尾（跨形态打断 D16）一次性中性气泡 */
export function emitTaskBubbles(deps: {
  resolver: SpriteResolver;
  lang: Lang;
  quitIntended: boolean;
  bubble: (text: string, tone: BubbleTone) => void;
  prev: ActiveTask | null;
  next: ActiveTask | null;
}): void {
  const prevId = deps.prev ? deps.prev.id : null;
  const nextActive = residencyTask(deps.next);
  if (nextActive && prevId !== nextActive.id) {
    const p = deps.resolver.pokemonName(nextActive.categoryPokemon, deps.lang);
    const title = nextActive.title;
    deps.bubble(LINES.chooseYou(deps.lang), "event");
    setTimeout(() => deps.bubble(formatCatching(deps.lang, p, title), "info"), 900);
  } else if (prevId !== null && !nextActive && !deps.quitIntended) {
    deps.bubble(formatSettledElsewhere(deps.lang, deps.prev?.title ?? ""), "info");
  }
}
