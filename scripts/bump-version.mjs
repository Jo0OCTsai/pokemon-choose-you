// pnpm bump <version> —— 抬高开发版本：同步 package.json / tauri.conf.json / Cargo.toml，
// 并把 Cargo.lock 里本包条目的版本一并对齐（免得 lock 落后于 Cargo.toml）。
// bump 之后 push main，release.yml 自然开始构建新版本的草稿。
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next ?? "")) {
  console.error("用法: pnpm bump <version>，如 pnpm bump 1.1.0");
  process.exit(1);
}

const targets = [
  ["package.json", /("version"\s*:\s*")[^"]+/, "npm 包"],
  ["src-tauri/tauri.conf.json", /("version"\s*:\s*")[^"]+/, "应用配置"],
  ["src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+/m, "crate"],
];
for (const [file, re, label] of targets) {
  writeFileSync(file, readFileSync(file, "utf8").replace(re, `$1${next}`));
  console.log(`✔ ${file}（${label}）→ ${next}`);
}

// Cargo.lock 只改 pokemon-choose-you 条目；匹配不到时提示交给 cargo 重建
const lock = "src-tauri/Cargo.lock";
const content = readFileSync(lock, "utf8");
const entry = /(\[\[package\]\]\nname = "pokemon-choose-you"\nversion = ")[^"]+/.exec(content);
if (entry) {
  writeFileSync(lock, content.replace(entry[0], `${entry[1]}${next}`));
  console.log(`✔ ${lock}（本包条目）→ ${next}`);
} else {
  console.log(`⚠ ${lock} 未匹配到本包条目，跑一次 cargo check 会自动同步`);
}
