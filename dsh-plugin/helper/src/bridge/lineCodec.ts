/**
 * 行协议编解码：每行一个 JSON 对象（AD §4.3）。半行缓冲（chunk 跨行/跨消息切分）与
 * 超长行保护（防无换行超大 chunk 撑爆内存）都在这里；坏行语义（JSON 解析失败等）由
 * 上层 bridge 计数——decoder 只负责把字节流切成行。
 */

/** 单行上限（字符）：task-state 带 todayTasks 也在几十 KB 内，1MB 是防失控护栏 */
export const MAX_LINE_CHARS = 1_000_000;

export class LineDecoder {
  private buf = "";
  /** 因超长被丢弃的行数（观测口径，随 crash-diag 上报） */
  droppedOversize = 0;

  /** 喂入一个 chunk（字符串或 Buffer），返回切出的完整行（不含换行；\r\n 容忍） */
  push(chunk: string | Uint8Array): string[] {
    this.buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const lines: string[] = [];
    for (;;) {
      const idx = this.buf.indexOf("\n");
      if (idx < 0) break;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.length > MAX_LINE_CHARS) {
        this.droppedOversize++;
        continue;
      }
      lines.push(trimmed);
    }
    // 无换行但缓冲超限：整段视为损坏行丢弃（保内存优先，语义已不可信）
    if (this.buf.length > MAX_LINE_CHARS) {
      this.droppedOversize++;
      this.buf = "";
    }
    return lines;
  }

  /** 当前半行残余（诊断用；正常路径换行齐了不会有余量） */
  get pending(): string {
    return this.buf;
  }
}
