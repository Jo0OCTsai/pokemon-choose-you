/**
 * 错误码与响应包装（contracts/PROTOCOL.md §2 单源：code 机器稳定，
 * message 三语由 UI 层本地化）。
 *
 * 业务错误用 PkyError 抛出；参数错 / 目标不存在属传输层通用语义，
 * 使用 INVALID_ARGUMENT / NOT_FOUND 两个非业务码（pk 面的 `{"error":"..."}` 同位对应）。
 * 响应统一 `{ ok: true, data? }` / `{ ok: false, error: { code, message, hint? } }`（ok/fail）。
 */

/**
 * 业务错误码 21 枚（PROTOCOL.md §2 表格逐字单源；15→21 = full-parity AD §4.2 增量：
 * 导入/恢复域 2 枚（任务 1.7 先行）+ helper 系统能力域 1 枚（任务 2.3/2.6 先行）+
 * 远程部署域 3 枚（任务 2.9 收口追加——DEPLOYMENT_NOT_READY / PROVISION_STEP_FAILED /
 * HELPER_HASH_MISMATCH），PROTOCOL §2 已由任务 2.9 同步追加至同集）。
 */
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
  // ---- full-parity 增量（AD §4.2 · 15→21）：导入/恢复域 ----
  "IMPORT_VALIDATION_FAILED",
  "BACKUP_FAILED",
  // ---- full-parity 增量（AD §4.2）：helper 系统能力域 ----
  "HELPER_CAPABILITY_MISSING",
  // ---- full-parity 增量（AD §4.2）：远程部署域（任务 2.9 收口） ----
  "DEPLOYMENT_NOT_READY",
  "PROVISION_STEP_FAILED",
  "HELPER_HASH_MISMATCH",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 传输层通用码（非业务 15 码集）：参数错 / 目标不存在 */
export type GenericCode = "INVALID_ARGUMENT" | "NOT_FOUND";

export type AnyErrorCode = ErrorCode | GenericCode;

/** 错误负载形态（响应信封 error 字段） */
export interface PkyErrorShape {
  code: AnyErrorCode;
  message: string;
  hint?: string;
}

/** typed error：code 机器稳定；hint 为可操作指引（对齐 pk 的提示风格） */
export class PkyError extends Error {
  readonly code: AnyErrorCode;
  readonly hint?: string;

  constructor(code: AnyErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "PkyError";
    this.code = code;
    this.hint = hint;
  }

  toShape(): PkyErrorShape {
    return this.hint === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, hint: this.hint };
  }
}

/** 响应信封（PROTOCOL.md §2：host 命令与工具面统一） */
export type PkyResult<T> = { ok: true; data: T } | { ok: false; error: PkyErrorShape };

export function ok<T>(data: T): PkyResult<T> {
  return { ok: true, data };
}

export function fail(error: PkyError): PkyResult<never> {
  return { ok: false, error: error.toShape() };
}

/** 参数校验错（对齐主应用 AppError::Invalid 的语义位） */
export function paramError(message: string, hint?: string): PkyError {
  return new PkyError("INVALID_ARGUMENT", message, hint);
}

/** 目标不存在（对齐 AppError::NotFound 的语义位） */
export function notFound(message: string, hint?: string): PkyError {
  return new PkyError("NOT_FOUND", message, hint);
}

/** 把抛 PkyError 的同步调用包装成响应信封（适配层消费；非 PkyError 原样上抛） */
export function toResult<T>(fn: () => T): PkyResult<T> {
  try {
    return ok(fn());
  } catch (error) {
    if (error instanceof PkyError) {
      return fail(error);
    }
    throw error;
  }
}
