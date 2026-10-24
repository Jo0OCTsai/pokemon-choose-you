/**
 * 时刻台词（FR-B2）+ 时段问候（FR-B5）调度（从 renderer.ts 拆出——棘轮 max-lines，
 * 等量迁移；消费面 renderer.ts 的启动段）：台词存储 localStorage（不可用退内存），
 * 首次见面日基准载入，2.5s 首查 + 30s 周期。
 */
import {
  LineDedup,
  birthdayOf,
  companionDays,
  lineDedupKey,
  pickTimeLine,
  timeLinesBlocked,
} from "../state/timeLines.ts";
import { InMemoryGreetStorage, PeriodGreeter, type GreetStorage } from "../state/greetings.ts";
import { fill, greetingLine, lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { withPokemonName } from "./pokemonName.ts";
import { showDialog } from "./dialog.ts";

const bridge = window.petBridge;

const timeLineDedup = new LineDedup(greetStorage());
const greeter = new PeriodGreeter(greetStorage(), () => new Date());

/** 台词存储：localStorage（桌面 pet.metOn/pet.greetedOn 同族键位；不可用退内存） */
function greetStorage(): GreetStorage {
  try {
    return {
      get: (k) => window.localStorage.getItem(k),
      set: (k, v) => window.localStorage.setItem(k, v),
    };
  } catch {
    return new InMemoryGreetStorage(); // file:// 受限：本会话内各时段问候一次
  }
}

/** 首次见面日基准载入（无记录 = 现在写入；存储受限退会话内基准） */
export function loadMetOn(): void {
  try {
    const stored = window.localStorage.getItem("pcy-met-on");
    if (stored) {
      mirror.metAt = Number(stored) || Date.now();
      return;
    }
    window.localStorage.setItem("pcy-met-on", String(Date.now()));
    mirror.metAt = Date.now();
  } catch {
    mirror.metAt = Date.now(); // 存储受限：本会话内基准
  }
}

/** 启动调度（问候之后不久补一次时刻检查——桌面同拍；此后 30s 周期） */
export function startPetSchedules(): void {
  setTimeout(checkTimeLines, 2_500);
  setInterval(checkTimeLines, 30_000);
}

function checkTimeLines(): void {
  const now = new Date();
  // 时段问候先行（早/午/晚/深夜各一次——睡着/演出/对话不插话）
  if (!timeLinesBlocked(lineGate()) && !mirror.petState.asleep) {
    const period = greeter.due();
    if (period !== null) sayGreeting(period);
  }
  if (timeLinesBlocked(lineGate())) return;
  const birthday = birthdayOf(mirror.metAt);
  const key = pickTimeLine(now, { birthday });
  if (!key) return;
  if (!timeLineDedup.consume(lineDedupKey(key, now))) return;
  sayTimeLine(key, now);
}

function lineGate() {
  return {
    asleep: mirror.petState.asleep,
    urgent: false, // helper 无 urgent 底态（U10 降级）——闸门位保留对齐桌面语义
    chatOpen: mirror.chatOpen,
    sceneBusy: mirror.sceneBusy,
    dragging: mirror.petState.transient === "dragging",
    quickOpen: mirror.quickOpen,
  };
}

function sayGreeting(period: "morning" | "day" | "evening" | "night"): void {
  const text = greetingLine(lines(mirror.lang), periodHour(period));
  void withPokemonName((name) => showDialog(fill(text, { p: name }), { tone: "event" }));
}

/** 时段 → 代表小时（greetingLine 反查用——与 greetPeriod 时段带同源） */
function periodHour(period: "morning" | "day" | "evening" | "night"): number {
  if (period === "morning") return 8;
  if (period === "day") return 14;
  return period === "evening" ? 19 : 23;
}

function sayTimeLine(key: "birthday" | "night" | "friday" | "hour", now: Date): void {
  const set = lines(mirror.lang);
  if (key === "birthday") {
    const days = companionDays(mirror.metAt, now.getTime());
    void withPokemonName((name) => {
      const text = fill(set.birthdayLine, { p: name, n: days });
      showDialog(text, { tone: "event", blink: true });
      void bridge.speak(text); // 生日语音（桌面郑重四类之一——tts.enabled 门控在主进程）
    });
    return;
  }
  const text = key === "night" ? set.nightLine : key === "friday" ? set.fridayLine : set.hourLine;
  showDialog(text, { tone: "event" });
}
