/** storage/errors：错误码单源（PROTOCOL.md §2 · 21 枚）、PkyError、ok/fail 响应包装 */
import { describe, expect, it } from "vitest";
import { ERROR_CODES, fail, notFound, ok, paramError, PkyError, toResult } from "../src/host/storage/errors";

describe("错误码（PROTOCOL.md §2 单源 · 21 枚 = 15 既有 + full-parity AD §4.2 增量 6 枚）", () => {
  it("恰好 21 个且无重复", () => {
    expect(ERROR_CODES.length).toBe(21);
    expect(new Set(ERROR_CODES).size).toBe(21);
  });

  it("枚举内容与协议表格逐字一致（+ 导入/恢复 2 + helper 能力 1 + 远程部署 3）", () => {
    expect([...ERROR_CODES]).toEqual([
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
    ]);
  });
});

describe("PkyError", () => {
  it("携带 code/message/hint，toShape 输出响应信封 error 字段形态", () => {
    const e = new PkyError("SUGGESTION_ALREADY_RESOLVED", "该建议已在另一处处置", "刷新后重试");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PkyError");
    expect(e.code).toBe("SUGGESTION_ALREADY_RESOLVED");
    expect(e.toShape()).toEqual({
      code: "SUGGESTION_ALREADY_RESOLVED",
      message: "该建议已在另一处处置",
      hint: "刷新后重试",
    });
  });

  it("无 hint 时 shape 不含 hint 键", () => {
    const e = paramError("标题不能为空");
    expect(e.code).toBe("INVALID_ARGUMENT");
    expect(e.toShape()).not.toHaveProperty("hint");
    expect(notFound("任务 1 不存在").code).toBe("NOT_FOUND");
  });
});

describe("ok/fail 响应包装", () => {
  it("ok 包装 data", () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it("fail 包装 PkyError 为信封", () => {
    const envelope = fail(paramError("参数错"));
    expect(envelope).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "参数错" },
    });
  });

  it("toResult：正常值 → ok；PkyError → fail；其他异常原样上抛", () => {
    expect(toResult(() => "v")).toEqual({ ok: true, data: "v" });
    expect(
      toResult(() => {
        throw paramError("x");
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "x" },
    });
    expect(() =>
      toResult(() => {
        throw new Error("raw");
      }),
    ).toThrowError("raw");
  });
});
