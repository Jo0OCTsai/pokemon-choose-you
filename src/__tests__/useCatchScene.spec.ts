import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCatchScene } from "../composables/useCatchScene";
import { t } from "../i18n";

function makeScene(over: { hasMate?: () => boolean } = {}) {
  const calls = {
    say: [] as { text: string; isNew: boolean }[],
    speak: [] as string[],
    stars: [] as number[],
    micros: [] as string[],
    mateLeaves: 0,
  };
  const ctl = useCatchScene({
    say: (text, isNew = false) => calls.say.push({ text, isNew }),
    speak: (text) => calls.speak.push(text),
    burstStars: (n) => calls.stars.push(n),
    runMicro: (a) => calls.micros.push(a),
    hasMate: () => false,
    onMateLeave: () => calls.mateLeaves++,
    ...over,
  });
  return { ctl, calls };
}

/** 普通捕捉 opts（单球，无里程碑/连胜/收工） */
const NORMAL = { pokemon: "皮卡丘", title: "写周报", milestone: null, allDone: false, streak: null };

describe("useCatchScene 捕捉演出", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove("reduce-motion");
  });
  afterEach(() => vi.useRealTimers());

  it("三段式时序：prep → 掷球(hide) → land → shake(600ms) → 星星 + 收尾台词，总长 1370ms 后释放 busy", async () => {
    const { ctl, calls } = makeScene();
    const p = ctl.runCatchScene(NORMAL);
    expect(ctl.sceneBusy.value).toBe(true);
    expect(ctl.catchPhase.value).toBe("prep");
    expect(calls.say[0]).toEqual({ text: t("pet.throwing", { p: "皮卡丘" }), isNew: true });

    await vi.advanceTimersByTimeAsync(120);
    expect(ctl.catchBalls.value).toEqual([{ phase: "fly", side: 0 }]);
    expect(ctl.catchPhase.value).toBe("hide");

    await vi.advanceTimersByTimeAsync(300);
    expect(ctl.catchBalls.value[0].phase).toBe("land");

    await vi.advanceTimersByTimeAsync(350);
    expect(ctl.catchBalls.value[0].phase).toBe("shake");

    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(ctl.sceneBusy.value).toBe(false);
    expect(ctl.catchPhase.value).toBeNull();
    expect(ctl.catchBalls.value).toEqual([]);
    expect(calls.stars).toEqual([6]);
    expect(calls.say.at(-1)).toEqual({ text: t("pet.catchOk", { p: "皮卡丘", t: "写周报" }), isNew: true });
    expect(vi.getTimerCount()).toBe(0); // 演出结束无残留定时器
  });

  it("演出中任意按下可跳过：不掷球不造星，直接收尾但台词仍播报", async () => {
    const { ctl, calls } = makeScene();
    const p = ctl.runCatchScene(NORMAL);
    ctl.requestSkip();
    expect(ctl.sceneBusy.value).toBe(true); // 只是标记，时序照走
    await vi.advanceTimersByTimeAsync(1400);
    await p;
    expect(ctl.catchBalls.value).toEqual([]); // 从未掷球
    expect(calls.stars).toEqual([]); // 不造星
    expect(ctl.sceneBusy.value).toBe(false);
    expect(calls.say.at(-1)).toEqual({ text: t("pet.catchOk", { p: "皮卡丘", t: "写周报" }), isNew: true });
  });

  it("非演出期 requestSkip 不生效：下一场演出照常进行（skipScene 在开场重置）", async () => {
    const { ctl } = makeScene();
    ctl.requestSkip(); // sceneBusy=false → 不标记
    const p = ctl.runCatchScene(NORMAL);
    await vi.advanceTimersByTimeAsync(120);
    expect(ctl.catchBalls.value).toEqual([{ phase: "fly", side: 0 }]); // 未被跳过
    await vi.advanceTimersByTimeAsync(1400);
    await p;
    expect(ctl.sceneBusy.value).toBe(false);
  });

  it("连胜双球变体：左右交替三摇、14+6 双份星星、streak 台词（总长 ≤2.2s）", async () => {
    const { ctl, calls } = makeScene();
    const p = ctl.runCatchScene({ ...NORMAL, streak: 5 });
    expect(ctl.streakScene.value).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(ctl.catchBalls.value.map((b) => b.side)).toEqual([-1, 1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(ctl.catchBalls.value.every((b) => b.phase === "land")).toBe(true);
    await vi.advanceTimersByTimeAsync(350); // 第一摇：左球
    expect(ctl.catchBalls.value.find((b) => b.side === -1)!.phase).toBe("shake");
    await vi.advanceTimersByTimeAsync(350); // 左回位，右球摇
    expect(ctl.catchBalls.value.find((b) => b.side === -1)!.phase).toBe("land");
    expect(ctl.catchBalls.value.find((b) => b.side === 1)!.phase).toBe("shake");
    await vi.advanceTimersByTimeAsync(3 * 350); // 第二轮两摇走完（t=2170ms）
    await vi.advanceTimersByTimeAsync(150); // 二次星星延迟
    await p;
    expect(ctl.sceneBusy.value).toBe(false);
    expect(ctl.streakScene.value).toBe(false);
    expect(calls.stars).toEqual([14, 6]);
    expect(calls.say.at(-1)).toEqual({ text: t("pet.streakN", { n: 5 }), isNew: true });
    expect(calls.speak).toEqual([t("pet.streakN", { n: 5 })]);
  });

  it("里程碑：12 星 + 里程碑台词与语音", async () => {
    const { ctl, calls } = makeScene();
    const p = ctl.runCatchScene({ ...NORMAL, milestone: 10 });
    await vi.advanceTimersByTimeAsync(1400);
    await p;
    expect(calls.stars).toEqual([12]);
    expect(calls.say.at(-1)).toEqual({ text: t("pet.milestone", { p: "皮卡丘", n: 10 }), isNew: true });
    expect(calls.speak).toEqual([t("pet.milestone", { p: "皮卡丘", n: 10 })]);
  });

  it("收工（allDone）：hop 庆祝 + 语音，陪跑精灵 700ms 后离场", async () => {
    const { ctl, calls } = makeScene({ hasMate: () => true });
    const p = ctl.runCatchScene({ ...NORMAL, allDone: true });
    await vi.advanceTimersByTimeAsync(1400);
    await p;
    expect(calls.micros).toEqual(["hop"]);
    expect(calls.say.at(-1)).toEqual({ text: t("pet.allDone", { p: "皮卡丘" }), isNew: true });
    expect(calls.speak).toEqual([t("pet.allDone", { p: "皮卡丘" })]);
    expect(calls.mateLeaves).toBe(0); // 送客定时器未到
    vi.advanceTimersByTime(700);
    expect(calls.mateLeaves).toBe(1);
    expect(vi.getTimerCount()).toBe(0); // 全链路结束无残留
  });
});
