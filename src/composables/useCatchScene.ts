import { ref } from "vue";
import { t } from "../i18n";
import { motionReduced } from "./usePetIdle";

/** 精灵球编队：普通捕捉单球居中；连胜双球左右交替三摇（F7） */
export interface CatchBall {
  phase: "fly" | "land" | "shake";
  side: -1 | 0 | 1;
}

export interface CatchSceneOpts {
  /** 开场/收尾台词气泡 */
  say: (text: string, isNew?: boolean) => void;
  /** 语音（F5）：只接四类「郑重时刻」 */
  speak: (text: string) => void;
  /** DOM 造星（挂在精灵命中区上）：留在组件内传入 */
  burstStars: (n: number) => void;
  /** 收工庆祝小动作（hop） */
  runMicro: (action: "hop") => void;
  /** 陪跑精灵在场（收工送客用） */
  hasMate: () => boolean;
  /** 陪跑精灵离场（挥手） */
  onMateLeave: () => void;
}

/**
 * 捕捉演出（juice 三段式）——从 PetApp 抽出的演出编排：
 * 预备 → 掷球 → 三摇 → 星星，≤1.5s 可跳过；连胜为双球变体 ≤2s。
 * 「减弱动态效果」下所有 waitMs 即时结算（时序保留、动画跳过）。
 */
export function useCatchScene(opts: CatchSceneOpts) {
  const sceneBusy = ref(false);
  const catchPhase = ref<null | "prep" | "hide">(null);
  const catchBalls = ref<CatchBall[]>([]);
  const streakScene = ref(false);
  let skipScene = false;
  const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, motionReduced() ? 0 : ms));

  /** 演出进行中任意按下 = 跳过（回应不打扰：演出永不绑架用户时间） */
  function requestSkip() {
    if (sceneBusy.value) skipScene = true;
  }

  async function runCatchScene(o: {
    pokemon: string;
    title: string;
    milestone: number | null;
    allDone: boolean;
    streak: number | null;
  }) {
    sceneBusy.value = true;
    skipScene = false;
    streakScene.value = o.streak != null;
    catchPhase.value = "prep";
    opts.say(t("pet.throwing", { p: o.pokemon }), true);
    await waitMs(120);
    const two = o.streak != null;
    if (!skipScene) {
      catchBalls.value = two
        ? [
            { phase: "fly", side: -1 },
            { phase: "fly", side: 1 },
          ]
        : [{ phase: "fly", side: 0 }];
      catchPhase.value = "hide";
    }
    await waitMs(300);
    if (!skipScene) catchBalls.value.forEach((b) => (b.phase = "land"));
    await waitMs(350);
    if (!skipScene) {
      if (two) {
        // 双球交替三摇（各 350ms × 2 轮；唯一允许超 1.5s 的演出，上限 2s）
        for (let round = 0; round < 2; round++) {
          for (const side of [-1, 1] as const) {
            const ball = catchBalls.value.find((b) => b.side === side);
            if (ball) ball.phase = "shake";
            await waitMs(350);
            if (ball) ball.phase = "land";
            if (skipScene) break;
          }
          if (skipScene) break;
        }
      } else {
        catchBalls.value[0].phase = "shake";
        await waitMs(600);
      }
    }
    const finish = () => {
      catchBalls.value = [];
      catchPhase.value = null;
      sceneBusy.value = false;
      streakScene.value = false;
    };
    if (skipScene) {
      finish();
    } else {
      opts.burstStars(two ? 14 : o.milestone ? 12 : 6);
      if (two && !motionReduced()) setTimeout(() => opts.burstStars(6), 150);
      finish();
    }
    if (o.allDone) {
      opts.say(t("pet.allDone", { p: o.pokemon }), true);
      opts.runMicro("hop");
      opts.speak(t("pet.allDone", { p: o.pokemon }));
      // 收工即送客：陪跑的客人跟着庆祝后离场（一次会话一位一次的尾声）
      if (opts.hasMate()) setTimeout(() => opts.onMateLeave(), 700);
    } else if (o.milestone) {
      opts.say(t("pet.milestone", { p: o.pokemon, n: o.milestone }), true);
      opts.speak(t("pet.milestone", { p: o.pokemon, n: o.milestone }));
    } else if (o.streak) {
      opts.say(t("pet.streakN", { n: o.streak }), true);
      opts.speak(t("pet.streakN", { n: o.streak }));
    } else {
      opts.say(t("pet.catchOk", { p: o.pokemon, t: o.title }), true);
    }
  }

  return { sceneBusy, catchPhase, catchBalls, streakScene, requestSkip, runCatchScene };
}
