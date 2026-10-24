/**
 * radio/render：renderContent 各消息形态——对齐 Rust feishu.rs 的 render_content
 * 测试组（text @提及/at_me、手打名字、post 富文本/语言包/媒体占位、interactive 卡片、
 * 非法 JSON/未知类型跳过、isMediaOnly、shortId）。
 */
import { describe, expect, it } from "vitest";
import { AnonRules } from "../src/host/domain/anonymize";
import { isMediaOnly, renderContent, shortId } from "../src/host/radio/render";
import { createTestDb } from "./helpers";

/** 规则包（内存库 + 固定身份：我=ou_me/乔老板，张三=ou_z/成员_00aa） */
function renderRules(myName: string): AnonRules {
  const db = createTestDb();
  const { conn } = db;
  conn.exec("INSERT INTO settings (key, value) VALUES ('feishu_my_open_id', 'ou_me')");
  if (myName !== "") {
    conn.exec(`INSERT INTO settings (key, value) VALUES ('feishu_my_name', '${myName}')`);
  }
  conn.exec(
    "INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', '2026-09-01')",
  );
  const rules = AnonRules.build(conn);
  db.close();
  return rules;
}

function ctxOf(myName = "", names: Map<string, string> = new Map()) {
  return { rules: renderRules(myName), myOpenId: "ou_me", resolveName: (oid: string) => names.get(oid) ?? null };
}

describe("text 消息", () => {
  it("mention 占位符还原：display 真名、anon 代号；@到我 双版渲染「@我」并标 atMe", () => {
    const ctx = ctxOf("");
    const content = JSON.stringify({ text: "@_user_1 看一下这个" });
    const mentions = [{ key: "@_user_1", name: "张三", id: { open_id: "ou_z" } }];
    const r = renderContent("text", content, mentions, ctx);
    expect(r?.display).toBe("@张三 看一下这个");
    expect(r?.anon).toBe("@成员_00aa 看一下这个");
    expect(r?.atMe).toBe(false);
    const toMe = [{ key: "@_user_1", name: "本大爷", id: { open_id: "ou_me" } }];
    const r2 = renderContent("text", content, toMe, ctx);
    expect(r2?.display).toBe("@我 看一下这个");
    expect(r2?.anon).toBe("@我 看一下这个");
    expect(r2?.atMe).toBe(true);
  });

  it("list 接口的字符串 id 形态同样解析（回归口径）", () => {
    const ctx = ctxOf("");
    const mentions = [{ key: "@_user_1", id: "ou_z", id_type: "open_id", name: "张三" }];
    const r = renderContent("text", JSON.stringify({ text: "@_user_1 看一下这个" }), mentions, ctx);
    expect(r?.display).toBe("@张三 看一下这个");
    expect(r?.anon).toBe("@成员_00aa 看一下这个");
  });

  it("无 mentions 映射时 display 保留原文", () => {
    const r = renderContent("text", JSON.stringify({ text: "@_user_1 看一下这个" }), null, ctxOf(""));
    expect(r?.display).toBe("@_user_1 看一下这个");
  });

  it("手打文本命中称呼（无 mention 结构）：anon 里我的称呼→（疑似@我）、成员→代号", () => {
    const r = renderContent("text", JSON.stringify({ text: "乔老板帮我看下，再找张三对一遍" }), null, ctxOf("乔老板"));
    expect(r?.display).toBe("乔老板帮我看下，再找张三对一遍");
    expect(r?.anon).toContain("（疑似@我）帮我看下");
    expect(r?.anon).toContain("找成员_00aa对一遍");
    expect(r?.anon).not.toContain("乔老板");
    expect(r?.anon).not.toContain("张三");
  });
});

describe("post 富文本", () => {
  it("标题单独成行；at 段真名/代号；a 段带 href；图片占位", () => {
    const names = new Map([["ou_z", "张三"]]);
    const ctx = ctxOf("", names);
    const content = JSON.stringify({
      title: "纪要",
      content: [
        [
          { tag: "text", text: "周三前" },
          { tag: "at", user_id: "ou_z" },
          { tag: "a", text: "需求文档", href: "https://doc.example/x" },
          { tag: "img", image_key: "k" },
        ],
      ],
    });
    const r = renderContent("post", content, null, ctx);
    expect(r?.display.startsWith("纪要\n")).toBe(true);
    expect(r?.display).toContain("周三前");
    expect(r?.display).toContain("@张三");
    expect(r?.display).toContain("需求文档(https://doc.example/x)");
    expect(r?.display).toContain("[图片]");
    expect(r?.anon).toContain("@成员_00aa");
    expect(r?.anon).not.toContain("张三");
  });

  it("语言包形态取 zh_cn；at 段经 mentions user_key 定位（@到我 → 我）", () => {
    const ctx = ctxOf("");
    const content = JSON.stringify({
      title: "外层",
      zh_cn: { title: "中文标题", content: [[{ tag: "text", text: "你好" }]] },
    });
    expect(renderContent("post", content, null, ctx)?.display).toBe("中文标题\n你好");
    const atContent = JSON.stringify({ content: [[{ tag: "at", user_key: "@_user_1" }]] });
    const mentions = [{ key: "@_user_1", name: "本大爷", id: "ou_me" }];
    const r = renderContent("post", atContent, mentions, ctx);
    expect(r?.display).toContain("@我");
    expect(r?.anon).toContain("@我");
    expect(r?.atMe).toBe(true);
  });

  it("emotion/video 段占位；无 content 数组返回 null", () => {
    const ctx = ctxOf("");
    const content = JSON.stringify({ content: [[{ tag: "emotion" }, { tag: "media" }]] });
    expect(renderContent("post", content, null, ctx)?.display).toBe("[表情] [视频]");
    expect(renderContent("post", JSON.stringify({ title: "x" }), null, ctx)).toBeNull();
  });
});

describe("卡片与媒体占位", () => {
  it("interactive 收集 text/content/title 文本节点，前缀 [卡片]，人名过词表", () => {
    const ctx = ctxOf("乔老板");
    const content = JSON.stringify({
      header: { title: { content: "审批提醒" } },
      elements: [{ tag: "div", text: { text: "乔老板提交了请假申请" } }],
    });
    const r = renderContent("interactive", content, null, ctx);
    expect(r?.display.startsWith("[卡片]")).toBe(true);
    expect(r?.display).toContain("审批提醒");
    expect(r?.display).toContain("请假申请");
    expect(r?.anon).toContain("（疑似@我）提交了请假申请");
    expect(renderContent("interactive", JSON.stringify({ a: 1 }), null, ctx)).toBeNull();
  });

  it("媒体占位与 file 名；未知类型/非法 JSON 跳过", () => {
    const ctx = ctxOf("");
    expect(renderContent("image", JSON.stringify({ image_key: "k" }), null, ctx)?.display).toBe("[图片]");
    expect(renderContent("audio", "{}", null, ctx)?.display).toBe("[语音]");
    expect(renderContent("sticker", "{}", null, ctx)?.display).toBe("[表情]");
    expect(renderContent("share_chat", "{}", null, ctx)?.display).toBe("[群名片]");
    expect(renderContent("share_user", "{}", null, ctx)?.display).toBe("[个人名片]");
    expect(renderContent("merged_forward", "{}", null, ctx)?.display).toBe("[合并转发]");
    expect(renderContent("file", JSON.stringify({ file_name: "合同.pdf" }), null, ctx)?.display).toBe(
      "[文件:合同.pdf]",
    );
    expect(renderContent("file", JSON.stringify({}), null, ctx)?.display).toBe("[文件]");
    expect(renderContent("system", "{}", null, ctx)).toBeNull();
    expect(renderContent("text", "not-json", null, ctx)).toBeNull();
  });
});

describe("词表与辅助", () => {
  it("isMediaOnly 覆盖全部媒体类型；短 id 截 11 字符", () => {
    for (const t of ["image", "audio", "media", "file", "sticker", "share_chat", "share_user", "merged_forward"]) {
      expect(isMediaOnly(t)).toBe(true);
    }
    expect(isMediaOnly("text")).toBe(false);
    expect(isMediaOnly("interactive")).toBe(false);
    expect(shortId("ou_abcdef1234567890")).toBe("ou_abcdef12");
  });
});
