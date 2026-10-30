//! Windows 增量补丁：下载 `patch-latest.json` 指向的 zip，按 `patch.json` 逐文件校验后落盘。
//!
//! 发布侧（AxTools「发布 Windows 补丁」）产出的是**相对基础版本的累积差分**：
//! 补丁包平铺游戏根目录相对路径的文件，外加 `patch.json` / `Version.json`。
//! 这里只应用前端传下来的 `files[]`，包里多出来的文件一律不落盘。
//!
//! 三条硬约束（见 `Docs/PCLauncherDevelopmentGuide.md` §12.5）：
//!
//! - **先验包，再动游戏目录**：整包 sha256 不对就一个字节都不写。
//! - **逐文件 `.part` + sha256 + 原子替换**：已就位的直接跳过，所以重跑是幂等的；
//!   中途失败最多留下 `.part`，正式位置不会出现半成品。
//! - **版本标记最后写**：文件没全落位就不改 `CrossingVoid.version.json`，
//!   玩家的界面不会被标成新版本。
//!
//! 取消沿用 `download_task` 的任务作用域：入口把本线程标成"在为这个安装目录干活"，
//! 前端暂停后这里在下一个检查点退出。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::game_package::{safe_relative_path, write_state, GamePackageFile};

/// 补丁包里的一个目标文件。字段与 `patch.json` 的 `files[]` 同名。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePatchFile {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePatchSummary {
    pub applied_files: u64,
    pub applied_bytes: u64,
    /// 已经在位、这次跳过的文件（重跑/断点续跑时会很大）。
    pub skipped_files: u64,
    pub total_files: u64,
    pub total_bytes: u64,
    pub version: String,
    pub package_path: String,
}

/// 补丁包放在游戏目录下的 `_download/patch/`：和普通下载同一块地盘，
/// 清理下载残留时可以一起处理，也不会被当成游戏文件。
const PATCH_DOWNLOAD_DIR: &str = "_download/patch";

const READ_BUFFER_BYTES: usize = 256 * 1024;

fn patch_archive_path(install_dir: &Path, version: &str) -> PathBuf {
    let safe_version: String = version
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let name = if safe_version.is_empty() {
        "patch".to_string()
    } else {
        safe_version
    };
    install_dir
        .join(PATCH_DOWNLOAD_DIR)
        .join(format!("{name}.zip"))
}

fn part_path(target: &Path) -> PathBuf {
    let mut value = target.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

/// 把 zip 条目名归一成清单里的相对路径（只去 `./`、统一 `/`、不剥目录层）。
fn normalize_entry_name(raw: &str) -> Option<String> {
    let mut name = raw.trim().replace('\\', "/");
    while let Some(rest) = name.strip_prefix("./") {
        name = rest.to_string();
    }
    if name.is_empty() {
        return None;
    }
    safe_relative_path(&name).ok()?;
    Some(name.to_lowercase())
}

fn target_matches(target: &Path, patch_file: &GamePatchFile) -> bool {
    let Ok(metadata) = fs::metadata(target) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != patch_file.size_bytes {
        return false;
    }
    crate::calculate_file_sha256(target)
        .map(|actual| actual.eq_ignore_ascii_case(patch_file.sha256.trim()))
        .unwrap_or(false)
}

fn download_patch_once(
    app: &AppHandle,
    url: &str,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let mut resume_from = crate::existing_download_size(archive_path, expected_size)?;
    if expected_size > 0 && resume_from == expected_size {
        // 进度条前 90% 给下载、后 10% 给落地；续传时直接说"下载完了"。
        crate::emit_install_progress(app, "patchDownloading", 90.0);
        return Ok(());
    }

    let agent = crate::build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
    let mut request = crate::configure_download_request(agent.get(url), url);
    let range_header;
    if resume_from > 0 {
        range_header = format!("bytes={}-", resume_from);
        request = request.set("Range", &range_header);
    }
    let response = match request.call() {
        Ok(response) => response,
        Err(error) if resume_from > 0 && crate::is_range_not_satisfiable(&error) => {
            // 服务端说"这个范围没了"：本地那份不能用，清掉从 0 再来。
            crate::remove_file_if_exists(archive_path)?;
            return download_patch_once(app, url, archive_path, expected_size);
        }
        Err(error) => return Err(format!("无法下载补丁包：{}", error)),
    };
    if resume_from > 0 && response.status() != 206 {
        // 服务端没按 Range 回：只能重写整份。
        resume_from = 0;
    }

    let total_bytes = expected_size;
    let mut reader = response.into_reader();
    let mut writer = crate::open_download_writer(archive_path, resume_from)
        .map_err(|error| format!("无法写入补丁包 {}：{}", archive_path.display(), error))?;
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    let mut downloaded = resume_from;
    let mut throttle = crate::DownloadThrottle::new(resume_from);
    let percent = if total_bytes > 0 {
        (downloaded as f64 / total_bytes as f64) * 90.0
    } else {
        0.0
    };
    crate::emit_install_progress(app, "patchDownloading", percent);

    loop {
        crate::check_download_cancelled()?;
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取补丁包失败：{}", error))?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            format!(
                "写入补丁包 {} 失败：{}",
                archive_path.display(),
                error
            )
        })?;
        downloaded += read as u64;
        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 90.0
        } else {
            0.0
        };
        crate::emit_install_progress(app, "patchDownloading", percent);
        throttle.wait_if_needed(downloaded)?;
    }
    writer.flush().map_err(|error| {
        format!(
            "写入补丁包 {} 失败：{}",
            archive_path.display(),
            error
        )
    })?;
    Ok(())
}

/// 下载并校验整包。已存在且大小、sha256 都对的文件直接复用（断点/重跑）。
fn download_patch_package(
    app: &AppHandle,
    install_path: &str,
    url: &str,
    expected_size: u64,
    expected_sha256: &str,
    version: &str,
) -> Result<PathBuf, String> {
    let install_dir = PathBuf::from(install_path);
    let archive_path = patch_archive_path(&install_dir, version);
    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("无法创建补丁目录 {}：{}", parent.display(), error)
        })?;
    }

    if archive_path.is_file() {
        let size_ok = fs::metadata(&archive_path)
            .map(|metadata| expected_size == 0 || metadata.len() == expected_size)
            .unwrap_or(false);
        if size_ok {
            if let Ok(actual) = crate::calculate_file_sha256(&archive_path) {
                if actual.eq_ignore_ascii_case(expected_sha256.trim()) {
                    crate::emit_install_progress(app, "patchDownloading", 90.0);
                    return Ok(archive_path);
                }
            }
        }
        // 大小或哈希不对的残留不能继续参与续传。
        crate::remove_file_if_exists(&archive_path)?;
    }

    crate::retry_download("patch", || {
        download_patch_once(app, url, &archive_path, expected_size)?;
        let actual_size = fs::metadata(&archive_path)
            .map_err(|error| format!("无法读取补丁包 {}：{}", archive_path.display(), error))?
            .len();
        if expected_size > 0 && actual_size != expected_size {
            return Err(format!(
                "补丁包大小不符：{} 字节 / 期望 {} 字节",
                actual_size, expected_size
            ));
        }
        let actual_hash = crate::calculate_file_sha256(&archive_path)?;
        if !actual_hash.eq_ignore_ascii_case(expected_sha256.trim()) {
            // 坏包留着只会让下一次续传出错，直接删掉重来。
            let _ = fs::remove_file(&archive_path);
            return Err("补丁包 sha256 校验失败，已删除，准备重新下载。".to_string());
        }
        Ok(())
    })?;

    Ok(archive_path)
}

/// 版本标记是启动器判断"本地是什么版本"的唯一依据；只改 `version`，其余字段原样保留。
fn write_version_marker(install_dir: &Path, marker: &str, version: &str) -> Result<(), String> {
    let marker = marker.trim();
    if marker.is_empty() || marker.contains(['/', '\\']) || marker.contains("..") {
        return Err(format!("版本标记文件名不安全：{marker}"));
    }
    let path = install_dir.join(marker);
    let mut value = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    value["version"] = serde_json::json!(version);
    if value.get("platform").is_none() {
        value["platform"] = serde_json::json!("Windows");
    }
    if value.get("channel").is_none() {
        value["channel"] = serde_json::json!("stable");
    }
    let bytes = serde_json::to_vec(&value)
        .map_err(|error| format!("无法序列化版本标记：{}", error))?;
    let temporary = part_path(&path);
    fs::write(&temporary, &bytes).map_err(|error| {
        format!("无法写入版本标记 {}：{}", temporary.display(), error)
    })?;
    crate::replace_file_atomic(&temporary, &path)
}

/// 把补丁包里的文件逐个落到游戏目录。`on_progress(已完成文件, 总文件)` 每处理完一个报一次。
fn apply_patch_package<F>(
    install_dir: &Path,
    package_path: &Path,
    files: &[GamePatchFile],
    version: &str,
    version_marker: &str,
    state: Option<(&str, &[GamePackageFile])>,
    mut on_progress: F,
) -> Result<GamePatchSummary, String>
where
    F: FnMut(u64, u64),
{
    if files.is_empty() {
        return Err("补丁清单是空的，没有可应用的文件。".to_string());
    }
    if !install_dir.is_dir() {
        return Err(format!("游戏目录不存在：{}", install_dir.display()));
    }
    // 清单路径先全验一遍：一条非法就整单拒绝，别打了一半才发现。
    for patch_file in files {
        safe_relative_path(&patch_file.path)?;
    }

    let file = File::open(package_path).map_err(|error| {
        format!("打不开补丁包 {}：{}", package_path.display(), error)
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| {
        format!("补丁包不是有效的 zip（{}）：{}", package_path.display(), error)
    })?;

    // 条目名归一后建索引：Bandizip 可能加 `./` 或反斜杠，包内多了 `patch.json` 也无所谓。
    let mut entries: HashMap<String, String> = HashMap::new();
    for index in 0..archive.len() {
        let entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let raw_name = entry.name().to_string();
        if let Some(normalized) = normalize_entry_name(&raw_name) {
            entries.entry(normalized).or_insert(raw_name);
        }
    }

    let total_files = files.len() as u64;
    let total_bytes = files
        .iter()
        .map(|file| file.size_bytes)
        .fold(0u64, u64::saturating_add);
    let mut applied_files = 0u64;
    let mut applied_bytes = 0u64;
    let mut skipped_files = 0u64;

    for (index, patch_file) in files.iter().enumerate() {
        crate::check_download_cancelled()?;
        let relative = safe_relative_path(&patch_file.path)?;
        let target = install_dir.join(&relative);

        if target_matches(&target, patch_file) {
            skipped_files += 1;
            on_progress(index as u64 + 1, total_files);
            continue;
        }

        let key = patch_file
            .path
            .trim()
            .replace('\\', "/")
            .trim_start_matches("./")
            .to_lowercase();
        let Some(raw_name) = entries.get(&key) else {
            return Err(format!("补丁包里缺少文件：{}", patch_file.path));
        };

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("无法创建目录 {}：{}", parent.display(), error)
            })?;
        }
        let temporary = part_path(&target);
        crate::remove_file_if_exists(&temporary)?;

        {
            let mut entry = archive.by_name(raw_name).map_err(|error| {
                format!("补丁包里读不到 {}：{}", patch_file.path, error)
            })?;
            let mut writer = File::create(&temporary).map_err(|error| {
                format!("无法写入 {}：{}", temporary.display(), error)
            })?;
            let mut buffer = vec![0u8; READ_BUFFER_BYTES];
            loop {
                crate::check_download_cancelled()?;
                let read = entry
                    .read(&mut buffer)
                    .map_err(|error| format!("读取补丁条目失败：{}", error))?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read]).map_err(|error| {
                    format!("写入 {} 失败：{}", temporary.display(), error)
                })?;
            }
            writer.flush().map_err(|error| {
                format!("写入 {} 失败：{}", temporary.display(), error)
            })?;
        }

        let written = fs::metadata(&temporary)
            .map(|metadata| metadata.len())
            .map_err(|error| format!("无法读取 {}：{}", temporary.display(), error))?;
        if written != patch_file.size_bytes {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "补丁文件大小不符：{}（{} / 期望 {} 字节）",
                patch_file.path, written, patch_file.size_bytes
            ));
        }
        let actual_hash = crate::calculate_file_sha256(&temporary)?;
        if !actual_hash.eq_ignore_ascii_case(patch_file.sha256.trim()) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("补丁文件校验失败：{}", patch_file.path));
        }

        crate::replace_file_atomic(&temporary, &target)?;
        applied_files += 1;
        applied_bytes = applied_bytes.saturating_add(written);
        on_progress(index as u64 + 1, total_files);
    }

    // 先写本地状态（合并后的文件哈希），再写版本标记：
    // 顺序反过来的话，标记已经是新版本、状态还是旧哈希，下一次核对会把新文件判成损坏。
    if let Some((product_key, state_files)) = state {
        if !state_files.is_empty() {
            write_state(install_dir, product_key, version, state_files)
                .map_err(|error| format!("补丁已落盘，但写入本地状态失败：{}", error))?;
        }
    }
    write_version_marker(install_dir, version_marker, version)?;

    Ok(GamePatchSummary {
        applied_files,
        applied_bytes,
        skipped_files,
        total_files,
        total_bytes,
        version: version.to_string(),
        package_path: package_path.to_string_lossy().to_string(),
    })
}

/// 下载并应用一个 Windows 增量补丁。
///
/// 前端已经完成"这个补丁适不适用"的判断；这里只负责字节：
/// 整包校验 → 逐文件校验落盘 → 写版本标记。
#[tauri::command]
pub async fn install_game_patch(
    app: AppHandle,
    install_path: String,
    version: String,
    version_marker: String,
    package_url: String,
    package_size_bytes: u64,
    package_sha256: String,
    files: Vec<GamePatchFile>,
    product_key: Option<String>,
    state_files: Option<Vec<GamePackageFile>>,
) -> Result<GamePatchSummary, String> {
    if files.is_empty() {
        return Err("补丁清单是空的，没有可应用的文件。".to_string());
    }
    if !install_path.trim().is_empty() {
        // 同一个安装目录只允许一个任务；入口把上一轮暂停留下的取消标志清掉。
        crate::download_task::begin(&install_path);
    }
    let package_url = package_url.trim().to_string();
    if !(package_url.starts_with("http://") || package_url.starts_with("https://")) {
        return Err("补丁包地址不是 http(s)。".to_string());
    }
    if package_sha256.trim().len() != 64 {
        return Err("补丁包 sha256 不合格。".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // spawn_blocking 是另一条线程：任务作用域必须在这里重新进入，
        // 否则取消检查会落到全局标志上（暂停按钮就对这个任务无效）。
        crate::download_task::begin(&install_path);
        let install_dir = PathBuf::from(&install_path);
        let package_path = download_patch_package(
            &app,
            &install_path,
            &package_url,
            package_size_bytes,
            package_sha256.trim(),
            &version,
        )?;

        // 合并后的状态清单由前端算好传进来（它才知道基础清单长什么样）；
        // 写盘放在 Rust 里，和版本标记紧挨着，缩小"文件已新、状态还旧"的窗口。
        let state_pair = match (product_key, state_files) {
            (Some(key), Some(files)) if !key.trim().is_empty() && !files.is_empty() => {
                Some((key, files))
            }
            _ => None,
        };
        let state = state_pair
            .as_ref()
            .map(|(key, files)| (key.as_str(), files.as_slice()));

        let progress_app = app.clone();
        apply_patch_package(
            &install_dir,
            &package_path,
            &files,
            &version,
            &version_marker,
            state,
            move |done, total| {
                // 下载占前 90%，逐文件落地占最后 10%。
                let percent = if total > 0 {
                    90.0 + (done as f64 / total as f64) * 10.0
                } else {
                    90.0
                };
                crate::emit_install_progress_with_items(
                    &progress_app,
                    "patchApplying",
                    percent,
                    done,
                    total,
                );
            },
        )
    })
    .await
    .map_err(|error| format!("Patch task failed: {}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use zip::write::SimpleFileOptions;

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn temp_dir(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "cv-patch-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        for (name, bytes) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start zip entry");
            writer.write_all(bytes).expect("write zip entry");
        }
        writer.finish().expect("finish zip");
    }

    fn file_entry(path: &str, bytes: &[u8]) -> GamePatchFile {
        GamePatchFile {
            path: path.to_string(),
            size_bytes: bytes.len() as u64,
            sha256: sha256_hex(bytes),
        }
    }

    #[test]
    fn applies_files_and_writes_version_marker_last() {
        let root = temp_dir("apply");
        let install = root.join("game");
        fs::create_dir_all(install.join("CrossingVoid/Content/Paks")).expect("create install");
        fs::write(
            install.join("CrossingVoid.version.json"),
            r#"{"version":"0.6.0","platform":"Windows","channel":"stable","title":"旧版本"}"#,
        )
        .expect("write marker");
        fs::write(install.join("CrossingVoid.exe"), b"old exe").expect("write old exe");

        let package = root.join("patch.zip");
        write_zip(
            &package,
            &[
                ("CrossingVoid.exe", b"new exe"),
                ("CrossingVoid/Content/Paks/pakchunk0-Windows_0_P.ucas", b"new pak"),
                ("patch.json", b"{}"),
                ("Version.json", b"{}"),
            ],
        );

        let files = vec![
            file_entry("CrossingVoid.exe", b"new exe"),
            file_entry("CrossingVoid/Content/Paks/pakchunk0-Windows_0_P.ucas", b"new pak"),
        ];
        let mut progress = Vec::new();
        let summary = apply_patch_package(
            &install,
            &package,
            &files,
            "0.6.2",
            "CrossingVoid.version.json",
            None,
            |done, total| progress.push((done, total)),
        )
        .expect("apply patch");

        assert_eq!(summary.applied_files, 2);
        assert_eq!(summary.skipped_files, 0);
        assert_eq!(progress, vec![(1, 2), (2, 2)]);
        assert_eq!(fs::read(install.join("CrossingVoid.exe")).unwrap(), b"new exe");
        assert_eq!(
            fs::read(install.join("CrossingVoid/Content/Paks/pakchunk0-Windows_0_P.ucas")).unwrap(),
            b"new pak"
        );
        // 包里多出来的 patch.json / Version.json 不能落进游戏目录
        assert!(!install.join("patch.json").exists());
        assert!(!install.join("Version.json").exists());

        let marker: serde_json::Value = serde_json::from_slice(
            &fs::read(install.join("CrossingVoid.version.json")).unwrap(),
        )
        .expect("parse marker");
        assert_eq!(marker["version"], "0.6.2");
        assert_eq!(marker["platform"], "Windows");
        assert_eq!(marker["title"], "旧版本", "其他字段要原样保留");
        assert!(!install.join("CrossingVoid.version.json.part").exists());
    }

    #[test]
    fn writes_the_merged_state_before_the_version_marker() {
        let root = temp_dir("state");
        let install = root.join("game");
        fs::create_dir_all(&install).expect("create install");
        let package = root.join("patch.zip");
        write_zip(&package, &[("a.txt", b"hello")]);
        let files = vec![file_entry("a.txt", b"hello")];
        let state_files = vec![GamePackageFile {
            path: "a.txt".to_string(),
            size_bytes: 5,
            sha256: sha256_hex(b"hello"),
            urls: Vec::new(),
        }];

        apply_patch_package(
            &install,
            &package,
            &files,
            "0.6.2",
            "CrossingVoid.version.json",
            Some(("crossingvoid-game", &state_files)),
            |_, _| {},
        )
        .expect("apply patch");

        let state = crate::game_package::read_state(&install)
            .expect("read state")
            .expect("state file must exist");
        assert_eq!(state.version, "0.6.2");
        assert_eq!(state.product_key, "crossingvoid-game");
        assert_eq!(state.files.len(), 1);

        let marker: serde_json::Value = serde_json::from_slice(
            &fs::read(install.join("CrossingVoid.version.json")).unwrap(),
        )
        .expect("parse marker");
        assert_eq!(marker["version"], "0.6.2");
    }

    #[test]
    fn applying_twice_skips_everything_that_is_already_in_place() {
        let root = temp_dir("idempotent");
        let install = root.join("game");
        fs::create_dir_all(&install).expect("create install");
        let package = root.join("patch.zip");
        write_zip(&package, &[("a.txt", b"hello")]);
        let files = vec![file_entry("a.txt", b"hello")];

        let first = apply_patch_package(&install, &package, &files, "0.6.2", "CrossingVoid.version.json", None, |_, _| {})
            .expect("first apply");
        assert_eq!(first.applied_files, 1);
        assert_eq!(first.skipped_files, 0);

        let second = apply_patch_package(&install, &package, &files, "0.6.2", "CrossingVoid.version.json", None, |_, _| {})
            .expect("second apply");
        assert_eq!(second.applied_files, 0);
        assert_eq!(second.skipped_files, 1);
    }

    #[test]
    fn a_hash_mismatch_leaves_no_file_at_the_target() {
        let root = temp_dir("mismatch");
        let install = root.join("game");
        fs::create_dir_all(&install).expect("create install");
        let package = root.join("patch.zip");
        write_zip(&package, &[("broken.bin", b"actual")]);
        let files = vec![GamePatchFile {
            path: "broken.bin".to_string(),
            size_bytes: 6,
            sha256: "0".repeat(64),
        }];

        let error = apply_patch_package(
            &install,
            &package,
            &files,
            "0.6.2",
            "CrossingVoid.version.json",
            None,
            |_, _| {},
        )
        .expect_err("hash mismatch must fail");
        assert!(error.contains("校验失败"), "{error}");
        assert!(!install.join("broken.bin").exists());
        assert!(!install.join("broken.bin.part").exists());
        // 失败时版本标记也不能被改写
        assert!(!install.join("CrossingVoid.version.json").exists());
    }

    #[test]
    fn a_missing_entry_or_unsafe_path_is_rejected_before_writing_anything() {
        let root = temp_dir("missing");
        let install = root.join("game");
        fs::create_dir_all(&install).expect("create install");
        let package = root.join("patch.zip");
        write_zip(&package, &[("a.txt", b"hello")]);

        let missing = vec![file_entry("b.txt", b"hello")];
        let error = apply_patch_package(&install, &package, &missing, "0.6.2", "CrossingVoid.version.json", None, |_, _| {})
            .expect_err("missing entry must fail");
        assert!(error.contains("补丁包里缺少文件"), "{error}");

        let unsafe_path = vec![GamePatchFile {
            path: "../escape.txt".to_string(),
            size_bytes: 1,
            sha256: "0".repeat(64),
        }];
        assert!(
            apply_patch_package(&install, &package, &unsafe_path, "0.6.2", "CrossingVoid.version.json", None, |_, _| {})
                .is_err()
        );
    }

    #[test]
    fn the_download_path_is_a_safe_name_under_download_patch() {
        let install = PathBuf::from("D:\\game");
        let path = patch_archive_path(&install, "0.6.2");
        assert!(path.ends_with("_download\\patch\\0.6.2.zip") || path.ends_with("_download/patch/0.6.2.zip"));
        let weird = patch_archive_path(&install, "../../evil");
        // 目录分隔符会被替换掉，文件名里不可能再跑出 `_download/patch`。
        let name = weird
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        assert!(!name.contains('/') && !name.contains('\\'), "{name}");
        assert!(weird
            .parent()
            .map(|value| value.ends_with("patch"))
            .unwrap_or(false));
    }

    /// 真实补丁包联调：设置 `CV_PATCH_ZIP` / `CV_PATCH_JSON` 后手工运行
    /// `cargo test live_patch_package -- --ignored`。
    #[test]
    #[ignore = "需要联网/真实补丁包：设置 CV_PATCH_ZIP 与 CV_PATCH_JSON 后手工运行"]
    fn live_patch_package_matches_the_published_manifest() {
        #[derive(Deserialize)]
        struct PatchManifest {
            files: Vec<GamePatchFile>,
        }

        let zip_path = std::env::var("CV_PATCH_ZIP").expect("CV_PATCH_ZIP");
        let json_path = std::env::var("CV_PATCH_JSON").expect("CV_PATCH_JSON");
        let text = fs::read_to_string(&json_path).expect("read patch.json");
        let manifest: PatchManifest = serde_json::from_str(&text).expect("parse patch.json");
        assert_eq!(manifest.files.len(), 127);

        let root = temp_dir("live");
        let install = root.join("game");
        fs::create_dir_all(&install).expect("create install");
        fs::write(
            install.join("CrossingVoid.version.json"),
            r#"{"version":"0.6.0","platform":"Windows","channel":"stable"}"#,
        )
        .expect("write marker");

        let summary = apply_patch_package(
            &install,
            Path::new(&zip_path),
            &manifest.files,
            "0.6.2",
            "CrossingVoid.version.json",
            None,
            |_, _| {},
        )
        .expect("apply the published patch package");
        assert_eq!(summary.applied_files, 127);
        assert_eq!(summary.total_bytes, 173_802_024);

        let marker: serde_json::Value = serde_json::from_slice(
            &fs::read(install.join("CrossingVoid.version.json")).expect("read marker"),
        )
        .expect("parse marker");
        assert_eq!(marker["version"], "0.6.2");
        // 补丁包自带的 patch.json / Version.json 不能进游戏目录
        assert!(!install.join("patch.json").exists());
        assert!(!install.join("Version.json").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
