/** SpriteStage（UIUX §3.2）：精灵 104px pixelated、状态类、色环、微动作池、asleep 判定 */
import { fill, lines } from "./lines.ts";
import { mirror, type SpriteInfo } from "./mirror.ts";
import { refs } from "./refs.ts";
import { showDialog } from "./dialog.ts";

const bridge = window.petBridge;

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

/** 精灵候选链（onerror 逐级回退；耗尽 → 主宝可梦 png 兜底） */
export function setSprite(key: string): void {
  bridge
    .sprite(key)
    .then((raw: unknown) => applySpriteInfo(raw as SpriteInfo))
    .catch(() =>
      applySpriteInfo({
        res: {
          key,
          urls: ["pokemon/pikachu.gif", "pokemon/pikachu.png"],
          builtin: true,
          fallback: true,
        },
        missing: null,
        standInName: "Pikachu",
      }),
    );
}

function applySpriteInfo(info: SpriteInfo): void {
  applySpriteCandidates(info);
  if (info.missing) {
    // 双缺回退的单次「素材缺失」气泡（去重在 resolver.takeMissingEvent 侧）
    showDialog(fill(lines(mirror.lang).spriteMissing, { p: info.standInName }), { tone: "warn" });
  }
}

function applySpriteCandidates(info: SpriteInfo): void {
  const urls = [...info.res.urls];
  refs.sprite.dataset.standIn = info.res.fallback ? "1" : "0";
  const trySrc = (i: number): void => {
    if (i >= urls.length) {
      refs.sprite.src = "pokemon/pikachu.png"; // 终极兜底（内置必在）
      return;
    }
    refs.sprite.src = urls[i];
    refs.sprite.onerror = () => trySrc(i + 1);
  };
  trySrc(0);
}

/** 状态机类上屏（st-{base} / tr-{transient} / asleep / perched[FR-B1 姿态幅度减半]） */
export function applyPetState(): void {
  const s = mirror.petState;
  refs.stage.className = `stage st-${s.base}`;
  if (s.transient) refs.stage.classList.add(`tr-${s.transient}`);
  refs.stage.classList.toggle("asleep", s.asleep);
  refs.stage.classList.toggle("perched", mirror.perched && s.transient === null); // 拎起即离开
  refs.zzz.classList.toggle("on", s.asleep);
}

/** TimeRing（SVG 细环；绿→琥珀→红；reduced-motion 保留静态进度） */
export function updateRing(progress: { pct: number; tone: "green" | "amber" | "red" } | null): void {
  if (!progress) {
    refs.ring.classList.remove("on");
    return;
  }
  refs.ring.classList.add("on");
  refs.ring.dataset.tone = progress.tone;
  refs.ringFg.style.strokeDasharray = `${String(RING_C * progress.pct)} ${String(RING_C)}`;
}

// ---- 微动作池（眨眼/左右看/翻面/哈欠，加权 4~9s；working 只留眨眼且减频；双通道全停） ----
const MICRO: { cls: string; ms: number; w: number; workingOk: boolean }[] = [
  { cls: "m-blink", ms: 240, w: 5, workingOk: true },
  { cls: "m-look", ms: 900, w: 3, workingOk: false },
  { cls: "m-flip", ms: 600, w: 2, workingOk: false },
  { cls: "m-yawn", ms: 900, w: 1, workingOk: false },
];

function scheduleMicro(): void {
  const delay = 4_000 + Math.random() * 5_000;
  setTimeout(() => {
    playMicro();
    scheduleMicro();
  }, delay);
}
scheduleMicro();

function playMicro(): void {
  const s = mirror.petState;
  if (mirror.reducedMotion || s.asleep || s.transient) return;
  const pool = MICRO.filter((m) => (s.base === "working" ? m.workingOk : true));
  const pick = weightedPick(pool);
  if (!pick) return;
  // working 态眨眼减频：半数跳过本轮（专注时不打扰）
  if (s.base === "working" && pick.cls === "m-blink" && Math.random() < 0.5) return;
  refs.stage.classList.add(pick.cls);
  setTimeout(() => refs.stage.classList.remove(pick.cls), pick.ms);
}

function weightedPick(pool: typeof MICRO): (typeof MICRO)[number] | null {
  const total = pool.reduce((s, m) => s + m.w, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  return pool.find((m) => (roll -= m.w) <= 0) ?? pool[0];
}

// ---- asleep 判定（idle + 5min 无交互；任意交互揉眼醒来——台词在 renderer.ts 转换处） ----
setInterval(() => {
  const s = mirror.petState;
  if (s.base !== "idle" || s.transient || s.asleep) return;
  if (Date.now() - mirror.lastInteractAt >= 5 * 60_000) {
    mirror.petState = { ...s, asleep: true };
    applyPetState();
    showDialog(lines(mirror.lang).asleepHint); // FR-B5：入睡提示一次
  }
}, 5_000);
