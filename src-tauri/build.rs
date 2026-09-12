fn main() {
    // bundle.externalBin 的 pk sidecar 在打包前由 scripts/prepare-pk-cli.mjs 用真实二进制覆盖；
    // 开发期 cargo build/check 也会校验该资源，这里先放占位文件避免失败（binaries/ 已 gitignore）
    if let Ok(triple) = std::env::var("TARGET") {
        if !triple.is_empty() {
            let dir = std::path::Path::new("binaries");
            let _ = std::fs::create_dir_all(dir);
            let path = dir.join(format!("pk-{triple}"));
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
