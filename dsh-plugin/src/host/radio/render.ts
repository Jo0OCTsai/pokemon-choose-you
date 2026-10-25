/**
 * 消息体渲染（display 用户版 + anon 大模型版）——行为基准 =
 * src-tauri/src/feishu.rs 的 render_content / render_post_segment / is_media_only /
 * mention_open_id：text/post/interactive 保留语义结构（@人、链接），媒体类给占位符，
 * 无法理解的返回 null 跳过。@到我 渲染成「@我」（atMe 标记），他人匿名版用代号。
 */
import type { AnonRules } from "../domain/anonymize";
import { asArr, asObj, asStr } from "./lark";

/** 渲染产物：display 给用户看（真名原样），anon 送大模型（人名已代号化） */
export interface Rendered {
  display: string;
  anon: string;
  atMe: boolean;
}

/** 纯媒体类消息：保留占位符入上下文，但不送 AI 判定 */
export function isMediaOnly(msgType: string): boolean {
  return ["image", "audio", "media", "file", "sticker", "share_chat", "share_user", "merged_forward"].includes(msgType);
}

/** mention 条目的 open_id：list 接口 id 是字符串，事件推送 v2 是 {open_id} 对象——两种都认 */
export function mentionOpenId(m: Record<string, unknown>): string {
  return asStr(m.id) || asStr(asObj(m.id).open_id);
}

/** 媒体占位符：两版相同（不含人名） */
function placeholder(s: string): Rendered {
  return { display: s, anon: s, atMe: false };
}

interface RenderCtx {
  rules: AnonRules;
  myOpenId: string;
  /** open_id → 姓名（成员缓存；未命中返回 null） */
  resolveName: (openId: string) => string | null;
}

function findMention(mentions: unknown, key: string): Record<string, unknown> | undefined {
  return asArr(mentions).find((m) => asStr(asObj(m).key) === key) as Record<string, unknown> | undefined;
}

/** mention 显示名：@到我 → 「我」；否则 name 字段或成员缓存（render_content 的 mention_name） */
function mentionDisplayName(m: Record<string, unknown>, ctx: RenderCtx): string {
  const oid = mentionOpenId(m);
  if (oid === ctx.myOpenId && ctx.myOpenId !== "") {
    return "我";
  }
  return asStr(m.name) || (oid !== "" ? ctx.resolveName(oid) : null) || "成员";
}

/** text 消息：占位符 key → @显示名/@代号（两种形态同源） */
function renderText(v: Record<string, unknown>, mentions: unknown, ctx: RenderCtx): Rendered | null {
  const raw = asStr(v.text);
  if (raw === "" && !("text" in v)) {
    return null;
  }
  let display = raw;
  let anon = raw;
  for (const m of asArr(mentions)) {
    const mo = asObj(m);
    const key = asStr(mo.key);
    if (key === "") {
      continue;
    }
    const oid = mentionOpenId(mo);
    const displayName =
      oid === ctx.myOpenId && ctx.myOpenId !== ""
        ? "我"
        : asStr(mo.name) || (oid !== "" ? ctx.resolveName(oid) : null) || "成员";
    display = display.split(key).join(`@${displayName}`);
    anon = anon.split(key).join(`@${ctx.rules.aliasCached(oid)}`);
  }
  return { display, anon: ctx.rules.scrub(anon), atMe: false };
}

/** 显式 @到我：消息级 mentions 任一命中我的 open_id（text 占位符与 post 的 at 段同源） */
function mentionsAtMe(mentions: unknown, myOpenId: string): boolean {
  if (myOpenId === "") {
    return false;
  }
  return asArr(mentions).some((m) => mentionOpenId(asObj(m)) === myOpenId);
}

/** post 的 at 段：display 真名（@到我 → 我），匿名版代号（user_key 定位不到时退 user_id/open_id） */
function renderAtSegment(seg: Record<string, unknown>, mentions: unknown, ctx: RenderCtx): [string, string] {
  const key = asStr(seg.user_key);
  const m = key !== "" ? findMention(mentions, key) : undefined;
  const oid = m !== undefined ? mentionOpenId(m) : asStr(seg.user_id) || asStr(seg.open_id);
  const display = m !== undefined ? mentionDisplayName(m, ctx) : oid !== "" ? ctx.resolveName(oid) || "成员" : "成员";
  return [`@${display}`, `@${ctx.rules.aliasCached(oid)}`];
}

const POST_MEDIA_TAGS: Record<string, string> = { img: "[图片]", media: "[视频]", emotion: "[表情]" };

/** post 富文本单元素 → (用户版, 匿名版)：text/a 过词表，at 走真名/代号，媒体占位 */
function renderPostSegment(seg: Record<string, unknown>, mentions: unknown, ctx: RenderCtx): [string, string] {
  const tag = asStr(seg.tag);
  if (tag === "text") {
    const t = asStr(seg.text);
    return [t, ctx.rules.scrub(t)];
  }
  if (tag === "a") {
    const text = asStr(seg.text);
    const href = asStr(seg.href);
    return href !== "" ? [`${text}(${href})`, `${ctx.rules.scrub(text)}(${href})`] : [text, ctx.rules.scrub(text)];
  }
  if (tag === "at") {
    return renderAtSegment(seg, mentions, ctx);
  }
  const media = POST_MEDIA_TAGS[tag];
  return media === undefined ? ["", ""] : [media, media];
}

/** post 富文本：语言包（zh_cn/en_us/ja_jp）优先，段落空元素过滤后以空格连接、段落间换行 */
function renderPost(v: Record<string, unknown>, mentions: unknown, ctx: RenderCtx): Rendered | null {
  const body = ["zh_cn", "en_us", "ja_jp"].map((k) => v[k]).find((x) => x !== undefined && typeof x === "object") ?? v;
  const b = asObj(body);
  const paragraphs = b.content;
  if (!Array.isArray(paragraphs)) {
    return null;
  }
  const displayLines: string[] = [];
  const anonLines: string[] = [];
  const title = asStr(b.title);
  if (title !== "") {
    displayLines.push(title);
    anonLines.push(ctx.rules.scrub(title));
  }
  for (const para of paragraphs) {
    const segs = asArr(para);
    const d: string[] = [];
    const a: string[] = [];
    for (const seg of segs) {
      const [ds, as] = renderPostSegment(asObj(seg), mentions, ctx);
      if (ds !== "") {
        d.push(ds);
      }
      if (as !== "") {
        a.push(as);
      }
    }
    displayLines.push(d.join(" "));
    anonLines.push(a.join(" "));
  }
  return { display: displayLines.join("\n"), anon: anonLines.join("\n"), atMe: false };
}

/** 卡片文本节点收集器（≤500 字符截断；递归遍历数组与对象） */
class CardTextCollector {
  buf = "";

  walk(node: unknown): void {
    if (Array.from(this.buf).length > 500) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((x) => this.walk(x));
      return;
    }
    this.walkObject(node);
  }

  private walkObject(node: unknown): void {
    if (node === null || typeof node !== "object") {
      return;
    }
    for (const [k, x] of Object.entries(node as Record<string, unknown>)) {
      if ((k === "text" || k === "content" || k === "title") && typeof x === "string" && x.trim() !== "") {
        this.buf += `${x} `;
      }
      this.walk(x);
    }
  }
}

/** 卡片消息：递归收集 text/content/title 文本节点拼摘要（≤500 字符），空则跳过 */
function renderInteractive(v: unknown, ctx: RenderCtx): Rendered | null {
  const collector = new CardTextCollector();
  collector.walk(v);
  const buf = collector.buf;
  const s = buf.trim();
  if (s === "") {
    return null;
  }
  return { display: `[卡片] ${s}`, anon: `[卡片] ${ctx.rules.scrub(s)}`, atMe: false };
}

/**
 * 渲染消息 body.content（render_content 同构）：非法 JSON / 未识别类型返回 null。
 * mentions 需由调用方先经 rules.aliasOf 预分配代号（render 只读规则包）。
 */
export function renderContent(msgType: string, content: string, mentions: unknown, ctx: RenderCtx): Rendered | null {
  let v: unknown;
  try {
    v = JSON.parse(content);
  } catch {
    return null;
  }
  const obj = asObj(v);
  const rendered = renderByType(msgType, v, obj, mentions, ctx);
  if (rendered !== null) {
    rendered.atMe = mentionsAtMe(mentions, ctx.myOpenId);
  }
  return rendered;
}

/** 按 msgType 分派渲染（text/post/interactive 语义结构；媒体占位；未知类型 null） */
function renderByType(
  msgType: string,
  raw: unknown,
  obj: Record<string, unknown>,
  mentions: unknown,
  ctx: RenderCtx,
): Rendered | null {
  if (msgType === "text") {
    return renderText(obj, mentions, ctx);
  }
  if (msgType === "post") {
    return renderPost(obj, mentions, ctx);
  }
  if (msgType === "interactive") {
    return renderInteractive(raw, ctx);
  }
  return renderMedia(msgType, obj);
}

const MEDIA_PLACEHOLDERS: Record<string, string> = {
  image: "[图片]",
  audio: "[语音]",
  media: "[视频]",
  sticker: "[表情]",
  share_chat: "[群名片]",
  share_user: "[个人名片]",
  merged_forward: "[合并转发]",
};

/** 媒体类消息：固定占位符（file 带文件名）；未知类型返回 null 跳过 */
function renderMedia(msgType: string, obj: Record<string, unknown>): Rendered | null {
  if (msgType === "file") {
    const name = asStr(obj.file_name);
    return placeholder(name === "" ? "[文件]" : `[文件:${name}]`);
  }
  const p = MEDIA_PLACEHOLDERS[msgType];
  return p === undefined ? null : placeholder(p);
}

/** open_id 过长时截短展示（short_id 同构：前 11 字符） */
export function shortId(id: string): string {
  return Array.from(id).slice(0, 11).join("");
}
