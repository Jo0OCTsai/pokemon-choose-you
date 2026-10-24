/**
 * 外部终端 TerminalAdapter / terminalLine 注入件（从 externalTerminal.ts 拆出——
 * 棘轮 max-lines，等量迁移）：交互派发按次解析（inject 携带 terminalPreference——
 * 业务核心读共享设置传入）唤起真终端（terminal=external-<label>，kitty tab 复用时
 * external-kitty@tab，无 sessionRef）；注入行前插本机 pk 目录的 PATH export（登录
 * shell 不吃 childEnvFor 注入——localPkPathPrefix 单源，落位缺席为空串）。解析无产物 → copy-line handoff
 * （reason=no-terminal）；唤起失败回落 copy-line handoff（reason=spawn-failed，
 * note 携带完整命令行）——零静默链：真窗口 → 复制降级。回放/lark 登录的
 * terminalLine 注入件失败上抛（injectLineGuarded 折 DISPATCH_LAUNCH_FAILED）。
 */
import type { TerminalAdapter } from "../dispatch/interactive";
import type { TerminalLineInjector } from "../commands/context";
import { resolveExternalTerminal, type ExternalTerminalEnv } from "./externalTerminal";
import { localPkPathPrefix } from "../remote/pkLocal";

export function createExternalTerminalAdapter(
  env: ExternalTerminalEnv = {},
  pkPathPrefix: () => string = localPkPathPrefix,
): TerminalAdapter {
  return {
    async inject({ line, workdir, terminalPreference }) {
      // 登录 shell 执行不吃 childEnvFor 的子进程 PATH 注入——本机 pk 目录前插进命令行本体
      //（真窗口与 copy-line 手动粘贴同源；落位缺席时前缀为空串，行为不变）
      const script = `${pkPathPrefix()}${line}`;
      const ext = resolveExternalTerminal(terminalPreference, env);
      if (ext === null) {
        return {
          terminal: "copy-line",
          reason: "no-terminal",
          note: `宿主未探测到可用的 GUI 终端（Ghostty/kitty/Alacritty/WezTerm/iTerm2）——请复制完整命令行到终端手动执行：${script}`,
        };
      }
      try {
        const form = await ext.spawn(script, workdir);
        return { terminal: form === "tab" ? `external-${ext.label}@tab` : `external-${ext.label}` };
      } catch (error) {
        return {
          terminal: "copy-line",
          reason: "spawn-failed",
          note: `终端窗口唤起失败（${ext.label}：${String(error instanceof Error ? error.message : error).slice(0, 120)}）——请复制完整命令行到终端手动执行：${script}`,
        };
      }
    },
  };
}

export function externalTerminalLine(env: ExternalTerminalEnv = {}): TerminalLineInjector {
  return {
    async injectLine(line, preference) {
      const ext = resolveExternalTerminal(preference, env);
      if (ext === null) {
        throw new Error("宿主未探测到可用的 GUI 终端");
      }
      await ext.spawn(line, null);
    },
  };
}
