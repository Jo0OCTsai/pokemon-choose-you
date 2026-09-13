// 打包前准备 pk CLI sidecar：Tauri 的 externalBin 要求
// src-tauri/binaries/pk-<target-triple> 命名的二进制。这里按本次构建的目标构建并复制：
// - tauri CLI 会给 beforeBuildCommand 注入 TAURI_ENV_TARGET_TRIPLE；
// - universal-apple-darwin 时 rustc 没有对应目标（Tauri CLI 内部也是双架构 + lipo），
//   分别构建 aarch64 / x86_64 再用 lipo 合成胖二进制；
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

const ext = process.platform === "win32" ? ".exe" : "";
const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `pk-${triple}${ext}`);

const build = (target) => {
  execSync(`cargo build --release --bin pk --target ${target} --manifest-path ${manifest}`, {
    cwd: root,
    stdio: "inherit",
  });
  return join(root, "src-tauri", "target", target, "release", `pk${ext}`);
};

if (triple === "universal-apple-darwin") {
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map(build);
  execSync(`lipo -create -output ${out} ${slices.join(" ")}`, {
    cwd: root,
    stdio: "inherit",
  });
  // 打包器要求每个 bundle 二进制都在 target/<triple>/release 下：主程序由 tauri
  // CLI 双架构 lipo，pk 需要这里同步补一份，否则 .app 打包报 pk does not exist
  const targetDir = join(root, "src-tauri", "target", triple, "release");
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(out, join(targetDir, "pk"));
} else {
  copyFileSync(build(triple), out);
}
console.log(`pk-cli sidecar ready: pk-${triple}${ext}`);
