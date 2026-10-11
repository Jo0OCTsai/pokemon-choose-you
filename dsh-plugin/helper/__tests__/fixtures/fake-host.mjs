#!/usr/bin/env node
/**
 * fake host（契约测试的插件宿主半边替身；AD §3.3「standalone 伪 ctx 模式」的桥版本）：
 * 真 stdio JSON 行与 helper 桥模块互发全集消息——stdin 收 helper 上行（hello/cmd/focus-settle/
 * crash-diag，逐条回显到 stderr 供断言），stdout 按 mode 下发下行全集。
 *
 * 用法：node fake-host.mjs [mode]
 *   handshake（默认）：收到 hello 后下发 task-state/pomodoro-config/lang/sprites/heartbeat 全集
 *   bad：先发一行坏 JSON，再发合法 heartbeat（断言坏行计错不崩）
 *   split：一条合法 task-state 拆两次 write（半行缓冲断言）
 *   sticky：两条完整消息一次 write（粘包断言）
 *   quiet：发一条 heartbeat 后永久静默（心跳超时判死断言）
 *   invalid：合法 JSON 但缺字段/未知 type（校验丢弃+计错断言）
 */
import { once } from "node:events";

const mode = process.argv[2] ?? "handshake";
const DOWN = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const REPORT = (obj) => process.stderr.write(`${JSON.stringify(obj)}\n`);

function downstreamSet() {
  DOWN(taskStateLine({ id: 7, title: "写周报", categoryPokemon: "pikachu", status: "active" }, 2, 1));
  DOWN({ type: "pomodoro-config", durations: [15, 25, 45, 60], breakMin: 5, lang: "zh-Hans" });
  DOWN({ type: "lang", lang: "en" });
  DOWN(spritesLine());
  DOWN({ type: "heartbeat", ts: Date.now() });
}

function taskStateLine(task, pending, failures) {
  const line = {
    type: "task-state",
    activeTask: task,
    badge: { pendingSuggestions: pending, failures },
    ts: Date.now(),
  };
  if (task) line.todayTasks = [task, { id: 8, title: "修复构建", categoryPokemon: "psyduck", status: "inbox" }];
  return line;
}

function spritesLine() {
  return {
    type: "sprites",
    builtin: [
      { key: "pikachu", id: 25, name: { hans: "皮卡丘", hant: "皮卡丘", en: "Pikachu" } },
      { key: "psyduck", id: 54, name: { hans: "可达鸭", hant: "可達鴨", en: "Psyduck" } },
    ],
    cdnBase: "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon",
  };
}

/** hello 之后按 mode 下发（每模式一个小函数，分支摊平） */
function respondToHello() {
  const senders = {
    handshake: downstreamSet,
    bad: sendBadThenHeartbeat,
    split: sendSplitTaskState,
    sticky: sendSticky,
    // quiet：发一条 heartbeat 后永久静默——helper 侧心跳超时判死
    quiet: () => DOWN({ type: "heartbeat", ts: Date.now() }),
    invalid: sendInvalid,
  };
  (senders[mode] ?? downstreamSet)();
}

function sendBadThenHeartbeat() {
  process.stdout.write("not-json{{{");
  process.stdout.write("\n");
  DOWN({ type: "heartbeat", ts: Date.now() });
}

function sendSplitTaskState() {
  const payload = JSON.stringify(taskStateLine(null, 0, 0));
  const cut = Math.floor(payload.length / 2);
  process.stdout.write(payload.slice(0, cut)); // 前半（无换行）
  setTimeout(() => {
    process.stdout.write(payload.slice(cut));
    process.stdout.write("\n");
    DOWN({ type: "heartbeat", ts: Date.now() });
  }, 120);
}

function sendSticky() {
  process.stdout.write(
    `${JSON.stringify({ type: "heartbeat", ts: 1 })}\n${JSON.stringify({ type: "lang", lang: "zh-Hant" })}\n`,
  );
}

function sendInvalid() {
  DOWN({ type: "task-state", activeTask: { id: 1 }, ts: Date.now() }); // 缺 badge/字段不全
  DOWN({ type: "bogus-type" }); // 未知 type
  DOWN({ type: "heartbeat", ts: Date.now() }); // 仍应送达
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  for (;;) {
    const idx = buf.indexOf("\n");
    if (idx < 0) break;
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    handleLine(line);
  }
});

function handleLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    REPORT({ got: "bad-json-upstream" });
    return;
  }
  REPORT({
    got: msg.type,
    op: msg.op ?? null,
    taskId: msg.taskId ?? null,
    localSessionId: msg.localSessionId ?? null,
  });
  if (msg.type === "hello") respondToHello();
}

// stdin 关闭即结束（宿主退场）
await once(process.stdin, "end");
