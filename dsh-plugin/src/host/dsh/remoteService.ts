/**
 * /pky 宿主→客户端数据面（Typert Remote，官方通道——2026-10-13 迁移）。
 *
 * 原自定义通道（connection.rpc.handle "/pky"）在 rc.2 对第三方插件不可用（晚供 +
 * notify 不达 + 影子 ctx 读 owner.webServer 撞严格制，证据链见 debt.md），官方宿主→
 * 客户端数据面全部走 Typert Remote：服务类挂 TypertRemoteService（super(ctx, "pky")
 * ——服务名即 wire 命名空间），方法标 @Remote；api-gateway 在共享 /api 通道上按端点
 * `pky/call` 经 SRC 模式解析（无生成描述符的端点走源码参数名回退——本包构建不
 * minify，参数名可解析），gateway 用 ctx.get("pky") 直取服务实例调用——无消费方
 * inject、无 webServer 依赖、注册即刻生效（无晚供问题）。
 *
 * 69 命令不拆分：单方法 call(command, payload) 直转 HostCommandCaller 分发器；业务信封
 * （PROTOCOL §2 ok/fail）作为 Remote 返回值透传——业务错误码不进传输层错误路径
 * （方法不抛错），客户端剥一层传输信封即得业务信封。
 */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { HostCommandCaller } from "../commands";
import type { PkyResult } from "../storage/errors";

/** pky 数据面 Remote 服务（wire 命名空间 = 服务名 "pky"，端点 pky/call） */
export class PkyRemoteService extends TypertRemoteService {
  private readonly dispatch: HostCommandCaller;

  constructor(ctx: Context, dispatch: HostCommandCaller) {
    super(ctx, "pky");
    this.dispatch = dispatch;
  }

  /** host 命令统一入口（SRC 参数名 = wire 字段；payload 可省略——src-json acceptsUndefined；返回业务信封原样透传） */
  @Remote("call")
  async call(command: string, payload?: unknown): Promise<PkyResult<unknown>> {
    return this.dispatch(command, payload);
  }
}
