/**
 * dsh-external-terminal 系列受测装配（从 dsh-external-terminal.spec.ts 拆出——棘轮
 * max-lines，等量迁移）：测试环境注入件 fakeEnv（探测存在性 / spawn 与 socket 操作
 * 记录全部可控）+ 适配器注入用 AgentConfig 形状；消费面 =
 * dsh-external-terminal.spec.ts 与 dsh-external-terminal-preference.spec.ts。
 */
import type { ExternalTerminalEnv } from "../src/host/dsh/externalTerminal";

/** 测试环境注入件：全部可控（探测存在性 / spawn 与 socket 操作记录） */
export function fakeEnv(over: Partial<ExternalTerminalEnv> = {}): {
  env: ExternalTerminalEnv;
  spawned: string[][];
  unlinked: string[];
} {
  const spawned: string[][] = [];
  const unlinked: string[] = [];
  const env: ExternalTerminalEnv = {
    platform: "darwin",
    electron: true,
    appExists: () => false,
    spawn: async (argv) => {
      spawned.push(argv);
    },
    socketExists: () => false,
    unlinkSocket: (path) => {
      unlinked.push(path);
    },
    kittenPath: "/Applications/kitty.app/Contents/MacOS/kitten",
    shell: "/bin/zsh",
    ...over,
  };
  return { env, spawned, unlinked };
}

/** 适配器注入用 agent 配置（形状满足 AgentConfig） */
export const TEST_AGENT = {
  id: "a",
  name: "A",
  command: "claude",
  args: "",
  historyArgs: "",
  workdir: "",
  timeoutSecs: 60,
  enabled: true,
};
