/**
 * lark-cli 子进程封装——行为基准 = src-tauri/src/lark_cli.rs：命令形态
 * `lark-cli api GET <path> --params '<json>' --format json`、信封
 * `{"ok":true,"data":…}` 解析、auth status --json（identities.user.available）、
 * config show 退出码、超时口径（api 30s / auth 15s / config 10s）。
 * 凭证由 lark-cli 自管不进插件（NFR-2 ⑤）；零 dsh 依赖——spawn 可注入
 * （测试用仓内 fake shell 脚本先例替身）。错误映射：拉取类失败 →
 * LARK_FETCH_FAILED；未登录/未授权 → LARK_UNAUTHORIZED。
 */
import { spawn } from "node:child_process";
import { PkyError } from "../storage/errors";

// ---- JSON 安全取值件（信封/分页数据全是 unknown） ----

export function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asBool(v: unknown): boolean {
  return v === true;
}

/** 子进程执行面（可注入）：退出码非 0 抛错文案由封装层组织；超时由实现负责杀进程 */
export interface LarkSpawn {
  (bin: string, args: string[], opts: { timeoutMs: number }): Promise<{ stdout: string; stderr: string }>;
}

/** 真实 spawn：超时 SIGKILL、聚合 stdout/stderr、spawn 失败/超时转 PkyError */
export const realSpawn: LarkSpawn = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new PkyError(
          "LARK_FETCH_FAILED",
          `lark-cli「${args.slice(0, 3).join(" ")}」执行超时（${opts.timeoutMs / 1000} 秒）`,
        ),
      );
    }, opts.timeoutMs);
    child.stdout?.on("data", (c: Buffer) => out.push(c));
    child.stderr?.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new PkyError(
          "LARK_FETCH_FAILED",
          `启动 lark-cli 失败：${e.message}`,
          "请先 npm install -g @larksuite/cli，或用 LARK_CLI_BIN 指定其绝对路径",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      } else {
        reject(
          new PkyError(
            "LARK_FETCH_FAILED",
            `lark-cli 失败（退出码 ${code ?? -1}）: ${Buffer.concat(err).toString("utf8").trim().slice(0, 300)}`,
          ),
        );
      }
    });
  });

/** API 超时口径（lark_cli.rs 的 Duration::from_secs） */
const API_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;
const CONFIG_TIMEOUT_MS = 10_000;

/** 超时可覆盖（测试注入缩短口径；单位毫秒） */
export interface LarkTimeouts {
  api?: number;
  auth?: number;
  config?: number;
}

/** 宽松 JSON 解析：整串失败时截取首个 { 到最后一个 }（前后带日志文字）；不可解析返回 undefined */
function parseJsonLoose(trimmed: string): unknown {
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const s = trimmed.indexOf("{");
    const e = trimmed.lastIndexOf("}");
    if (s < 0 || e <= s) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed.slice(s, e + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

/** 信封解包（unwrap_envelope 同构）：ok=false 报错；data 存在取 data，否则整体返回。
 * envelopeCode：ok=false 信封的错误码（user_info 端点传 LARK_UNAUTHORIZED——信封级失败
 * 是授权语义；非零退出/超时/坏 JSON 仍走 LARK_FETCH_FAILED） */
export function unwrapEnvelope(
  stdout: string,
  what: string,
  envelopeCode: "LARK_FETCH_FAILED" | "LARK_UNAUTHORIZED" = "LARK_FETCH_FAILED",
): Record<string, unknown> {
  const parsed = parseJsonLoose(stdout.trim());
  if (parsed === undefined) {
    throw new PkyError("LARK_FETCH_FAILED", `${what}输出不是合法 JSON`);
  }
  const v = asObj(parsed);
  if (v.ok === false) {
    const msg = asStr(v.error) || asStr(v.message) || "未知错误";
    throw new PkyError(envelopeCode, `${what}失败: ${msg}`);
  }
  const data = v.data;
  if (data !== undefined && (Array.isArray(data) || typeof data === "object")) {
    return asObj(data);
  }
  return v;
}

/** lark-cli 调用面（单页 API；翻页聚合在 fetcher.ts） */
export interface LarkCli {
  userIdentity(): Promise<{ openId: string; name: string }>;
  listChats(pageSize: number, pageToken?: string | null): Promise<Record<string, unknown>>;
  chatUserSettings(chatIds: string[]): Promise<Record<string, unknown>>;
  listMessages(
    chatId: string,
    startSec: number,
    endSec: number,
    pageToken?: string | null,
  ): Promise<Record<string, unknown>>;
  listMembers(chatId: string, pageToken?: string | null): Promise<Record<string, unknown>>;
  authStatus(): Promise<{ loggedIn: boolean; userName: string }>;
  configReady(): Promise<boolean>;
}

type EnvelopeCode = "LARK_FETCH_FAILED" | "LARK_UNAUTHORIZED";

/** 单页 GET 调用面（各端点函数的公共形态） */
type ApiGet = (
  path: string,
  params: Record<string, unknown>,
  envelopeCode?: EnvelopeCode,
) => Promise<Record<string, unknown>>;
type ApiPost = (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** 带 page_token 的翻页参数（空 token 省略键） */
function withPageToken(params: Record<string, unknown>, pageToken: string | null): Record<string, unknown> {
  if (pageToken !== null && pageToken !== "") {
    return { ...params, page_token: pageToken };
  }
  return params;
}

/** 当前用户身份（user_identity 同构）：空 open_id → LARK_UNAUTHORIZED（信封级失败同为授权语义） */
async function fetchUserIdentity(apiGet: ApiGet): Promise<{ openId: string; name: string }> {
  const d = await apiGet("/open-apis/authen/v1/user_info", {}, "LARK_UNAUTHORIZED");
  const openId = asStr(d.open_id) || asStr(asObj(d.data).open_id);
  if (openId === "") {
    throw new PkyError(
      "LARK_UNAUTHORIZED",
      "lark-cli 未登录或未授权用户信息",
      "先在终端跑 lark-cli auth login --domain im",
    );
  }
  const name = asStr(d.name) || asStr(d.en_name) || "飞书用户";
  return { openId, name };
}

/** 会话/消息/成员端点（chats_methods 同构；翻页聚合在 fetcher.ts） */
function imEndpoints(apiGet: ApiGet, apiPost: ApiPost) {
  return {
    listChats(pageSize: number, pageToken: string | null = null): Promise<Record<string, unknown>> {
      return apiGet(
        "/open-apis/im/v1/chats",
        withPageToken({ page_size: pageSize, user_id_type: "open_id", types: "p2p,group" }, pageToken),
      );
    },
    chatUserSettings(chatIds: string[]): Promise<Record<string, unknown>> {
      return apiPost("/open-apis/im/v1/chat_user_setting/batch_query", { chat_ids: chatIds });
    },
    listMessages(
      chatId: string,
      startSec: number,
      endSec: number,
      pageToken: string | null = null,
    ): Promise<Record<string, unknown>> {
      return apiGet(
        "/open-apis/im/v1/messages",
        withPageToken(
          {
            container_id_type: "chat",
            container_id: chatId,
            start_time: String(startSec),
            end_time: String(endSec),
            page_size: 50,
          },
          pageToken,
        ),
      );
    },
    listMembers(chatId: string, pageToken: string | null = null): Promise<Record<string, unknown>> {
      return apiGet(
        `/open-apis/im/v1/chats/${chatId}/members`,
        withPageToken({ member_id_type: "open_id", page_size: 100 }, pageToken),
      );
    },
  };
}

/** 创建 lark-cli 封装（bin 可为绝对路径；spawn 与超时可注入） */
export function createLark(bin: string, spawnFn: LarkSpawn = realSpawn, timeouts: LarkTimeouts = {}): LarkCli {
  const apiMs = timeouts.api ?? API_TIMEOUT_MS;
  const api = async (
    method: "GET" | "POST",
    path: string,
    payload: Record<string, unknown>,
    flag: string,
    envelopeCode: EnvelopeCode,
  ) => {
    const args = ["api", method, path, flag, JSON.stringify(payload), "--format", "json"];
    const { stdout } = await spawnFn(bin, args, { timeoutMs: apiMs });
    return unwrapEnvelope(stdout, `lark-cli ${path}`, envelopeCode);
  };
  const apiGet: ApiGet = (path, params, envelopeCode = "LARK_FETCH_FAILED") =>
    api("GET", path, params, "--params", envelopeCode);
  const apiPost: ApiPost = (path, body) => api("POST", path, body, "--data", "LARK_FETCH_FAILED");
  return {
    userIdentity: () => fetchUserIdentity(apiGet),
    ...imEndpoints(apiGet, apiPost),
    async authStatus() {
      try {
        const { stdout } = await spawnFn(bin, ["auth", "status", "--json"], {
          timeoutMs: timeouts.auth ?? AUTH_TIMEOUT_MS,
        });
        const v = asObj(JSON.parse(stdout.trim()) ?? {});
        const user = asObj(asObj(v.identities).user);
        const loggedIn = asBool(user.available) || ["logged_in", "authenticated", "ok"].some((k) => asBool(v[k]));
        const userName = asStr(user.userName) || asStr(v.name) || asStr(asObj(v.user).name) || "飞书用户";
        return { loggedIn, userName };
      } catch {
        // 输出不稳定/调用失败按未登录处理，让上层给登录指引（feishu_oauth_status 同口径）
        return { loggedIn: false, userName: "飞书用户" };
      }
    },
    async configReady() {
      try {
        await spawnFn(bin, ["config", "show"], { timeoutMs: timeouts.config ?? CONFIG_TIMEOUT_MS });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** posix shell 单引号引用（授权跳转行会被目标 shell 重解析） */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * 授权跳转命令行（larkAuth 口径 = feishu_oauth_login）：已在系统终端跑
 * `lark-cli config init --new && lark-cli auth login --domain im --recommend`
 * （未初始化先 config init；浏览器完成授权）。
 */
export async function authLoginCommandLine(lark: LarkCli, bin: string): Promise<string> {
  const ready = await lark.configReady();
  const quoted = shellQuote(bin);
  if (ready) {
    return `${quoted} auth login --domain im --recommend`;
  }
  return `${quoted} config init --new && ${quoted} auth login --domain im --recommend`;
}
