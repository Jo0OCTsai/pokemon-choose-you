/**
 * sys/ 模块族公共上下文（full-parity AD §3.4/§4.3）：每能力一文件、各自独立启停，
 * host 经 sys-config 下发启停面。模块不直接持有 Bridge——上行一律经 ctx.emit
 * （runtime 装配层借此统一观测：可见性跟踪 / input-activity 渲染层转发）。
 */
import type { UpstreamMsg } from "../bridge/protocol.ts";

export interface SysContext {
  /** 上行出口（tray-action / shortcut-fired / notify-clicked / seq 四消息 / input-activity） */
  emit(msg: UpstreamMsg): boolean;
  /** 诊断环形缓冲（与 bridge.diag 同渠道） */
  diag(tag: string, detail: string): void;
  /** 时钟注入（测试可虚拟） */
  now(): number;
}
