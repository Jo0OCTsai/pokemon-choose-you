/**
 * 机械红线自证（NFR-13 / AD §4.3，进 CI）：直接加载本包真实 eslint.config.ts，
 * 断言 (a) 违规样例被规则命中、(b) 本仓 sys/renderer 现有源码零违规——
 * 「规则配置 + 代码审查断言注释面」的机器化版本（不是复制规则的影子断言）。
 */
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import * as fs from "node:fs";
import * as path from "node:path";
import config from "../eslint.config.ts";

const linter = new Linter({ configType: "flat" });

// tseslint FlatConfig 与 @eslint/core LanguageOptions 的结构类型差异（index signature）——
// 运行时同构，静态面以 never 收口（vitest 直跑 TS 源，verify 行为不受影响）
const flatConfig = config as never as Parameters<typeof linter.verify>[1];

function violations(code: string, filename: string): number {
  return linter.verify(code, flatConfig, { filename }).filter((m) => m.ruleId === "no-restricted-syntax").length;
}

function violationsInFile(rel: string): number {
  const abs = path.join(path.dirname(import.meta.url.replace("file://", "")), "..", rel);
  return violations(fs.readFileSync(abs, "utf8"), rel);
}

describe("NFR-13 只计数红线（sys/**：rawcode/keycode 禁入）", () => {
  it("违规样例：读取 ev.keycode / ev.rawcode 各命中一次", () => {
    const bad =
      "function f(ev: { keycode: number; rawcode: number }): number {\n  return ev.keycode + ev.rawcode;\n}\nf;";
    expect(violations(bad, "src/sys/inputCount.ts")).toBeGreaterThanOrEqual(2);
  });

  it("合规样例：零参计数回调零违规", () => {
    const ok = "const onKey = (): void => { count += 1; };";
    expect(violations(ok, "src/sys/inputCount.ts")).toBe(0);
  });

  it("现有 sys/ 源码零违规（inputCount.ts 唯一原生挂点）", () => {
    expect(violationsInFile("src/sys/inputCount.ts")).toBe(0);
    expect(violationsInFile("src/sys/index.ts")).toBe(0);
  });
});

describe("渲染层文本红线（renderer/**：innerHTML/insertAdjacentHTML 禁入）", () => {
  it("违规样例：innerHTML 赋值 + insertAdjacentHTML 调用命中", () => {
    const bad = 'el.innerHTML = text;\nel.insertAdjacentHTML("beforeend", text);';
    expect(violations(bad, "src/renderer/dialog.ts")).toBeGreaterThanOrEqual(2);
  });

  it("合规样例：textContent 赋值零违规", () => {
    const ok = "el.textContent = text;";
    expect(violations(ok, "src/renderer/dialog.ts")).toBe(0);
  });

  it("现有 renderer/ 源码零违规", () => {
    for (const file of ["src/renderer/renderer.ts", "src/renderer/dialog.ts", "src/renderer/menu.ts"]) {
      expect(violationsInFile(file)).toBe(0);
    }
  });
});
