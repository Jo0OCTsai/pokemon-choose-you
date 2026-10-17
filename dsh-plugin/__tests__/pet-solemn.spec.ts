/**
 * pet/solemn：郑重时刻判定与 TTS 派发（A30/FR-A7·B3）——纯函数判定（里程碑阈值跨界 /
 * 连胜演出条件 / 优先级互斥）+ 完成路径出声门控（pet_voice 默认静音、helper 缺席不发、
 * 仅本形态桥）。StreakProvider 以 fake 注入（domain/streak.ts 并行实现中——接口占位消费）。
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/host/pet/bridge";
import {
  crossedMilestone,
  isStreakCeremony,
  MILESTONES,
  speakSolemnOnCompletion,
  type SolemnContext,
  type StreakProvider,
} from "../src/host/pet/solemn";
import { setSetting } from "../src/host/domain/settings";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

const streakOf = (days: number, todayCount: number): StreakProvider => ({ read: () => ({ days, todayCount }) });

describe("里程碑判定（crossedMilestone，FR-B3 阈值集）", () => {
  it("跨界取该阈值；一次跨多档取最高；未跨界 null", () => {
    expect(MILESTONES).toEqual([10, 50, 100, 200, 500, 1000]);
    expect(crossedMilestone(9, 10)).toBe(10);
    expect(crossedMilestone(99, 100)).toBe(100);
    expect(crossedMilestone(49, 120)).toBe(100); // 跨 50 与 100 → 最高
    expect(crossedMilestone(100, 100)).toBeNull(); // 未跨新档
    expect(crossedMilestone(1000, 1200)).toBeNull(); // 超尾档不再演
    expect(crossedMilestone(20, 10)).toBeNull(); // 计数回退不算跨界
  });
});

describe("连胜演出判定（isStreakCeremony：今日首捕 && 连胜 ≥3）", () => {
  it("三条件矩阵", () => {
    expect(isStreakCeremony({ days: 3, todayCount: 1 })).toBe(true);
    expect(isStreakCeremony({ days: 5, todayCount: 1 })).toBe(true);
    expect(isStreakCeremony({ days: 2, todayCount: 1 })).toBe(false); // 连胜不足
    expect(isStreakCeremony({ days: 5, todayCount: 2 })).toBe(false); // 非今日首捕
    expect(isStreakCeremony({ days: 5, todayCount: 0 })).toBe(false);
  });
});

// ---- 出声派发（真实临时库 + fake host 桥） ----

interface SpeakRig {
  client: BridgeClient;
  spoken: string[];
  sayHello(caps: string[]): void;
}

function speakRig(): SpeakRig {
  const helperToHost = new PassThrough();
  const hostToHelper = new PassThrough();
  const spoken: string[] = [];
  const client = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined } });
  client.attach(helperToHost, hostToHelper);
  hostToHelper.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n")) {
      if (line.includes('"tts-speak"')) spoken.push((JSON.parse(line) as { text: string }).text);
    }
  });
  return {
    client,
    spoken,
    sayHello: (caps) => helperToHost.write(`${JSON.stringify({ type: "hello", version: "0.1", caps })}\n`),
  };
}

const buildText = (ctx: SolemnContext): string =>
  ctx.kind === "milestone" ? `图鉴 ${ctx.milestone} 只！` : `连胜 ${ctx.streakDays} 天！`;

describe("speakSolemnOnCompletion · 门控（A30：仅本形态出声）", () => {
  it("pet_voice 默认关（D26）→ 不发；开启后 helper 缺席 → 不发（静默）", () => {
    const rig = speakRig();
    rig.sayHello(["sys-tts"]);
    expect(
      speakSolemnOnCompletion(
        { conn: db.conn, streak: streakOf(5, 1), bridge: () => rig.client, buildText },
        { before: 9, after: 10 },
      ),
    ).toBe(false);
    setSetting(db.conn, "pet_voice", "true");
    expect(
      speakSolemnOnCompletion(
        { conn: db.conn, streak: streakOf(5, 1), bridge: () => null, buildText },
        { before: 9, after: 10 },
      ),
    ).toBe(false);
    expect(rig.spoken).toEqual([]);
  });

  it("无郑重时刻（无跨界且连胜不成立）→ 不发", () => {
    setSetting(db.conn, "pet_voice", "true");
    const rig = speakRig();
    rig.sayHello(["sys-tts"]);
    expect(
      speakSolemnOnCompletion(
        { conn: db.conn, streak: streakOf(2, 3), bridge: () => rig.client, buildText },
        { before: 10, after: 11 },
      ),
    ).toBe(false);
    expect(rig.spoken).toEqual([]);
  });
});

describe("speakSolemnOnCompletion · 判定与优先级", () => {
  it("里程碑优先（互不叠加）：跨 100 档只发里程碑台词", () => {
    setSetting(db.conn, "pet_voice", "true");
    const rig = speakRig();
    rig.sayHello(["sys-tts"]);
    const sent = speakSolemnOnCompletion(
      { conn: db.conn, streak: streakOf(7, 1), bridge: () => rig.client, buildText },
      { before: 99, after: 100 },
    );
    expect(sent).toBe(true);
    expect(rig.spoken).toEqual(["图鉴 100 只！"]); // 不叠加连胜演出
  });

  it("无跨界但连胜成立 → 连胜台词；sys-tts 能力位缺位 → 不发", () => {
    setSetting(db.conn, "pet_voice", "true");
    const capable = speakRig();
    capable.sayHello(["sys-tts"]);
    expect(
      speakSolemnOnCompletion(
        { conn: db.conn, streak: streakOf(4, 1), bridge: () => capable.client, buildText },
        { before: 30, after: 31 },
      ),
    ).toBe(true);
    expect(capable.spoken).toEqual(["连胜 4 天！"]);
    const incapable = speakRig();
    incapable.sayHello(["sys-notify"]);
    expect(
      speakSolemnOnCompletion(
        { conn: db.conn, streak: streakOf(4, 1), bridge: () => incapable.client, buildText },
        { before: 30, after: 31 },
      ),
    ).toBe(false);
  });
});
