/**
 * 注意力友好默认值断言（NFR-6，UIUX §2.4 默认值清单）：
 * - 面板零闪烁：client CSS 无 animation/blink 声明（闪烁名额唯一保留给桌宠 ▼，不在面板）
 * - 计数静态：分段计数无 aria-live/弹跳动画
 * - 打断类开关默认全关：对主应用 SETTING_DEFAULTS 借用键断言（读仓内 settings.ts 单源，
 *   不经运行时 import——store 模块依赖 pinia）
 * - dsh 侧无系统通知/弹窗/主动发言通路（源码扫描：无 Notification/alert/confirm/setInterval）
 * - conversation chip 无进行中零占位（见 chip.spec；此处补源码层声明）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = join(__dirname, "../..");
const clientDir = join(pluginRoot, "src/client");

function collectFiles(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (ext.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("面板零闪烁（NFR-6：动效即信息——闪烁名额归桌宠）", () => {
  it("client CSS Modules 无 animation 声明、无 blink 关键字（徽标状态靠形与色）", () => {
    const cssFiles = collectFiles(clientDir, /\.module\.css$/);
    expect(cssFiles.length).toBeGreaterThanOrEqual(5);
    const offenders: string[] = [];
    for (const file of cssFiles) {
      // 去注释后扫描（注释里的「无 animation 声明」说明文字不算违规）
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/\banimation\b/.test(source) || /blink/i.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders, `面板侧出现闪烁类动画声明：${offenders.join(", ")}`).toEqual([]);
  });
});

describe("打断类默认全关（对 SETTING_DEFAULTS 借用键断言）", () => {
  /** 主应用 SETTING_DEFAULTS 单源（src/stores/settings.ts）——读源断言，不 import（pinia 依赖） */
  const storeSource = readFileSync(join(pluginRoot, "../src/stores/settings.ts"), "utf8");

  function defaultValueOf(key: string): string | undefined {
    const match = new RegExp(`${key}:\\s*"([^"]*)"`).exec(storeSource);
    return match?.[1];
  }

  it("dsh 消费的行为开关默认关：飞书轮询/桌宠输入响应×2/语音/陪跑/自动派发", () => {
    // 这些是会「出声/动起来」的打断类行为；默认全关（NFR-6 打断类默认开启数 = 0）
    for (const key of [
      "feishu_enabled",
      "pet_input_response",
      "pet_input_response_working",
      "pet_voice",
      "pet_mate",
      "dispatch_auto_enabled",
    ]) {
      expect(defaultValueOf(key), `SETTING_DEFAULTS 缺 ${key}`).toBeDefined();
      expect(defaultValueOf(key)).toBe("false");
    }
  });

  it("减弱动效默认跟随系统（reduce_motion=false，U15）", () => {
    expect(defaultValueOf("reduce_motion")).toBe("false");
  });
});

describe("dsh 侧无系统通知 / 弹窗 / 定时打断通路（源码扫描）", () => {
  const sources = collectFiles(clientDir, /\.(ts|tsx|css)$/);

  it("无 Notification / window.alert / window.confirm（弹窗与系统通知零通路，D1）", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      if (/new Notification|window\.alert|window\.confirm|\balert\(/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("无 setInterval（无周期性自动动作；番茄为各形态本地计时，不由面板驱动）", () => {
    const offenders = sources.filter((file) => readFileSync(file, "utf8").includes("setInterval"));
    expect(offenders).toEqual([]);
  });

  it("setTimeout 仅用于瞬态自隐（toast/保存 hint），不触发任务状态机动作", () => {
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/setTimeout\(([^)]*)\)/g)) {
        expect(match[1]).not.toMatch(/taskStart|taskComplete|dispatchInteractive/);
      }
    }
  });
});

describe("计数静态（被动信号不强调）", () => {
  it("SegmentNav 计数样式无动画与 aria-live 通道（静态数字直接变）", () => {
    const cssSource = readFileSync(join(clientDir, "app/app.module.css"), "utf8");
    const block = cssSource.slice(
      cssSource.indexOf(".segmentCount {"),
      cssSource.indexOf("}", cssSource.indexOf(".segmentCount {")),
    );
    expect(block).toBeTruthy();
    expect(/animation/.test(block)).toBe(false);
    const navSource = readFileSync(join(clientDir, "app/SegmentNav.tsx"), "utf8");
    expect(navSource).not.toContain("aria-live");
  });
});
