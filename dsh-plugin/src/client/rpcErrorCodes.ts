/**
 * 业务错误码表（从 rpcTypes.ts 拆出——棘轮 max-lines，等量迁移；rpcTypes.ts 为统一
 * 再出口，消费面不变）：21 枚举 · PROTOCOL §2 单源镜像；与 host/storage/errors
 * ERROR_CODES 的类型级双向断言在本文件收口。
 */
import type { ErrorCode } from "../host/storage/errors";

// ---- 错误码（21 枚举 · PROTOCOL §2 单源；与 host/storage/errors ERROR_CODES 逐字一致——类型级双向断言） ----

/** 业务错误码（uiux 契约需求面交互状态表单源；full-parity 2.9 收口 15→21） */
export const ERROR_CODES = [
  "JUDGE_TIMEOUT",
  "JUDGE_INVALID_RESULT",
  "LARK_FETCH_FAILED",
  "LARK_UNAUTHORIZED",
  "DISPATCH_TIMEOUT",
  "DISPATCH_LAUNCH_FAILED",
  "DB_SCHEMA_TOO_NEW",
  "DSH_VERSION_UNSUPPORTED",
  "SSH_AUTH_REQUIRED",
  "SUGGESTION_ALREADY_RESOLVED",
  "DISPATCH_ALREADY_ACTIVE",
  "CONFIG_VALIDATION_FAILED",
  "AGENT_COMMAND_INVALID",
  "PROMPT_VALIDATION_FAILED",
  "SETTING_MODIFIED_ELSEWHERE",
  "IMPORT_VALIDATION_FAILED",
  "BACKUP_FAILED",
  "HELPER_CAPABILITY_MISSING",
  "DEPLOYMENT_NOT_READY",
  "PROVISION_STEP_FAILED",
  "HELPER_HASH_MISMATCH",
] as const satisfies readonly ErrorCode[];

/** 双向集合相等断言：本表 ⊇ host 表 且 host 表 ⊆ 本表（漂移即编译红） */
type _AssertCoversHost = Exclude<ErrorCode, (typeof ERROR_CODES)[number]>;
type _AssertNoExtra = Exclude<(typeof ERROR_CODES)[number], ErrorCode>;
type _AssertExact = [_AssertCoversHost] extends [never] ? ([_AssertNoExtra] extends [never] ? true : never) : never;
/** 编译期锚点（导出防 noUnusedLocals；断言通过时为 true，漂移时 never 拒绝赋值） */
export const _ERROR_CODE_ASSERTION: _AssertExact = true;
