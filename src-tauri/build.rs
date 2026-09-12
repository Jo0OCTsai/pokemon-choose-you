fn main() {
    // bundle.externalBin 的 pk sidecar 在打包前由 scripts/prepare-pk-cli.mjs 用真实二进制覆盖；
    // 开发期 cargo build/check 也会校验该资源，这里先放占位文件避免失败（binaries/ 已 gitignore）。
    // Windows 上 sidecar 校验带 .exe 后缀（占位与真实文件命名必须一致，否则打包失败）。
    // 注意不能判 CARGO_CFG_WINDOWS == "1"：布尔 cfg 的值是空字符串，用 TARGET 三元组判断。
    if let Ok(triple) = std::env::var("TARGET") {
        if !triple.is_empty() {
            let ext = if triple.contains("windows") {
                ".exe"
            } else {
                ""
            };
            let dir = std::path::Path::new("binaries");
            let _ = std::fs::create_dir_all(dir);
            let path = dir.join(format!("pk-{triple}{ext}"));
            if !path.exists() {
                let _ = std::fs::write(&path, b"");
                println!(
                    "cargo:warning=created placeholder sidecar {}",
                    path.display()
                );
            }
        }
    }
    tauri_build::build()
}
