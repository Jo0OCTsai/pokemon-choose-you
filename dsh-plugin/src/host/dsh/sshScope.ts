/**
 * dsh/sshScope.ts —— 唯一 dsh-ssh 家族触碰点（AD §3.2/§4.7；装配模式按 spike 实测
 * 修正 A/B 落实，依据 specs/dsh-plugin-full-parity/spike-dsh-ssh.md）。
 *
 * 装配模式三要点（cordis 4.0.4 实测；README §装配模式同步）：
 * 1. 双 label：cordis 服务注册槽以 label 单一编址——ssh 与 subprocess 必须各拿一个
 *    Symbol label（同名 label 链式 isolate 会撞进同一注册槽，装载即抛
 *    "service subprocess has been registered at <SshConnection>"）；按部署 id 缓存
 *    label 对，重连复用同 label（join 语义）。
 * 2. consumer 子插件取服务：cordis 消费方必须声明 inject 才能读注入服务——向目标
 *    scope 装一个 inject:["ssh","subprocess"] 的 consumer，其 apply 回调即两服务
 *    可用时机（loadConsumer，语义照抄 spike 探针）。
 * 3. fiber 必须 await：ctx.plugin() 返回 Fiber（PromiseLike），装载期错误（连接失败/
 *    摘要不符）只有 await 才能捕获；卸载原语 = fiber.dispose()。
 *
 * 家族装载 = 惰性动态 import（构建 external 口径——运行时从插件包闭包解析，spike
 * 验证点③ 证实锚定 profile 内插件包 node_modules；peer 由 dsh 宿主 install anchor
 * 供给，故本模块只准在 dsh 宿主进程内触发装载）。
 *
 * 断开事件面：显式 disconnect() 与建连失败置 connected=false 并通知宿主回调
 * （onScopeDisconnected——recheck/迟到回传挂接用，装配归任务 2.8/2.9）；建连成功后
 * 的连接失效由 remote/recheck 的周期/派发前活性探测承担（AD §4.7，dsh-ssh 无公开
 * 断开事件面）。本文件不进覆盖率门禁（vite.config exclude src/host/dsh/**）；真机
 * 验证归 spike（已过）+ 4.5 profile 冒烟。
 *
 * 实现拆件（棘轮 max-lines，等量迁移）：家族装载与 consumer = sshScopeFamily.ts、
 * 宿主与 scopeFor 路由 = sshScopeHost.ts、家族链 scope 实现 = sshScopeImpl.ts、
 * 直连兜底 scope（provision 前置步）= directScope.ts；本文件为统一再出口（消费面不变）。
 */
// ---- cordis 宿主表面（最小结构类型——RC 期 API 漂移隔离在本文件内消化） ----

/** ctx.plugin() 返回的 Fiber（PromiseLike + dispose 卸载原语——spike 修正 B） */
export interface CordisFiber extends PromiseLike<unknown> {
  dispose(): Promise<void>;
}

/** 本模块消费的 cordis Context 表面（isolate + 动态 plugin 两方法） */
export interface CordisHostContext {
  isolate(name: string, label?: symbol): CordisHostContext;
  plugin(plugin: object, config?: object): CordisFiber;
}

/** dsh-ssh Config（0.1.6-alpha.1 实测字段；AD §4.7——从部署实体组装，其余按缺省） */
export interface SshFamilyConfig {
  host: string;
  node: string;
  helper: string;
  helperHash: string;
  workspace: string;
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export {
  createSshScopeHost,
  familyProvisioned,
  type LiveScopeEntry,
  type ScopeDisconnectedListener,
  type SshScopeHost,
  type SshScopeHostOptions,
} from "./sshScopeHost";
export { createDirectSshScope, DirectSshScope, type DirectSshScopeOptions } from "./directScope";
