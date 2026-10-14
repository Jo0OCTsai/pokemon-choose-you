/**
 * electron 形态 spawner 回归（2026-10-14 桌宠不显示根因）：入口必须传 dist/main.js
 * **文件**——此前传 dist 目录，Electron default_app 因目录内无 package.json/index.js
 * 解析失败弹原生错误框后 exit(1)，supervisor 每秒重启成死循环、桌宠永远不显示。
 * 用 node 假扮 electron 二进制，断言子进程 argv 形态与 electron 加载 .js 入口时同构
 * （argv.slice(2) = 业务参数，与 helper main.ts 的 parseArgs 口径一致）。
 */
import { join } from "node:path";
import { expect, it } from "vitest";
import { electronSpawner } from "../src/host/pet/supervisor";

const ARGV_DUMP = join(import.meta.dirname, "fixtures", "argv-dump.mjs");
const ENTRY = join(import.meta.dirname, "fixtures", "fake-helper.mjs");

function collectArgv(args: string[]): Promise<{ code: number | null; argv: string[] }> {
  const child = electronSpawner(process.execPath, ARGV_DUMP).spawn(args);
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += String(chunk);
  });
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve({ code, argv: JSON.parse(out) as string[] }));
  });
}

it("spawn 参数 = [入口文件, ...业务参数]——入口是文件路径而非所在目录", async () => {
  const { code, argv } = await collectArgv(["--host-pid=1", "--pos=120,240"]);
  expect(code).toBe(0);
  expect(argv[0]).toBe(ARGV_DUMP); // 回归位：曾错传 dirname(入口) 目录
  expect(argv.slice(1)).toEqual(["--host-pid=1", "--pos=120,240"]);
});

it("无业务参数时仅入口文件（helper parseArgs 的空参分支）", async () => {
  const { argv } = await collectArgv([]);
  expect(argv).toEqual([ARGV_DUMP]);
});

it("入口换成协议脚本（node 直跑 fake-helper 同构）：stdin/stdout 管道可供桥挂载", async () => {
  const child = electronSpawner(process.execPath, ENTRY).spawn([`--mute=1`]);
  expect(child.pid).toBeGreaterThan(0);
  expect(typeof (child.stdin as { write?: unknown }).write).toBe("function");
  child.kill("SIGTERM"); // fake-helper 随信号退出（pet-supervisor hide 同口径；信号终 code=null 属正常）
  let exited = false;
  await new Promise<void>((resolve) =>
    child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );
  expect(exited).toBe(true);
});
