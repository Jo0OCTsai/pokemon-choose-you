//! 桌宠语音（PET_EXPERIENCE_PROPOSAL F5）：系统本地 TTS，零新依赖走平台 CLI。
//! 只在里程碑/收工/精灵生日/对话回答四类时刻被调用，每次 ≤1 句；失败静默（语音是锦上添花）。
//! EdgeTTS 云引擎为方案中的可选档，未在 v1 实现（云服务需显式选择并提示，见方案 F5）。

/// 异步播报一句：长台词截断后派独立进程，不阻塞命令返回。
pub fn speak_detached(text: &str) {
    // 台词里可能带 emoji/状态符号（🐾 ✔ …），系统 TTS 念不出来还占时长——先剥掉
    let cleaned: String = text
        .chars()
        .filter(|c| !is_symbol_ish(*c))
        .take(120)
        .collect();
    if cleaned.trim().is_empty() {
        return;
    }
    std::thread::spawn(move || {
        if let Err(e) = speak_once(&cleaned) {
            log::debug!("[voice] 系统语音不可用: {e}");
        }
    });
}

/// emoji / 符号 / 控制字符（保留中日英与常用标点；↑↓ 是时刻用语，保留）
fn is_symbol_ish(c: char) -> bool {
    let cp = c as u32;
    c.is_control()
        || (0x1F000..=0x1FAFF).contains(&cp) // emoji 各区段
        || (0x2600..=0x27BF).contains(&cp) // 杂项符号 + 装饰符号
        || ((0x2190..=0x21FF).contains(&cp) && cp != 0x2191 && cp != 0x2193) // 箭头
}

#[cfg(target_os = "macos")]
fn speak_once(text: &str) -> std::io::Result<()> {
    std::process::Command::new("say")
        .arg(text)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(windows)]
fn speak_once(text: &str) -> std::io::Result<()> {
    // Windows PowerShell（5.1 桌面自带）System.Speech；单引号转义防注入
    let escaped = text.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Speech; \
         (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{escaped}')"
    );
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn speak_once(text: &str) -> std::io::Result<()> {
    // speech-dispatcher 优先（桌面发行版常见），回落 espeak
    let first = std::process::Command::new("spd-say")
        .arg(text)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    match first {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => std::process::Command::new("espeak")
            .arg(text)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbol_filter_keeps_text_drops_emoji() {
        let cleaned: String = "🐾 捕捉成功！记入图鉴 ✔"
            .chars()
            .filter(|c| !is_symbol_ish(*c))
            .collect();
        assert_eq!(cleaned.trim(), "捕捉成功！记入图鉴");
    }
}
