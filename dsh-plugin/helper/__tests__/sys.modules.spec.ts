import { describe, expect, it } from "vitest";
import type { UpstreamMsg } from "../src/bridge/protocol.ts";
import type { SysContext } from "../src/sys/context.ts";
import { HeadlessDialogs } from "../src/sys/dialogs.ts";
import { HeadlessInputCount } from "../src/sys/inputCount.ts";
import { HeadlessMacAuth } from "../src/sys/macAuth.ts";
import { HeadlessNotify } from "../src/sys/notify.ts";
import { HeadlessOpenPath } from "../src/sys/openPath.ts";
import { HeadlessShortcuts } from "../src/sys/shortcuts.ts";
import { HeadlessTray } from "../src/sys/tray.ts";
import { HeadlessTts } from "../src/sys/tts.ts";
import { defaultTooltip, trayLabels } from "../src/sys/labels.ts";

/**
 * sys/ 模块族单测（headless 记录器 = no-op 记录器 + 可编程结果；Electron API 胶水的
 * 真机冒烟归 4.5）。ctx 捕获上行消息序列供断言。
 */
function makeCtx(startAt = 0): { ctx: SysContext; emitted: UpstreamMsg[]; diags: string[]; t: { now: number } } {
  const clock = { now: startAt };
  const emitted: UpstreamMsg[] = [];
  const diags: string[] = [];
  return {
    ctx: {
      emit: (msg) => {
        emitted.push(msg);
        return true;
      },
      diag: (tag, detail) => diags.push(`${tag}:${detail}`),
      now: () => clock.now,
    },
    emitted,
    diags,
    t: clock,
  };
}

describe("HeadlessTray（FR-A1）", () => {
  it("tooltip/lang/可见性记录；左键与菜单动作上行 tray-action", () => {
    const { ctx, emitted } = makeCtx();
    const tray = new HeadlessTray(ctx);
    tray.setTooltip("皮卡丘在值班");
    tray.setLang("zh-Hant");
    tray.click("open");
    tray.click("pet-toggle");
    tray.click("settings");
    expect(tray.records.tooltip).toBe("皮卡丘在值班");
    expect(tray.records.lang).toBe("zh-Hant");
    expect(emitted.map((m) => (m as { action: string }).action)).toEqual(["open", "pet-toggle", "settings"]);
  });

  it("退出需一次确认：取消不上行、确认上行 quit", () => {
    const { ctx, emitted } = makeCtx();
    const tray = new HeadlessTray(ctx);
    tray.pickQuit(false);
    expect(emitted).toHaveLength(0);
    tray.pickQuit(true);
    expect(emitted).toEqual([{ type: "tray-action", action: "quit" }]);
  });
});

describe("HeadlessShortcuts（FR-A2）", () => {
  it("注册成功后触发上行 shortcut-fired", () => {
    const { ctx, emitted } = makeCtx();
    const sc = new HeadlessShortcuts(ctx);
    sc.fire("capture"); // 未注册不发
    expect(emitted).toHaveLength(0);
    sc.configure({ capture: "CmdOrCtrl+Shift+K", togglePet: "CmdOrCtrl+Shift+D" });
    expect(sc.registered).toBe(true);
    sc.fire("capture");
    sc.fire("togglePet");
    expect(emitted).toEqual([
      { type: "shortcut-fired", id: "capture" },
      { type: "shortcut-fired", id: "togglePet" },
    ]);
  });

  it("注册失败（被占用）→ 不注册、触发不发（降级经诊断面）", () => {
    const { ctx, emitted, diags } = makeCtx();
    const sc = new HeadlessShortcuts(ctx);
    sc.failNext = true;
    sc.configure({ capture: "A", togglePet: "B" });
    expect(sc.registered).toBe(false);
    sc.fire("capture");
    expect(emitted).toHaveLength(0);
    expect(diags.some((d) => d.includes("register failed"))).toBe(true);
  });
});

describe("HeadlessNotify（FR-A3/A4）", () => {
  it("送达记录 + 点击上行 notify-clicked（观测留痕）", () => {
    const { ctx, emitted } = makeCtx();
    const n = new HeadlessNotify(ctx);
    n.show("reminder", "该捉「交周报」了", "皮卡丘");
    n.show("overdue", "草丛", "");
    expect(n.records.map((r) => r.kind)).toEqual(["reminder", "overdue"]);
    n.clickLast();
    expect(emitted).toEqual([{ type: "notify-clicked", kind: "overdue" }]);
  });
});

describe("HeadlessTts（FR-A7/D26）", () => {
  it("默认静音；enabled 后播报记录", () => {
    const { ctx } = makeCtx();
    const tts = new HeadlessTts(ctx);
    tts.speak("捕捉成功");
    expect(tts.records.spoken).toHaveLength(0);
    tts.setEnabled(true);
    tts.speak("捕捉成功");
    expect(tts.records.spoken).toEqual(["捕捉成功"]);
  });
});

describe("HeadlessDialogs（FR-A5 seq 两段）", () => {
  it("request → 秒级 ack + 默认 canceled 结果；可编程 paths 结果", () => {
    const { ctx, emitted } = makeCtx();
    const d = new HeadlessDialogs(ctx);
    d.request({ type: "dialog-request", mode: "open-file", seq: 1 });
    d.nextResult = { canceled: false, paths: ["/tmp/a.json"] };
    d.request({ type: "dialog-request", mode: "open-file", seq: 2, filters: [{ name: "json", extensions: ["json"] }] });
    expect(emitted).toEqual([
      { type: "dialog-ack", seq: 1 },
      { type: "dialog-result", seq: 1, canceled: true },
      { type: "dialog-ack", seq: 2 },
      { type: "dialog-result", seq: 2, canceled: false, paths: ["/tmp/a.json"] },
    ]);
  });

  it("cancel 记录（迟到结果丢弃语义在 electron 实现侧）", () => {
    const { ctx } = makeCtx();
    const d = new HeadlessDialogs(ctx);
    d.cancel(9);
    expect(d.cancels).toEqual([9]);
  });
});

describe("HeadlessOpenPath（FR-A6）", () => {
  it("记录路径", () => {
    const { ctx, diags } = makeCtx();
    const op = new HeadlessOpenPath(ctx);
    op.open("/data/exports");
    expect(op.records).toEqual(["/data/exports"]);
    expect(diags.some((d) => d.includes("/data/exports"))).toBe(true);
  });
});

describe("HeadlessMacAuth（FR-A9）", () => {
  it("query → ack + result（默认未授权）", () => {
    const { ctx, emitted } = makeCtx();
    const auth = new HeadlessMacAuth(ctx);
    auth.query({ type: "mac-auth-query", kind: "accessibility", seq: 7 });
    expect(emitted).toEqual([
      { type: "mac-auth-ack", seq: 7 },
      { type: "mac-auth-result", seq: 7, kind: "accessibility", granted: false },
    ]);
  });

  it("撤销/恢复 → seq 0 主动上报 + onAuthChange 回调（inputCount 停启接线面）", () => {
    const { ctx, emitted } = makeCtx();
    const auth = new HeadlessMacAuth(ctx, { granted: true });
    const changes: boolean[] = [];
    auth.onAuthChange((g) => changes.push(g));
    auth.revoke();
    auth.grant();
    expect(emitted).toEqual([
      { type: "mac-auth-result", seq: 0, kind: "accessibility", granted: false },
      { type: "mac-auth-result", seq: 0, kind: "accessibility", granted: true },
    ]);
    expect(changes).toEqual([false, true]);
  });

  it("直达面板 30s 节流（未授权查询的引导面）", () => {
    const { ctx, diags } = makeCtx(0);
    const auth = new HeadlessMacAuth(ctx);
    auth.query({ type: "mac-auth-query", kind: "accessibility", seq: 1 });
    auth.query({ type: "mac-auth-query", kind: "accessibility", seq: 2 });
    expect(diags.filter((d) => d.includes("open accessibility pane"))).toHaveLength(1);
  });
});

describe("HeadlessInputCount（FR-A9/AD §4.4）", () => {
  it("开启条件：enabled + granted + darwin 三者缺一零监听", () => {
    const { ctx } = makeCtx(0);
    const ic = new HeadlessInputCount(ctx, { platform: "darwin", granted: false });
    ic.configure({ enabled: true });
    expect(ic.running).toBe(false); // 未授权
    ic.onAuthChange(true);
    expect(ic.running).toBe(true); // 授权到 → 起监
    ic.onAuthChange(false);
    expect(ic.running).toBe(false); // 撤销即停
  });

  it("非 macOS 永不启动（D32）", () => {
    const { ctx } = makeCtx(0);
    const ic = new HeadlessInputCount(ctx, { platform: "linux", granted: true });
    ic.configure({ enabled: true });
    expect(ic.running).toBe(false);
    ic.feed();
    ic.tick();
    expect(ic.records.emitted).toHaveLength(0);
  });

  it("计数 → cps 上行 ≥1s 节流", () => {
    const { ctx, emitted, t } = makeCtx(0);
    const ic = new HeadlessInputCount(ctx, { platform: "darwin", granted: true });
    ic.configure({ enabled: true });
    for (let i = 0; i < 5; i++) ic.feed();
    t.now = 0;
    ic.tick();
    t.now = 500; // 节流窗口内
    ic.tick();
    t.now = 1_100;
    ic.tick();
    const activities = emitted.filter((m) => m.type === "input-activity");
    expect(activities).toHaveLength(2);
    expect((activities[0] as { cps: number }).cps).toBe(5);
  });

  it("未运行时 feed/tick 不上行", () => {
    const { ctx, emitted } = makeCtx(0);
    const ic = new HeadlessInputCount(ctx, { platform: "darwin", granted: false });
    ic.feed();
    ic.tick();
    expect(emitted).toHaveLength(0);
  });
});

describe("托盘三语文案（UIUX §8）", () => {
  it("三语键集齐备 + tooltip 缺省回退", () => {
    for (const lang of ["zh-Hans", "zh-Hant", "en"] as const) {
      const set = trayLabels(lang);
      expect(set.open.length).toBeGreaterThan(0);
      expect(set.hidePet).not.toBe(set.showPet);
      expect(set.quitMessage.length).toBeGreaterThan(0);
    }
    expect(trayLabels("zh-Hans").open).toBe("打开图鉴机");
    expect(trayLabels("en").open).toBe("Open Pokédex");
    expect(defaultTooltip("zh-Hant")).toBe("就決定是你了");
    expect(defaultTooltip("en")).toBe("I choose you!");
  });
});
