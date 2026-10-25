/**
 * dsh 形态子进程凭据环境提供者（debt 2026-10-20 凭据注入）：dsh-headless 出厂禁用
 * credentials 服务（bundle patch「一次性任务用启动时凭据」），插件 spawn 链的 dsh 子
 * 进程只看得到宿主 GUI 进程环境——DEEPSEEK_API_KEY 不在。宿主 credentials 服务
 * （dsh-base 组合自带，web Models 页写入凭据库）解析后经 AgentEnvProvider 注入
 * 判定 cli / 无头派发（local childEnvFor + 远端 script env 段）/ 聊聊 / 探针 spawn 链。
 * 仅对 dsh 命令注入（basename 判定，容忍 Windows 可执行扩展）；任何未命中/异常降级为
 * 不注入——子进程按原环境跑，MISSING_CREDENTIAL 由 dsh 自身报错（fail fast 口径不变）。
 * 逐次解析不缓存：凭据库轮换后下一次 spawn 即生效（credentials 服务同款语义）。
 * 凭据只进子进程 env——不落盘、不进命令行、不打日志。
 */
import { win32 } from "node:path";
import type { AgentEnvProvider } from "../dispatch/localEnv";

/** ctx.credentials 消费面收窄（CredentialProvider.resolve——stored 优先、环境回退） */
interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>;
}

/** dsh 官方 API key 凭据引用名（credentialRef 语法内——POSIX 标识符） */
const DEEPSEEK_API_KEY_REF = "DEEPSEEK_API_KEY";

/** 命令是否 dsh 本体（basename 判定；win32.basename 兼认 `/` 与 `\`，npm/Windows
 *  shim 的 .exe/.cmd/.ps1/.bat 扩展容忍） */
function isDshCommand(program: string): boolean {
  return win32.basename(program).replace(/\.(exe|cmd|ps1|bat)$/i, "") === "dsh";
}

/** 宿主 ctx → agent 子进程凭据环境提供者（hostEntry 装配期调用一次） */
export function dshCredentialEnvOf(ctx: unknown): AgentEnvProvider {
  const credentials = (ctx as { credentials?: CredentialsFace }).credentials;
  return async (program) => {
    if (!isDshCommand(program)) {
      return undefined;
    }
    try {
      const hit = await credentials?.resolve(DEEPSEEK_API_KEY_REF);
      return hit === undefined || hit.value === "" ? undefined : { DEEPSEEK_API_KEY: hit.value };
    } catch {
      return undefined;
    }
  };
}
