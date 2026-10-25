/**
 * crash-diag 环形缓冲（AD §4.3）：helper 运行期把值得排障的事件（坏行、消息丢弃、素材回退、
 * 窗口异常等）滚入固定容量缓冲，崩溃/退出前整段随 crash-diag 上报宿主。
 */

export interface DiagEntry {
  ts: number;
  tag: string;
  detail: string;
}

export const DIAG_CAPACITY = 50;

export class DiagRing {
  private entries: DiagEntry[] = [];
  private readonly capacity: number;
  private readonly now: () => number;

  // 显式字段赋值（不用参数属性——Node 24 原生类型擦除不支持参数属性语法，headless 直跑会炸）
  constructor(capacity: number = DIAG_CAPACITY, now: () => number = () => Date.now()) {
    this.capacity = capacity;
    this.now = now;
  }

  push(tag: string, detail: string): void {
    this.entries.push({ ts: this.now(), tag, detail });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  snapshot(): DiagEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
