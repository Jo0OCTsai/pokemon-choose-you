import { describe, expect, it } from "vitest";
import { LineDecoder, MAX_LINE_CHARS } from "../src/bridge/lineCodec.ts";

describe("LineDecoder 行协议编解码", () => {
  it("整行解码（单 chunk 单行）", () => {
    const d = new LineDecoder();
    expect(d.push('{"type":"heartbeat"}\n')).toEqual(['{"type":"heartbeat"}']);
  });

  it("半行缓冲：一条消息拆多次 write（无换行直到补齐）只产出一次", () => {
    const d = new LineDecoder();
    expect(d.push('{"type":"task-st')).toEqual([]);
    expect(d.push('ate","ts":1}')).toEqual([]);
    const out = d.push("\n");
    expect(out).toEqual(['{"type":"task-state","ts":1}']);
    expect(d.pending).toBe("");
  });

  it("粘包：一个 chunk 多条完整消息逐行产出", () => {
    const d = new LineDecoder();
    const out = d.push('{"a":1}\n{"b":2}\n{"c":3}');
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
    expect(d.pending).toBe('{"c":3}');
    expect(d.push("\n")).toEqual(['{"c":3}']);
  });

  it("CRLF 容忍（\\r\\n 行尾剥 \\r）", () => {
    const d = new LineDecoder();
    expect(d.push('{"x":1}\r\n')).toEqual(['{"x":1}']);
  });

  it("Buffer 输入与字符串输入等价", () => {
    const d = new LineDecoder();
    expect(d.push(Buffer.from('{"type":"lang"}\n'))).toEqual(['{"type":"lang"}']);
  });

  it("超长行护栏：单行超上限丢弃并计数，不撑爆缓冲", () => {
    const d = new LineDecoder();
    const huge = "x".repeat(MAX_LINE_CHARS + 100);
    const out = d.push(`${huge}\n{"ok":1}\n`);
    expect(out).toEqual(['{"ok":1}']);
    expect(d.droppedOversize).toBe(1);
  });

  it("无换行的超长缓冲直接丢弃（保内存优先）", () => {
    const d = new LineDecoder();
    d.push("y".repeat(MAX_LINE_CHARS + 10));
    expect(d.pending).toBe("");
    expect(d.droppedOversize).toBe(1);
  });
});
