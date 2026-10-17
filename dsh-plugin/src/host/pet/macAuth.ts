/**
 * macAuthorizationStatus 查询 domain 面（full-parity AD §4.1 桌宠域 / FR-A9）：经桥
 * `mac-auth-query → ack → result` 往返取辅助功能授权状态 + host 自知的 helper 入口路径。
 * helper 缺席 / 未握手 / 能力位缺位 / ack 超时 → `HELPER_CAPABILITY_MISSING`（本地机器
 * 稳定 tag，PROTOCOL §2 追加归任务 2.9）。命令面装配归 2.9。
 */
import { fail, ok, PkyError, type PkyResult } from "../storage/errors";
import type { BridgeClient } from "./bridge";

export interface MacAuthorizationStatusData {
  granted: boolean;
  helperPath: string;
}

export interface MacAuthDeps {
  /** supervisor 当前桥（helper 不在 = null） */
  bridge(): BridgeClient | null;
  /** helper 入口路径（spawner 定位面——授权引导卡「定位 helper 二进制」数据） */
  helperPath(): string;
}

function helperMissing(detail: string): PkyResult<MacAuthorizationStatusData> {
  return fail(
    new PkyError(
      "HELPER_CAPABILITY_MISSING",
      `无法查询辅助功能授权：${detail}`,
      "确认 helper 已运行（托盘图标在位）且为最新版本",
    ),
  );
}

/**
 * 查询 macOS 辅助功能授权（kind 固定 accessibility——D32 v1 唯一形态）。seq 两段语义：
 * ack 10s 超时/能力位缺位由 sys 通道折算为 HELPER_CAPABILITY_MISSING reject，此处还原。
 */
export async function macAuthorizationStatus(deps: MacAuthDeps): Promise<PkyResult<MacAuthorizationStatusData>> {
  const bridge = deps.bridge();
  if (bridge === null || bridge.hello === null) {
    return helperMissing("helper 未运行或握手未完成");
  }
  try {
    const { granted } = await bridge.sys.queryMacAuth();
    return ok({ granted, helperPath: deps.helperPath() });
  } catch (error) {
    if (error instanceof PkyError) {
      return fail(error);
    }
    return helperMissing(error instanceof Error ? error.message : String(error));
  }
}
