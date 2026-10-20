/**
 * full-parity 增量命令门面（从 rpc.ts 拆出——棘轮 max-lines，等量迁移；rpc.ts 为
 * 统一再出口消费面不变）：连胜/登录 / 会话分页回放 / 远程部署与开通向导 / 导入恢复 /
 * AX 授权——AD §4.1。
 */
import type { PkyResult } from "../host/storage/errors";
import type { HostClient } from "./rpcTypes";

type Sender = <T>(command: string, params?: unknown) => Promise<PkyResult<T>>;

/** full-parity 增量命令门面（连胜/登录 / 会话分页回放 / 远程部署与开通向导 / 导入恢复 / AX 授权——AD §4.1） */
export function parityFacade(
  call: Sender,
): Pick<
  HostClient,
  | "streakInfo"
  | "larkLoginStart"
  | "sessionsPage"
  | "sessionReplay"
  | "deploymentList"
  | "sshAliasList"
  | "deploymentUpsert"
  | "deploymentDelete"
  | "deploymentRecheck"
  | "provisionRun"
  | "provisionStatus"
  | "deploymentDegradeConfirm"
  | "deploymentSetupPk"
  | "importValidate"
  | "importRun"
  | "restoreRun"
  | "exportDirOpen"
  | "macAuthorizationStatus"
  | "macAuthPaneOpen"
> {
  return {
    streakInfo: () => call("streakInfo"),
    larkLoginStart: () => call("larkLoginStart"),
    sessionsPage: (p) => call("sessionsPage", p),
    sessionReplay: (p) => call("sessionReplay", p),
    deploymentList: () => call("deploymentList"),
    sshAliasList: () => call("sshAliasList"),
    deploymentUpsert: (p) => call("deploymentUpsert", p),
    deploymentDelete: (p) => call("deploymentDelete", p),
    deploymentRecheck: (p) => call("deploymentRecheck", p),
    provisionRun: (p) => call("provisionRun", p),
    provisionStatus: (p) => call("provisionStatus", p),
    deploymentDegradeConfirm: (p) => call("deploymentDegradeConfirm", p),
    deploymentSetupPk: (p) => call("deploymentSetupPk", p),
    importValidate: (p) => call("importValidate", p),
    importRun: (p) => call("importRun", p),
    restoreRun: (p) => call("restoreRun", p),
    exportDirOpen: () => call("exportDirOpen"),
    macAuthorizationStatus: (p) => call("macAuthorizationStatus", p),
    macAuthPaneOpen: () => call("macAuthPaneOpen"),
  };
}
