// 打包前准备 pk CLI sidecar：Tauri 的 externalBin 要求
// src-tauri/binaries/pk-<target-triple> 命名的二进制，这里构建并复制过去。
// 由 tauri.conf.json 的 beforeBuildCommand 调用（tauri dev 不需要）。
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");
const triple = execSync("rustc -vV")
  .toString()
  .match(/host: (\S+)/)?.[1];
if (!triple) throw new Error("无法获取 rustc target triple");

execSync(`cargo build --release --bin pk --manifest-path ${manifest}`, {
  cwd: root,
  stdio: "inherit",
});

const ext = process.platform === "win32" ? ".exe" : "";
const src = join(root, "src-tauri", "target", "release", `pk${ext}`);
const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, `pk-${triple}${ext}`));
console.log(`pk-cli sidecar ready: pk-${triple}${ext}`);
