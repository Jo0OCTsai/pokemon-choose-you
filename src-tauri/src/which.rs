//! 裸命令名 → 绝对路径解析。从 Dock/Finder/启动台启动的 GUI 进程不继承登录
//! shell 的 PATH（macOS 上通常只有 /usr/bin:/bin:/usr/sbin:/sbin），npm/brew
//! 安装的 CLI（lark-cli、claude 等）直接 Command::new 会 NotFound。
//! 统一走 resolve：先按进程 PATH，再补扫常见安装目录；找不到原样返回交由调用方报错。

/// 把裸命令名解析成绝对路径：先按进程 PATH，再补扫 GUI 进程拿不到的
/// npm 全局安装常见目录。找不到时原样返回，由调用方给出安装指引。
pub fn resolve(bin: &str) -> String {
    resolve_in(
        bin,
        std::env::var_os("PATH"),
        std::env::var_os("HOME")
            .as_deref()
            .map(std::path::Path::new),
    )
}

/// 子进程环境用的 PATH：进程原 PATH 在前、补扫目录在后。
/// lark-cli / claude 等 CLI 多为 node 脚本（shebang `#!/usr/bin/env node`），
/// 解析到 CLI 本体的绝对路径还不够——shebang 里的 `env node` 按子进程 PATH
/// 找解释器，GUI 进程的 PATH 里没有 node 时退出码 127（env: node not found）。
pub fn child_path() -> std::ffi::OsString {
    child_path_in(
        std::env::var_os("PATH"),
        std::env::var_os("HOME")
            .as_deref()
            .map(std::path::Path::new),
    )
}

/// child_path 的纯函数版（测试用）。
fn child_path_in(
    path_env: Option<std::ffi::OsString>,
    home: Option<&std::path::Path>,
) -> std::ffi::OsString {
    std::env::join_paths(search_dirs(path_env, home)).unwrap_or_default()
}

/// 进程 PATH 各目录 + 补扫目录（resolve 与 child_path 共用的搜索序）。
fn search_dirs(
    path_env: Option<std::ffi::OsString>,
    home: Option<&std::path::Path>,
) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = path_env
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend(extra_bin_dirs_in(home));
    dirs
}

/// resolve 的纯函数版（测试用）：给定 PATH 与家目录解析 bin。
fn resolve_in(
    bin: &str,
    path_env: Option<std::ffi::OsString>,
    home: Option<&std::path::Path>,
) -> String {
    if bin.is_empty() || bin.contains('/') {
        return bin.to_string(); // 空名 / 显式路径（含 LARK_CLI_BIN 类注入）不改写
    }
    for dir in search_dirs(path_env, home) {
        let f = dir.join(bin);
        if f.is_file() {
            return f.to_string_lossy().into_owned();
        }
    }
    bin.to_string()
}

/// GUI 进程常见缺失的可执行目录：Homebrew、npm 全局前缀改到用户目录、
/// nvm / volta / asdf 等版本管理器。
fn extra_bin_dirs_in(home: Option<&std::path::Path>) -> Vec<std::path::PathBuf> {
    let mut dirs = vec![
        std::path::PathBuf::from("/usr/local/bin"), // Intel Mac Homebrew / node 官方安装包
        std::path::PathBuf::from("/opt/homebrew/bin"), // Apple Silicon Homebrew
        std::path::PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ];
    let Some(home) = home else {
        return dirs;
    };
    dirs.push(home.join(".npm-global/bin"));
    dirs.push(home.join(".volta/bin"));
    dirs.push(home.join(".asdf/shims"));
    dirs.push(home.join(".local/bin"));
    dirs.push(home.join("bin"));
    // nvm 一个 node 版本一个 bin 目录，全量收进来、新版本优先
    if let Ok(vers) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        let mut nv: Vec<_> = vers
            .filter_map(Result::ok)
            .map(|e| e.path().join("bin"))
            .collect();
        nv.sort_by_key(|d| std::cmp::Reverse(node_version_key(d)));
        dirs.append(&mut nv);
    }
    dirs
}

/// nvm 版本目录名（如 v20.11.1）的排序键：按段数字比较，避免字典序把 v9 排在 v20 后
fn node_version_key(bin_dir: &std::path::Path) -> Vec<u64> {
    bin_dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .split('.')
        .map(|seg| seg.parse().unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归：GUI 进程不继承登录 shell 的 PATH，裸命令名需补扫 nvm 等目录才能找到；
    /// 且进程 PATH 命中优先于补扫目录，多版本 nvm 时新版本优先。
    #[cfg(unix)]
    #[test]
    fn resolve_covers_gui_missing_paths() {
        let home = std::env::temp_dir().join(format!("pk-res-home-{}", std::process::id()));
        let v18 = home.join(".nvm/versions/node/v18.20.0/bin");
        let v20 = home.join(".nvm/versions/node/v20.11.1/bin");
        for d in [&v18, &v20] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join("lark-cli"), "#!/bin/sh\n").unwrap();
        }
        // PATH 为空（GUI 进程）也能在 nvm 目录下找到，新版本优先
        let got = resolve_in("lark-cli", None, Some(&home));
        assert_eq!(got, v20.join("lark-cli").to_str().unwrap());

        // 显式路径与空名不改写
        assert_eq!(resolve_in("/x/lark-cli", None, Some(&home)), "/x/lark-cli");
        assert_eq!(resolve_in("", None, Some(&home)), "");

        // 进程 PATH 里的命中优先
        let on_path = std::env::temp_dir().join(format!("pk-res-path-{}", std::process::id()));
        std::fs::create_dir_all(&on_path).unwrap();
        std::fs::write(on_path.join("lark-cli"), "#!/bin/sh\n").unwrap();
        let path_env = std::env::join_paths([&on_path]).ok();
        let got = resolve_in("lark-cli", path_env, Some(&home));
        assert_eq!(got, on_path.join("lark-cli").to_str().unwrap());

        // 哪都找不到：原样返回，由调用方报安装指引
        assert_eq!(
            resolve_in("no-such-bin-xyz", None, Some(&home)),
            "no-such-bin-xyz"
        );
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&on_path).ok();
    }

    /// 子进程 PATH 同样补扫：原 PATH 在前、补扫目录在后（shebang 的 env node 靠它找解释器）
    #[cfg(unix)]
    #[test]
    fn child_path_appends_extra_dirs_after_original() {
        let home = std::path::Path::new("/fake-home");
        let got = child_path_in(Some(std::ffi::OsString::from("/usr/bin:/bin")), Some(home))
            .to_string_lossy()
            .into_owned();
        let paths: Vec<&str> = got.split(':').collect();
        assert_eq!(&paths[..2], &["/usr/bin", "/bin"], "原 PATH 保序在前");
        assert!(paths.contains(&"/usr/local/bin"), "补扫目录跟在后面: {got}");
        assert!(
            got.contains("/fake-home/.nvm") || got.contains("/fake-home/.volta/bin"),
            "家目录下的版本管理器目录也在: {got}"
        );

        // PATH 为空时仍只有补扫目录
        let only = child_path_in(None, Some(home))
            .to_string_lossy()
            .into_owned();
        assert!(
            only.starts_with("/usr/local/bin"),
            "空 PATH 退化为纯补扫: {only}"
        );
    }
}
