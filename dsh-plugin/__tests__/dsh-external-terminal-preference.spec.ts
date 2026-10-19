/**
 * dsh/externalTerminal · 终端偏好解析（从 dsh-external-terminal.spec.ts 拆出——棘轮
 * max-lines，等量迁移）：共享设置 terminal_preference（值域对齐主应用 + dsh 增设
 * kitty）命中且已安装时优先于探测链；未装/未知值/default → 链回落（零中断）；
 * 载体闸门同探测链（web 载体偏好也命中不了）。
 */
import { describe, expect, it } from "vitest";
import { resolveExternalTerminal } from "../src/host/dsh/externalTerminal";
import { fakeEnv } from "./dshExternalTerminalFakes";

describe("终端偏好解析 · 命中优先", () => {
  it("偏好 iterm2 且已安装 → iTerm2（压过探测链首位 Ghostty）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "iTerm2" });
    expect(resolveExternalTerminal("iterm2", env)?.label).toBe("iTerm2");
  });

  it("偏好 ghostty → Ghostty（即使探测链更靠前的 kitty 也在场仍命中偏好）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "kitty" || name === "Ghostty" });
    expect(resolveExternalTerminal("ghostty", env)?.label).toBe("Ghostty");
  });

  it("偏好 kitty（dsh 增设值）→ kitty", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "kitty" });
    expect(resolveExternalTerminal("kitty", env)?.label).toBe("kitty");
  });
});

describe("终端偏好解析 · 回落与闸门", () => {
  it("偏好的终端未安装 → 探测链回落（零中断）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    expect(resolveExternalTerminal("iterm2", env)?.label).toBe("Ghostty");
  });

  it("default / 未设 / 未知值 / 平台不适值（windows-terminal@darwin）→ 探测链", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "kitty" || name === "iTerm2" });
    expect(resolveExternalTerminal("default", env)?.label).toBe("kitty");
    expect(resolveExternalTerminal(null, env)?.label).toBe("kitty");
    expect(resolveExternalTerminal(undefined, env)?.label).toBe("kitty");
    expect(resolveExternalTerminal("made-up", env)?.label).toBe("kitty");
    expect(resolveExternalTerminal("windows-terminal", env)?.label).toBe("kitty");
  });
});

describe("终端偏好解析 · 载体闸门", () => {
  it("载体闸门同探测链：web 载体偏好也命中不了 → null", () => {
    const { env } = fakeEnv({ electron: false, appExists: () => true });
    expect(resolveExternalTerminal("ghostty", env)).toBeNull();
  });
});
