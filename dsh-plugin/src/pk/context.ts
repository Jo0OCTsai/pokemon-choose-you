/**
 * context 子命令（对齐 bin/pk/context.rs）：给 agent 的判重上下文。数据面直接复用
 * host/tools/contextData（pk context 同构的 tools 实现——judgement 上下文与 CLI 同源）。
 */
import type { Conn } from "../host/storage/db";
import { buildToolContextData } from "../host/tools/contextData";

export function runContext(conn: Conn): unknown {
  return buildToolContextData(conn);
}
