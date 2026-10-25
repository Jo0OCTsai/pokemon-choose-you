/**
 * fake shell 脚本装配件：把 __tests__/fixtures/ 的替身脚本复制到临时目录并加执行位
 * （checked-in 脚本不依赖 git 可执行位；每测试独立副本可按需追加内联脚本）。
 */
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** 拷一个 fixture 脚本到临时目录（0755），返回绝对路径 */
export function stageFixture(name: string): { bin: string; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pky-fake-lark-"));
  const bin = join(dir, name);
  copyFileSync(join(FIXTURES, name), bin);
  chmodSync(bin, 0o755);
  return { bin, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 写一个内联 shell 脚本（0755）——超时/慢响应等一次性替身 */
export function writeScript(dir: string, name: string, body: string): string {
  const bin = join(dirname(dir) === dir ? dir : dir, name);
  writeFileSync(bin, body, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
}
