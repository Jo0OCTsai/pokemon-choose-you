// 打包前准备 pk CLI sidecar：Tauri 的 externalBin 要求
// src-tauri/binaries/pk-<target-triple> 命名的二进制。这里按本次构建的目标构建并复制：
// - tauri CLI 会给 beforeBuildCommand 注入 TAURI_ENV_TARGET_TRIPLE（macOS universal 构建时
//   为 universal-apple-darwin，cargo 会编译两个切片并 lipo 成胖二进制，产物在 target/<triple>/ 下）；
// - 本地手动运行脚本时回退到 rustc 宿主三元组（产物路径同样走 target/<triple>/）。
// 由 tauri.conf.json 的 beforeBuildCommand 调用（tauri dev 不需要）。
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execSync("rustc -vV")
    .toString()
    .match(/host: (\S+)/)?.[1];
if (!triple) throw new Error("无法获取构建目标（TAURI_ENV_TARGET_TRIPLE 缺失且 rustc 不可用）");

execSync(
  `cargo build --release --bin pk --target ${triple} --manifest-path ${manifest}`,
  { cwd: root, stdio: "inherit" },
);

const ext = process.platform === "win32" ? ".exe" : "";
const src = join(root, "src-tauri", "target", triple, "release", `pk${ext}`);
const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, `pk-${triple}${ext}`));
console.log(`pk-cli sidecar ready: pk-${triple}${ext}`);
