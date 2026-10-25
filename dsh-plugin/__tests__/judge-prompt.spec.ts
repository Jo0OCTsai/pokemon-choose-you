/**
 * judge/prompt：批组装（假名化/上下文/归属标注）、来源标签、prompt 拼装
 * （override resolve 三态回落 + <AGENT_ID> 替换 + 消息渲染形态）、真名零出现。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAiMessages,
  buildCapturePrompt,
  buildJudgePrompt,
  chatLabel,
  chatLabelAnon,
  mentionNote,
  renderMessages,
  type AiMessage,
} from "../src/host/judge/prompt";
import { AnonRules } from "../src/host/domain/anonymize";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

interface SeedOpts {
  chat_id?: string;
  chat_name?: string;
  chat_type?: string;
  sender_id?: string;
  content?: string;
  content_anon?: string;
  at_me?: string;
  sent_at?: number;
  is_self?: number;
}

function seedChatMessage(mid: string, opts: SeedOpts): void {
  const o = {
    chat_id: "",
    chat_name: "",
    chat_type: "",
    sender_id: "",
    content: "内容",
    content_anon: "",
    at_me: "",
    sent_at: null as number | null,
    is_self: 0,
    ...opts,
  };
  db.conn
    .prepare(
      "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id, content, " +
        "content_anon, at_me, sent_at, is_self, ai_status, review_status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', '2026-10-11T00:00:00+00:00')",
    )
    .run(
      mid,
      o.chat_id,
      o.chat_name,
      o.chat_type,
      "",
      o.sender_id,
      o.content,
      o.content_anon,
      o.at_me,
      o.sent_at,
      o.is_self,
    );
}

describe("来源标签", () => {
  it("chatLabel 四型 + 兜底；群名不脱敏、单聊对方名 scrub", () => {
    expect(chatLabel("bot", "皮卡丘助手")).toBe("飞书·机器人私聊");
    expect(chatLabel("p2p", "李四")).toBe("飞书·私聊「李四」");
    expect(chatLabel("group", "项目群")).toBe("飞书·群聊「项目群」");
    expect(chatLabel("local", "")).toBe("手动输入·快速捕捉");
    expect(chatLabel("", "")).toBe("飞书");
    db.conn
      .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', 't')")
      .run();
    const rules = AnonRules.build(db.conn);
    expect(chatLabelAnon(rules, "group", "项目攻坚群")).toBe("飞书·群聊「项目攻坚群」");
    expect(chatLabelAnon(rules, "p2p", "张三")).toBe("飞书·私聊「成员_00aa」");
    expect(chatLabelAnon(rules, "p2p", "陌生人名X")).toBe("飞书·私聊「陌生人名X」");
  });
});

describe("归属标注（mentionNote）", () => {
  it("at/name 两级 + 同名风险叠加；空 at_me 无标注", () => {
    expect(mentionNote("", false)).toBe("");
    expect(mentionNote("at", false)).toBe("提及：@我（显式）");
    expect(mentionNote("name", false)).toBe("提及：疑似@我（本地名字匹配，可能有误差）");
    expect(mentionNote("name", true)).toContain("群内存在同名成员");
  });
});

/** 上下文窗口用种子：同会话六条（窗口内我+他人、窗后、超窗、他会话）+ 目标消息 */
function seedContextCorpus(): void {
  const t = 1_789_200_000_000;
  db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_my_open_id', 'ou_me')").run();
  db.conn
    .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_li', '李四', '成员_00dd', 't')")
    .run();
  const group = { chat_id: "oc_g", chat_name: "项目群", chat_type: "group" };
  seedChatMessage("om_me", {
    ...group,
    sender_id: "ou_me",
    is_self: 1,
    sent_at: t - 60_000,
    content: "我的显示名说话",
  });
  seedChatMessage("om_other", {
    ...group,
    sender_id: "ou_li",
    sent_at: t - 30_000,
    content: "李四说事",
    content_anon: "成员_00dd 说事",
  });
  seedChatMessage("om_after", { chat_id: "oc_g", sent_at: t + 10_000, sender_id: "ou_li" });
  seedChatMessage("om_stale", { chat_id: "oc_g", sent_at: t - 40 * 60_000, sender_id: "ou_li" });
  seedChatMessage("om_else", { chat_id: "oc_h", sent_at: t - 10_000, sender_id: "ou_li" });
  seedChatMessage("om_target", {
    ...group,
    sender_id: "ou_li",
    sent_at: t,
    content: "李四派活",
    content_anon: "成员_00dd 派活",
    at_me: "at",
  });
}

describe("buildAiMessages（批组装）", () => {
  it("发送者代号化、30 分钟上下文窗口、归属标注进批", () => {
    seedContextCorpus();
    const batch = buildAiMessages(db.conn, ["om_target", "om_missing"], "2026-10-11T00:00:00+00:00");
    expect(batch.length).toBe(1);
    const m = batch[0];
    expect(m.sender).toBe("成员_00dd");
    expect(m.chatLabel).toBe("飞书·群聊「项目群」");
    expect(m.content).toBe("成员_00dd 派活");
    expect(m.mentionNote).toBe("提及：@我（显式）");
    expect(m.context.length).toBe(2);
    expect(m.context[0]).toContain("我: 我的显示名说话");
    expect(m.context[0]).not.toContain("我的显示名: ");
    expect(m.context[1]).toContain("成员_00dd: 成员_00dd 说事");
  });
});

describe("buildAiMessages · 老数据兜底", () => {
  it("content_anon 为空的老数据现场 scrub 真名", () => {
    db.conn
      .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_li', '李四', '成员_00dd', 't')")
      .run();
    seedChatMessage("om_old", {
      chat_id: "oc_g",
      chat_type: "group",
      sender_id: "ou_li",
      content: "李四提到王五",
      content_anon: "",
    });
    const batch = buildAiMessages(db.conn, ["om_old"]);
    expect(batch[0].content).toContain("成员_00dd");
    expect(batch[0].content).not.toContain("李四");
  });
});

/** 判定 prompt 的固定批样本 */
const batch: AiMessage[] = [
  {
    messageId: "om_9",
    sender: "老板",
    chatLabel: "飞书·私聊「老板」",
    content: "明天 10 点开周会",
    context: [],
    mentionNote: "",
  },
];

describe("buildJudgePrompt / buildCapturePrompt", () => {
  it("默认系统提示词 + 消息正文 + <AGENT_ID> 替换；不内嵌判重上下文", () => {
    const prompt = buildJudgePrompt(db.conn, "ag2", batch);
    expect(prompt).toContain("pk suggest batch");
    expect(prompt).toContain("--agent ag2");
    expect(prompt).toContain("[om_9]");
    expect(prompt).toContain("来源：飞书·私聊「老板」");
    expect(prompt).toContain("发送者：老板");
    expect(prompt).toContain("内容：明天 10 点开周会");
    expect(prompt).not.toContain("<AGENT_ID>");
    expect(prompt).not.toContain("最终回复必须只包含一个 JSON 对象");
  });
});

describe("buildJudgePrompt · 覆盖三态", () => {
  it("自定义覆盖生效（im_classify）：默认文本不出现、占位符已替换；坏覆盖回落默认", () => {
    db.conn
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('ai_prompt_im_classify', '我的分类规则，agent 是 <AGENT_ID>。')",
      )
      .run();
    const prompt = buildJudgePrompt(db.conn, "ag9", batch);
    expect(prompt).toContain("我的分类规则，agent 是 ag9");
    expect(prompt).not.toContain("<AGENT_ID>");
    expect(prompt).not.toContain("你是待办事项提取助手");
    expect(prompt).toContain("[om_9]");
    // 坏覆盖（缺占位符）→ default_warned 回落默认，不挂管道
    db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_prompt_im_classify', '没有占位符的覆盖')")
      .run();
    expect(buildJudgePrompt(db.conn, "ag9", batch)).toContain("你是待办事项提取助手");
  });

  it("capture prompt：CAPTURE 系统提示词 + 单条输入", () => {
    const input: AiMessage = {
      messageId: "cap_1",
      sender: "我",
      chatLabel: "手动输入·快速捕捉",
      content: "明早寄快递",
      context: [],
      mentionNote: "",
    };
    const prompt = buildCapturePrompt(db.conn, "ag1", input);
    expect(prompt).toContain("待办事项录入助手");
    expect(prompt).toContain("[cap_1]");
    expect(prompt).toContain("内容：明早寄快递");
    expect(prompt).toContain("--agent ag1");
  });

  it("renderMessages：归属标注行位于发送者与内容之间；上下文行缩进呈现", () => {
    const out = renderMessages([
      {
        messageId: "om_1",
        sender: "成员_00aa",
        chatLabel: "飞书·群聊「项目群」",
        content: "@我 周会改到周四10点",
        context: ["[09:00] 我: 前情"],
        mentionNote: "提及：@我（显式）",
      },
    ]);
    expect(out).toContain("提及：@我（显式）\n内容：");
    expect(out).toContain("同会话上下文（仅供参考）：\n  [09:00] 我: 前情");
  });
});
