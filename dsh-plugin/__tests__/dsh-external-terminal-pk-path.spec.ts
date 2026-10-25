/**
 * dsh/externalTerminalAdapter · 本机 pk PATH 前缀（从 dsh-external-terminal.spec 拆出——
 * 棘轮 max-lines）：交互派发注入行经用户登录 shell 执行（外部终端窗口 / copy-line 粘贴），
 * 不吃 childEnvFor 的子进程 PATH 注入——落位在场时命令行本体前插 export PATH
 * （localPkPathPrefix 单源）；缺席空串，行为不变。
 */
import { describe, expect, it } from "vitest";
import { createExternalTerminalAdapter } from "../src/host/dsh/externalTerminalAdapter";
import { fakeEnv, TEST_AGENT } from "./dshExternalTerminalFakes";

describe("TerminalAdapter · 本机 pk PATH 前缀（登录 shell 不吃 childEnvFor 注入）", () => {
  it("落位在场：注入行前插 export PATH（cd 织入在前，真窗口执行与 copy-line 手动粘贴同源）", async () => {
    const prefix = `export PATH='/x/.choose-you/bin':"$PATH" && `;
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    await createExternalTerminalAdapter(env, () => prefix).inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: "/ws",
    });
    expect(spawned[0]?.[9]).toBe(`cd /ws && ${prefix}claude --resume s1`);
    const failing = fakeEnv({
      appExists: (name) => name === "Ghostty",
      spawn: async () => Promise.reject(new Error("boom")),
    });
    const out = await createExternalTerminalAdapter(failing.env, () => prefix).inject({
      line: "claude",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(out.note).toContain(`${prefix}claude`);
  });

  it("落位缺席（空串前缀）：行为不变——裸命令行直通", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    await createExternalTerminalAdapter(env, () => "").inject({
      line: "claude",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(spawned[0]?.[9]).toBe("claude");
  });
});
