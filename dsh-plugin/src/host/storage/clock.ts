/**
 * 单调实时时钟（零依赖模块——与 errors.ts 同为 client bundle 安全例外）：
 * 纯时间格式化/推导不握连接，供 domain 层（如 vocabulary-filters 经 mockPanels 进
 * client bundle）与 storage/dispatch 共用。搬移自 db.ts——db.ts 保留再出口兼容存量
 * 消费面（radio/dispatch 等 host 侧模块）。
 */

/** 进程内单调时钟状态：同毫秒内以微秒序号递增（连续调用值必不同） */
let lastMs = 0;
let lastSeq = 0;

function formatRfc3339(ms: number, seq: number): string {
  const base = new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "");
  return `${base}.${String((ms % 1000) * 1000 + seq).padStart(6, "0")}+00:00`;
}

function monotonicNowRfc3339(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    // 同毫秒（或时钟回拨）：序号 +1 保严格单调；序号超出 6 位小数承载时借下一毫秒
    ms = lastMs;
    lastSeq += 1;
    if (lastSeq > 999_999) {
      ms += 1;
      lastSeq = 0;
    }
  } else {
    lastSeq = 0;
  }
  lastMs = ms;
  return formatRfc3339(ms, lastSeq);
}

/**
 * 当前时刻的 RFC3339 串（UTC，`+00:00` 后缀——与主应用 chrono to_rfc3339 同形态，
 * rfc3339 字典序与时间序一致，跨形态比较 lease/claim 时间戳不失真）。
 * 传入 date = 纯格式化（测试与契约场景注入确定性时钟）；缺省 = 实时单调时钟
 * （微秒精度、连续调用值必不同——Rust oracle 每写点独立 db::now()（chrono 纳秒
 * 精度），毫秒共享会让契约回放的 <ts:N> 归一把「应各占一位的时间戳」塌缩成同值，
 * FR-X3 按夹具对齐）。
 */
export function nowRfc3339(date?: Date): string {
  if (date !== undefined) {
    return date.toISOString().replace("Z", "+00:00");
  }
  return monotonicNowRfc3339();
}

/**
 * RFC3339 串整体平移秒数（保留微秒小数——单调时钟的亚毫秒精度不入 Date 毫秒截断）。
 * 槽租约时长推导用（acquired + leaseSecs —— Rust `t + Duration` 同语义）。
 */
export function shiftRfc3339Seconds(s: string, secs: number): string {
  const frac = /\.(\d{6})\+00:00$/.exec(s)?.[1] ?? "000000";
  const shifted = new Date(Date.parse(s) + secs * 1000);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/, "")}.${frac}+00:00`;
}
