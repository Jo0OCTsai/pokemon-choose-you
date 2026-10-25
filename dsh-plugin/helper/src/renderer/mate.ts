/**
 * 陪跑精灵（FR-B4，语义移植 PetApp mate watch/inviteMate）：专注满 25 分钟一位
 * 图鉴宝可梦来陪坐（排除当前与主宝可梦，候选空回退伊布）；一次专注会话一位一次；
 * 零台词零数值（桌面纪律）——title 提示与挥手告别是仅有的交互面。
 *
 * 候选池 = 图鉴已捕捉精灵（sys-config.pet.dexCaught 下行，桌面 api.dexStats 同口径；
 * 空集回退内置六只——sprites.ts 单源）。排除当前任务精灵与主宝可梦。
 * enabled：sys-config.pet.mate 下行投影（pet_mate 共享键，默认关）。
 */
import { mateSessionReset, pickMateSprite, shouldInviteMate } from "../state/mate.ts";
import { DEFAULT_BUILTIN } from "../sprites.ts";
import { lines } from "./lines.ts";
import { mirror, type Snapshot } from "./mirror.ts";
import { refs } from "./refs.ts";

let mate: { sprite: string; phase: "walk" | "sit" | "wave" } | null = null;
let shownThisSession = false;
let pomoWasRunning = false;

/** 每秒快照驱动：专注时长达标请一位；专注会话结束重置（下一场可再请） */
export function tickMate(snap: Snapshot): void {
  const running = snap.pomo !== null && snap.pomo.kind === "focus";
  if (mateSessionReset(running, pomoWasRunning)) shownThisSession = false;
  pomoWasRunning = running;
  const focusSec = running && snap.pomo ? (snap.pomo.durationMs - snap.pomo.msLeft) / 1000 : 0;
  if (
    shouldInviteMate({
      enabled: mirror.petConfig.mate,
      working: snap.petState.base === "working",
      focusSec,
      present: mate !== null,
      shownThisSession,
    })
  ) {
    shownThisSession = true;
    invite();
  }
}

async function invite(): Promise<void> {
  // 候选池 = 图鉴已捕捉（P2 缺口5：sys-config.pet.dexCaught；空集回退内置六只）
  const pool = mirror.petConfig.dexCaught.length > 0 ? mirror.petConfig.dexCaught : DEFAULT_BUILTIN.map((e) => e.key);
  const exclude = [mirror.lastTask?.categoryPokemon ?? "", mirror.petConfig.mainPokemon || "pikachu"];
  const sprite = pickMateSprite(pool, exclude);
  mate = { sprite, phase: mirror.reducedMotion ? "sit" : "walk" }; // reducedMotion 直接 sit 相位
  renderMate();
  if (!mirror.reducedMotion) {
    setTimeout(() => {
      if (mate?.phase === "walk") {
        mate.phase = "sit";
        renderMate();
      }
    }, 650);
  }
}

/** 点它挥手告别（离场 wave 620ms；reducedMotion 即离） */
export function mateLeave(): void {
  if (!mate || mate.phase === "wave") return;
  mate.phase = "wave";
  renderMate();
  setTimeout(
    () => {
      mate = null;
      renderMate();
    },
    mirror.reducedMotion ? 0 : 620,
  );
}

function renderMate(): void {
  refs.mateTitle.textContent = mate ? lines(mirror.lang).mateHint : "";
  refs.mate.classList.toggle("on", mate !== null);
  refs.mate.className = `pet-mate${mate ? ` ${mate.phase} on` : ""}`;
  if (mate) refs.mateImg.src = `pokemon/${mate.sprite}.gif`;
}

refs.mate.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  mateLeave();
});
