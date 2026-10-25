/**
 * fake helper 子进程（pet 集成测试替身）：以 node 直跑，说桥协议（stdio JSON 行，
 * 与 helper/src/bridge/protocol.ts 同一协议）。能力全部经 argv 编程——
 *   --log=<path>        把收到的下行/发出的上行消息追加记录为 JSON 行（断言用）
 *   --emit-cmd=<op>     hello 后即发一条 cmd（--emit-task-id=<id> 指定 taskId）
 *   --emit-focus=<ids>  hello 后按逗号分隔逐个发 focus-settle（同 id 发两次驱动幂等）
 *   --crash-after=<ms>  自杀（崩溃自拉起测试）
 *   --die-on=<n>        收到第 n 条下行后自杀（状态送达后崩溃测试）
 *   --mute=1            不发 hello（握手超时分支）
 */
import { appendFileSync } from "node:fs";

const argv = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z-]+)=(.*)$/.exec(arg);
  if (m) argv[m[1]] = m[2];
}

const log = argv.log === undefined ? () => {} : (entry) => appendFileSync(argv.log, `${JSON.stringify(entry)}\n`);

function send(msg) {
  // 先落日志再写管道：宿主收到消息时日志必已就位（测试回读无竞态）
  log({ dir: "out", msg });
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

if (argv.mute === undefined) {
  send({ type: "hello", version: "fake-1", caps: ["task-state", "pomodoro"] });
}
if (argv["emit-cmd"] !== undefined) {
  const cmd = { type: "cmd", op: argv["emit-cmd"] };
  if (argv["emit-task-id"] !== undefined) cmd.taskId = Number(argv["emit-task-id"]);
  send(cmd);
}
if (argv["emit-focus"] !== undefined) {
  for (const id of String(argv["emit-focus"]).split(",")) {
    send({ type: "focus-settle", taskId: 1, localSessionId: id, elapsedMin: 5 });
  }
}
if (argv["crash-after"] !== undefined) {
  setTimeout(() => process.exit(1), Number(argv["crash-after"]));
}

let buffer = "";
let downstream = 0;
process.stdin.on("data", (chunk) => {
  buffer += String(chunk);
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    downstream++;
    log({ dir: "in", msg });
    if (argv["die-on"] !== undefined && downstream >= Number(argv["die-on"])) {
      process.exit(1);
    }
  }
});
