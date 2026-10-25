/**
 * radio/lark：真实子进程路径（fixture 脚本替身）——命令形态/信封解包/三态错误映射、
 * 超时杀进程、授权状态解析与授权跳转命令行组装。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authLoginCommandLine, createLark, unwrapEnvelope } from "../src/host/radio/lark";
import { PkyError } from "../src/host/storage/errors";
import { stageFixture } from "./fake-shell";

async function pkyError(p: Promise<unknown>): Promise<PkyError> {
  try {
    await p;
  } catch (e) {
    return e as PkyError;
  }
  throw new Error("期望抛错");
}

function syncPkyError(fn: () => unknown): PkyError {
  try {
    fn();
  } catch (e) {
    return e as PkyError;
  }
  throw new Error("期望抛错");
}

describe("信封解包（unwrapEnvelope）", () => {
  it("ok=true 取 data；无 data 整体返回；前后日志文字容错", () => {
    expect(unwrapEnvelope('{"ok":true,"data":{"items":[1]}}', "t").items).toBeDefined();
    const whole = unwrapEnvelope('{"ok":true,"items":[1]}', "t");
    expect(Array.isArray(whole.items)).toBe(true);
    expect(unwrapEnvelope('log line\n{"ok":true,"data":{"a":1}}\n', "t").a).toBe(1);
  });

  it("ok=false / 非 JSON → LARK_FETCH_FAILED 且文案含错误信息", () => {
    const e1 = syncPkyError(() => unwrapEnvelope('{"ok":false,"error":"invalid chat id"}', "t"));
    expect(e1).toBeInstanceOf(PkyError);
    expect(e1.code).toBe("LARK_FETCH_FAILED");
    expect(e1.message).toContain("invalid chat id");
    expect(syncPkyError(() => unwrapEnvelope("not json at all", "t")).code).toBe("LARK_FETCH_FAILED");
  });
});

describe("正常增量态（lark-cli-ok.sh，真实子进程）", () => {
  it("user_identity / list_chats / batch_query / messages / members 逐面走通", async () => {
    const staged = stageFixture("lark-cli-ok.sh");
    try {
      const lark = createLark(staged.bin);
      const me = await lark.userIdentity();
      expect(me).toEqual({ openId: "ou_me", name: "乔老板" });
      const chats = await lark.listChats(100);
      expect(chats.items).toBeInstanceOf(Array);
      expect((chats.items as unknown[]).length).toBe(5);
      const mute = await lark.chatUserSettings(["oc_noisy"]);
      expect(JSON.stringify(mute)).toContain("oc_noisy");
      const msgs = await lark.listMessages("oc_group", 1000, 2000);
      expect((msgs.items as unknown[]).length).toBe(5);
      const members = await lark.listMembers("oc_group");
      expect(JSON.stringify(members)).toContain("张三");
      expect(await lark.authStatus()).toEqual({ loggedIn: true, userName: "乔老板" });
    } finally {
      staged.cleanup();
    }
  });
});

describe("未授权态（lark-cli-unauth.sh）", () => {
  it("user_identity → LARK_UNAUTHORIZED（信封 ok=false）", async () => {
    const staged = stageFixture("lark-cli-unauth.sh");
    try {
      const err = await pkyError(createLark(staged.bin).userIdentity());
      expect(err.code).toBe("LARK_UNAUTHORIZED");
      expect(err.message).toContain("not logged in");
    } finally {
      staged.cleanup();
    }
  });

  it("authStatus 报未登录；未初始化配置时授权跳转行带 config init", async () => {
    const staged = stageFixture("lark-cli-unauth.sh");
    try {
      const lark = createLark(staged.bin);
      expect(await lark.authStatus()).toEqual({ loggedIn: false, userName: "飞书用户" });
      expect(await lark.configReady()).toBe(false);
      const line = await authLoginCommandLine(lark, staged.bin);
      expect(line).toContain("config init --new");
      expect(line).toContain("auth login --domain im --recommend");
    } finally {
      staged.cleanup();
    }
  });
});

describe("网络失败态与超时", () => {
  it("非零退出码 → LARK_FETCH_FAILED 携带 stderr 摘要；authStatus 失败按未登录兜底", async () => {
    const staged = stageFixture("lark-cli-fail.sh");
    try {
      const err = await pkyError(createLark(staged.bin).userIdentity());
      expect(err.code).toBe("LARK_FETCH_FAILED");
      expect(err.message).toContain("ETIMEDOUT");
      expect(await createLark(staged.bin).authStatus()).toEqual({ loggedIn: false, userName: "飞书用户" });
    } finally {
      staged.cleanup();
    }
  });

  it("超时杀进程 → LARK_FETCH_FAILED 且含超时秒数", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pky-lark-slow-"));
    const bin = join(dir, "lark-cli");
    writeFileSync(bin, '#!/bin/sh\nsleep 2\nprintf \'%s\' \'{"ok":true,"data":{"open_id":"ou_x"}}\'\n');
    chmodSync(bin, 0o755);
    try {
      const err = await pkyError(createLark(bin, undefined, { api: 300 }).userIdentity());
      expect(err.code).toBe("LARK_FETCH_FAILED");
      expect(err.message).toContain("超时");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it("二进制不存在 → LARK_FETCH_FAILED 带安装指引", async () => {
    const err = await pkyError(createLark("/nonexistent/lark-cli").userIdentity());
    expect(err.code).toBe("LARK_FETCH_FAILED");
    expect(err.hint).toContain("npm install");
  });
});
