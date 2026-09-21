//! v1 文件级游戏包：本地扫描、并发下载、白名单清理、状态文件读写。
//!
//! 契约见 `Docs/GameDownloadRetrofitPlan.md` 与 `D:\2026-09-20-game-upload-launcher-contract.md`。
//!
//! 这一层只做"字节层面"的事：路径安全、Range 续传、`.part` → 原子改名、sha256 校验、白名单删除。
//! "这次要下哪几个文件"由前端统一内核（`src/gamePackage.ts`）算好再传进来，两端同一份逻辑。

use std::collections::VecDeque;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    build_http_agent, calculate_file_sha256, check_download_cancelled, configure_download_request,
    emit_game_package_progress, existing_download_size, open_download_writer,
    remove_file_if_exists, replace_file_atomic, sleep_with_cancel, DownloadThrottle,
    DOWNLOAD_CANCELLED_ERROR, DOWNLOAD_RETRY_ATTEMPTS,
};

const DEFAULT_CONCURRENCY: usize = 4;
const MAX_CONCURRENCY: usize = 6;
const STATE_FILE_NAME: &str = "CrossingVoid.manifest.json";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(150);
const READ_BUFFER_BYTES: usize = 1024 * 256;

/// 清理时永不触碰的顶层目录：玩家存档、配置、日志。
const PROTECTED_TOP_LEVEL: [&str; 1] = ["saved"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePackageFile {
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub sha256: String,
    /// 候选下载地址：首选源排第一，另一个源兜底。
    /// 只用于下载入参，不写进本地状态（状态里只记 path/size/sha256）。
    #[serde(default, skip_serializing)]
    pub urls: Vec<String>,
}

/// 本地状态文件：与清单的 `files[]` 同形，多了 productKey / version 便于诊断。
/// 老的 `{"files":[…]}` 形状也能读（其余字段走默认值）。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePackageState {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub product_key: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub files: Vec<GamePackageFile>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePackageDownloadSummary {
    pub files: u64,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePackagePruneFailure {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePackagePruneSummary {
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<GamePackagePruneFailure>,
}

// ---------------------------------------------------------------------------
// 路径与 URL
// ---------------------------------------------------------------------------

/// 清单里的路径必须是安全的相对路径：无盘符、无开头斜杠、无 `..`、无非法字符。
pub fn safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("清单里的文件路径为空。".to_string());
    }
    if normalized.starts_with('/') {
        return Err(format!("清单里的文件路径不能是绝对路径：{raw}"));
    }
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        return Err(format!("清单里的文件路径不能带盘符：{raw}"));
    }

    let mut segments: Vec<&str> = Vec::new();
    for segment in normalized.split('/') {
        match segment {
            "" | "." => continue,
            ".." => return Err(format!("清单里的文件路径不能包含 ..：{raw}")),
            value => {
                if value.contains(['<', '>', ':', '"', '|', '?', '*']) {
                    return Err(format!("清单里的文件路径含非法字符：{raw}"));
                }
                segments.push(value);
            }
        }
    }
    if segments.is_empty() {
        return Err(format!("清单里的文件路径为空：{raw}"));
    }
    Ok(segments.iter().collect::<PathBuf>())
}

fn join_download_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn part_path(target: &Path) -> PathBuf {
    let mut value = target.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

fn is_protected_path(relative: &Path) -> bool {
    let Some(first) = relative.components().next() else {
        return true;
    };
    let name = first.as_os_str().to_string_lossy().to_ascii_lowercase();
    if PROTECTED_TOP_LEVEL.iter().any(|item| name == *item) {
        return true;
    }
    name == STATE_FILE_NAME.to_ascii_lowercase()
}

// ---------------------------------------------------------------------------
// 本地扫描与状态文件
// ---------------------------------------------------------------------------

fn file_matches_entry(path: &Path, entry: &GamePackageFile) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    if entry.size_bytes > 0 && metadata.len() != entry.size_bytes {
        return false;
    }
    let expected = entry.sha256.trim();
    if expected.is_empty() {
        return true;
    }
    calculate_file_sha256(path)
        .map(|hash| hash.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

/// 逐条哈希本地已存在的文件；磁盘上没有的直接不出现在结果里。
///
/// 只在"没有状态文件"（老安装升级上来）时用一次，用来 bootstrap 出本地状态。
pub fn scan_local_files(
    install_dir: &Path,
    files: &[GamePackageFile],
) -> Result<Vec<GamePackageFile>, String> {
    let mut found = Vec::new();
    for entry in files {
        let relative = match safe_relative_path(&entry.path) {
            Ok(relative) => relative,
            Err(_) => continue,
        };
        let target = install_dir.join(&relative);
        let Ok(metadata) = fs::metadata(&target) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(sha256) = calculate_file_sha256(&target) else {
            continue;
        };
        found.push(GamePackageFile {
            path: entry.path.clone(),
            size_bytes: metadata.len(),
            sha256,
            urls: Vec::new(),
        });
    }
    Ok(found)
}

fn state_path(install_dir: &Path) -> PathBuf {
    install_dir.join(STATE_FILE_NAME)
}

/// 读本地状态文件；不存在返回 `None`。
pub fn read_state(install_dir: &Path) -> Result<Option<GamePackageState>, String> {
    let path = state_path(install_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read {}: {}", path.display(), error))?;
    let state = serde_json::from_str::<GamePackageState>(&text)
        .map_err(|error| format!("Unable to parse {}: {}", path.display(), error))?;
    Ok(Some(state))
}

/// 写本地状态文件（同目录临时文件 + 原子替换）。
pub fn write_state(
    install_dir: &Path,
    product_key: &str,
    version: &str,
    files: &[GamePackageFile],
) -> Result<(), String> {
    fs::create_dir_all(install_dir).map_err(|error| {
        format!(
            "Unable to create install directory {}: {}",
            install_dir.display(),
            error
        )
    })?;
    let state = GamePackageState {
        schema_version: 1,
        product_key: product_key.to_string(),
        version: version.to_string(),
        files: files.to_vec(),
    };
    let text = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Unable to serialize game package state: {}", error))?;
    let target = state_path(install_dir);
    let temporary = install_dir.join(format!("{STATE_FILE_NAME}.tmp"));
    fs::write(&temporary, format!("{text}\n"))
        .map_err(|error| format!("Unable to write {}: {}", temporary.display(), error))?;
    replace_file_atomic(&temporary, &target)
}

// ---------------------------------------------------------------------------
// 清理（白名单）
// ---------------------------------------------------------------------------

/// 删除"上次状态里记过、这次清单里没有"的文件。
///
/// 三重防线：路径必须安全、不能落在受保护目录（`Saved\` 与状态文件本身）、只删文件不删目录。
pub fn prune_files(install_dir: &Path, paths: &[String]) -> GamePackagePruneSummary {
    let mut summary = GamePackagePruneSummary {
        removed: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
    };

    for raw in paths {
        let relative = match safe_relative_path(raw) {
            Ok(relative) => relative,
            Err(message) => {
                summary.failed.push(GamePackagePruneFailure {
                    path: raw.clone(),
                    message,
                });
                continue;
            }
        };
        if is_protected_path(&relative) {
            summary.skipped.push(raw.clone());
            continue;
        }
        let target = install_dir.join(&relative);
        match fs::metadata(&target) {
            Ok(metadata) if metadata.is_file() => match fs::remove_file(&target) {
                Ok(()) => summary.removed.push(raw.clone()),
                Err(error) => summary.failed.push(GamePackagePruneFailure {
                    path: raw.clone(),
                    message: error.to_string(),
                }),
            },
            Ok(_) => summary.skipped.push(raw.clone()),
            Err(_) => summary.skipped.push(raw.clone()),
        }
    }

    summary
}

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

/// 进度回调：(已完成字节, 总字节, 已完成文件数, 总文件数)
type ProgressSink = dyn Fn(u64, u64, u64, u64) + Send + Sync;

fn emit_progress_throttled(
    on_progress: &ProgressSink,
    last_emit: &Mutex<Instant>,
    done_bytes: u64,
    total_bytes: u64,
    done_files: u64,
    total_files: u64,
    force: bool,
) {
    let mut guard = match last_emit.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !force && guard.elapsed() < PROGRESS_EMIT_INTERVAL {
        return;
    }
    *guard = Instant::now();
    on_progress(done_bytes, total_bytes, done_files, total_files);
}

fn run_parallel<T, F>(items: Vec<T>, concurrency: usize, worker: F) -> Result<(), String>
where
    T: Send + 'static,
    F: Fn(T) -> Result<(), String> + Send + Sync + 'static,
{
    let queue = Arc::new(Mutex::new(VecDeque::from(items)));
    let first_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let stop = Arc::new(AtomicBool::new(false));
    let worker = Arc::new(worker);

    let mut handles = Vec::new();
    for _ in 0..concurrency.max(1) {
        let queue = Arc::clone(&queue);
        let first_error = Arc::clone(&first_error);
        let stop = Arc::clone(&stop);
        let worker = Arc::clone(&worker);
        handles.push(std::thread::spawn(move || loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let item = {
                let mut guard = match queue.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                guard.pop_front()
            };
            let Some(item) = item else {
                break;
            };
            if let Err(error) = worker(item) {
                let mut guard = match first_error.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                if guard.is_none() {
                    *guard = Some(error);
                }
                stop.store(true, Ordering::SeqCst);
                break;
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    let guard = match first_error.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.clone() {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

struct DownloadFileContext {
    base_url: String,
    install_dir: PathBuf,
    total_bytes: u64,
    total_files: u64,
    done_bytes: Arc<AtomicU64>,
    done_files: Arc<AtomicU64>,
    last_emit: Arc<Mutex<Instant>>,
    on_progress: Arc<ProgressSink>,
}

fn download_one_file(context: &DownloadFileContext, entry: GamePackageFile) -> Result<(), String> {
    let relative = safe_relative_path(&entry.path)?;
    let target = context.install_dir.join(&relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {}: {}", parent.display(), error))?;
    }

    if file_matches_entry(&target, &entry) {
        context
            .done_bytes
            .fetch_add(entry.size_bytes, Ordering::SeqCst);
        let done_files = context.done_files.fetch_add(1, Ordering::SeqCst) + 1;
        emit_progress_throttled(
            context.on_progress.as_ref(),
            context.last_emit.as_ref(),
            context.done_bytes.load(Ordering::SeqCst),
            context.total_bytes,
            done_files,
            context.total_files,
            true,
        );
        return Ok(());
    }

    let part = part_path(&target);
    let candidates = file_url_candidates(context, &entry);
    if candidates.is_empty() {
        return Err(format!("{} 没有可用的下载地址。", entry.path));
    }
    let file_counted = AtomicU64::new(0);
    let mut last_error = String::new();

    // 双源混用就落在这里：先把首选源试到放弃，再换下一个源的地址。
    for (candidate_index, url) in candidates.iter().enumerate() {
        for attempt in 1..=DOWNLOAD_RETRY_ATTEMPTS {
            check_download_cancelled()?;
            // 每次重试前把这个文件上一轮计入总进度的字节退回去，避免进度越界。
            let previous = file_counted.swap(0, Ordering::SeqCst);
            if previous > 0 {
                context.done_bytes.fetch_sub(previous, Ordering::SeqCst);
            }
            match download_one_file_once(context, url, &part, &target, &entry, &file_counted) {
                Ok(()) => {
                    let done_files = context.done_files.fetch_add(1, Ordering::SeqCst) + 1;
                    emit_progress_throttled(
                        context.on_progress.as_ref(),
                        context.last_emit.as_ref(),
                        context.done_bytes.load(Ordering::SeqCst),
                        context.total_bytes,
                        done_files,
                        context.total_files,
                        true,
                    );
                    return Ok(());
                }
                Err(error) if error == DOWNLOAD_CANCELLED_ERROR => return Err(error),
                Err(error) => {
                    last_error = error;
                    // 这个地址上压根没有这个文件（比如备用源的附件名对不上），
                    // 重试没意义，直接换下一个源的地址。
                    if last_error.contains("404") {
                        break;
                    }
                    if attempt < DOWNLOAD_RETRY_ATTEMPTS {
                        sleep_with_cancel(Duration::from_millis(350 * attempt as u64))?;
                    }
                }
            }
        }
        if candidate_index + 1 < candidates.len() {
            emit_progress_throttled(
                context.on_progress.as_ref(),
                context.last_emit.as_ref(),
                context.done_bytes.load(Ordering::SeqCst),
                context.total_bytes,
                context.done_files.load(Ordering::SeqCst),
                context.total_files,
                true,
            );
        }
    }

    let leftover = file_counted.swap(0, Ordering::SeqCst);
    if leftover > 0 {
        context.done_bytes.fetch_sub(leftover, Ordering::SeqCst);
    }

    Err(format!(
        "下载 {} 失败（已重试 {DOWNLOAD_RETRY_ATTEMPTS} 次）：{last_error}",
        entry.path
    ))
}

/// 一个文件的候选地址：优先用清单给的多源地址，没给就退回 `base_url + path`。
fn file_url_candidates(context: &DownloadFileContext, entry: &GamePackageFile) -> Vec<String> {
    if entry.urls.is_empty() {
        return vec![join_download_url(&context.base_url, &entry.path)];
    }
    entry
        .urls
        .iter()
        .map(|url| url.trim())
        .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
        .map(str::to_string)
        .collect()
}

fn download_one_file_once(
    context: &DownloadFileContext,
    url: &str,
    part: &Path,
    target: &Path,
    entry: &GamePackageFile,
    file_counted: &AtomicU64,
) -> Result<(), String> {
    let expected_size = entry.size_bytes;
    let mut resume_from = existing_download_size(part, expected_size)?;

    if resume_from > 0 {
        file_counted.store(resume_from, Ordering::SeqCst);
        context
            .done_bytes
            .fetch_add(resume_from, Ordering::SeqCst);
    }

    let agent = build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
    let mut request = configure_download_request(agent.get(url), url);
    if resume_from > 0 {
        request = request.set("Range", &format!("bytes={resume_from}-"));
    }

    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Status(416, _)) if resume_from > 0 => {
            // 服务端认为没有可续传的区间：丢掉半包从头来。
            let previous = file_counted.swap(0, Ordering::SeqCst);
            if previous > 0 {
                context.done_bytes.fetch_sub(previous, Ordering::SeqCst);
            }
            remove_file_if_exists(part)?;
            resume_from = 0;
            let agent = build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
            configure_download_request(agent.get(url), url)
                .call()
                .map_err(|error| format!("Unable to download {}: {}", url, error))?
        }
        Err(error) => return Err(format!("Unable to download {}: {}", url, error)),
    };

    if resume_from > 0 && response.status() != 206 {
        // 服务端不支持 Range：从 0 重写，之前记的续传字节退回去。
        let previous = file_counted.swap(0, Ordering::SeqCst);
        if previous > 0 {
            context.done_bytes.fetch_sub(previous, Ordering::SeqCst);
        }
        resume_from = 0;
    }

    let mut reader = response.into_reader();
    let mut writer = open_download_writer(part, resume_from)
        .map_err(|error| format!("Unable to write {}: {}", part.display(), error))?;
    let mut throttle = DownloadThrottle::new(resume_from);
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    let mut downloaded = resume_from;

    loop {
        check_download_cancelled()?;
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read download stream: {}", error))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|error| format!("Unable to write {}: {}", part.display(), error))?;
        downloaded += read as u64;
        file_counted.fetch_add(read as u64, Ordering::SeqCst);
        let total = context
            .done_bytes
            .fetch_add(read as u64, Ordering::SeqCst)
            + read as u64;
        emit_progress_throttled(
            context.on_progress.as_ref(),
            context.last_emit.as_ref(),
            total,
            context.total_bytes,
            context.done_files.load(Ordering::SeqCst),
            context.total_files,
            false,
        );
        throttle.wait_if_needed(downloaded)?;
    }

    writer
        .flush()
        .map_err(|error| format!("Unable to flush {}: {}", part.display(), error))?;
    drop(writer);

    if expected_size > 0 && downloaded < expected_size {
        return Err(format!(
            "{} 下载不完整：{} / {} 字节",
            entry.path, downloaded, expected_size
        ));
    }

    let expected_hash = entry.sha256.trim();
    if !expected_hash.is_empty() {
        let actual = calculate_file_sha256(part)?;
        if !actual.eq_ignore_ascii_case(expected_hash) {
            remove_file_if_exists(part)?;
            return Err(format!(
                "{} 校验失败：sha256 与清单不一致（期望 {expected_hash}，实际 {actual}）",
                entry.path
            ));
        }
    }

    replace_file_atomic(part, target)?;

    // 收尾把进度补齐到文件真实大小，避免服务端 content-length 与清单不一致时进度停在中途。
    let counted = file_counted.load(Ordering::SeqCst);
    if expected_size > counted {
        let extra = expected_size - counted;
        file_counted.fetch_add(extra, Ordering::SeqCst);
        context.done_bytes.fetch_add(extra, Ordering::SeqCst);
    }
    emit_progress_throttled(
        context.on_progress.as_ref(),
        context.last_emit.as_ref(),
        context.done_bytes.load(Ordering::SeqCst),
        context.total_bytes,
        context.done_files.load(Ordering::SeqCst),
        context.total_files,
        true,
    );

    Ok(())
}

/// 并发下载给定文件到安装目录（`.part` → sha256 → 原子改名）。
///
/// `files` 是**已经算好差异**的待下清单：本地一致的文件不在里面。
pub fn download_files<F>(
    install_dir: &Path,
    base_url: &str,
    files: &[GamePackageFile],
    concurrency: usize,
    on_progress: F,
) -> Result<GamePackageDownloadSummary, String>
where
    F: Fn(u64, u64, u64, u64) + Send + Sync + 'static,
{
    fs::create_dir_all(install_dir).map_err(|error| {
        format!(
            "Unable to create install directory {}: {}",
            install_dir.display(),
            error
        )
    })?;

    if files.is_empty() {
        on_progress(0, 0, 0, 0);
        return Ok(GamePackageDownloadSummary { files: 0, bytes: 0 });
    }

    // 先把所有路径验一遍：一个非法路径就整单拒绝，别下了一半才发现。
    let mut validated = Vec::with_capacity(files.len());
    for entry in files {
        safe_relative_path(&entry.path)?;
        validated.push(entry.clone());
    }

    let total_bytes = validated
        .iter()
        .map(|entry| entry.size_bytes)
        .fold(0u64, u64::saturating_add);
    let file_count = validated.len() as u64;

    let done_bytes = Arc::new(AtomicU64::new(0));
    let done_files = Arc::new(AtomicU64::new(0));
    let last_emit = Arc::new(Mutex::new(Instant::now() - PROGRESS_EMIT_INTERVAL));
    let on_progress: Arc<ProgressSink> = Arc::new(on_progress);
    let concurrency = concurrency.clamp(1, MAX_CONCURRENCY);

    let context = Arc::new(DownloadFileContext {
        base_url: base_url.to_string(),
        install_dir: install_dir.to_path_buf(),
        total_bytes,
        total_files: file_count,
        done_bytes: Arc::clone(&done_bytes),
        done_files: Arc::clone(&done_files),
        last_emit: Arc::clone(&last_emit),
        on_progress: Arc::clone(&on_progress),
    });

    run_parallel(validated, concurrency, move |entry| {
        download_one_file(&context, entry)
    })?;

    Ok(GamePackageDownloadSummary {
        files: file_count,
        bytes: done_bytes.load(Ordering::SeqCst).min(total_bytes),
    })
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn scan_local_game_package(
    install_path: String,
    files: Vec<GamePackageFile>,
) -> Result<Vec<GamePackageFile>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_local_files(Path::new(&install_path), &files))
        .await
        .map_err(|error| format!("Scan task failed: {}", error))?
}

#[tauri::command]
pub async fn download_game_package(
    app: AppHandle,
    install_path: String,
    base_url: String,
    files: Vec<GamePackageFile>,
    concurrency: Option<usize>,
) -> Result<GamePackageDownloadSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress_app = app.clone();
        download_files(
            Path::new(&install_path),
            &base_url,
            &files,
            concurrency.unwrap_or(DEFAULT_CONCURRENCY),
            move |downloaded, total, done_files, total_files| {
                emit_game_package_progress(
                    &progress_app,
                    downloaded,
                    total,
                    done_files,
                    total_files,
                )
            },
        )
    })
    .await
    .map_err(|error| format!("Download task failed: {}", error))?
}

#[tauri::command]
pub async fn prune_game_package(
    install_path: String,
    paths: Vec<String>,
) -> Result<GamePackagePruneSummary, String> {
    tauri::async_runtime::spawn_blocking(move || prune_files(Path::new(&install_path), &paths))
        .await
        .map_err(|error| format!("Prune task failed: {}", error))
}

#[tauri::command]
pub async fn read_game_package_state(
    install_path: String,
) -> Result<Option<GamePackageState>, String> {
    tauri::async_runtime::spawn_blocking(move || read_state(Path::new(&install_path)))
        .await
        .map_err(|error| format!("Read state task failed: {}", error))?
}

#[tauri::command]
pub async fn write_game_package_state(
    install_path: String,
    product_key: String,
    version: String,
    files: Vec<GamePackageFile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_state(Path::new(&install_path), &product_key, &version, &files)
    })
    .await
    .map_err(|error| format!("Write state task failed: {}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;
    use std::io::{BufRead, BufReader};
    use std::net::{TcpListener, TcpStream};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeServer {
        base_url: String,
        requests: Arc<Mutex<Vec<String>>>,
    }

    impl FakeServer {
        fn range_requests_for(&self, path: &str) -> usize {
            let guard = match self.requests.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard
                .iter()
                .filter(|line| {
                    line.starts_with("RANGE ") && line.contains(&format!(" {path} "))
                })
                .count()
        }

        fn requests_for(&self, path: &str) -> usize {
            let guard = match self.requests.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard
                .iter()
                .filter(|line| line.contains(&format!(" {path}")))
                .count()
        }
    }

    /// 起一个只支持 GET + Range 的极简 HTTP 服务器，够测下载器。
    fn start_fake_server(
        bodies: StdHashMap<String, Vec<u8>>,
        corrupt_first_requests: StdHashMap<String, usize>,
    ) -> FakeServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake server");
        let address = listener.local_addr().expect("fake server address");
        let requests: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let counters: Arc<Mutex<StdHashMap<String, usize>>> =
            Arc::new(Mutex::new(StdHashMap::new()));
        let bodies = Arc::new(bodies);
        let corrupt = Arc::new(corrupt_first_requests);
        let seen = Arc::clone(&requests);

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let bodies = Arc::clone(&bodies);
                let corrupt = Arc::clone(&corrupt);
                let counters = Arc::clone(&counters);
                let seen = Arc::clone(&seen);
                std::thread::spawn(move || {
                    handle_connection(stream, bodies, corrupt, counters, seen);
                });
            }
        });

        FakeServer {
            base_url: format!("http://{address}"),
            requests,
        }
    }

    fn handle_connection(
        mut stream: TcpStream,
        bodies: Arc<StdHashMap<String, Vec<u8>>>,
        corrupt: Arc<StdHashMap<String, usize>>,
        counters: Arc<Mutex<StdHashMap<String, usize>>>,
        seen: Arc<Mutex<Vec<String>>>,
    ) {
        let mut reader = BufReader::new(match stream.try_clone() {
            Ok(clone) => clone,
            Err(_) => return,
        });
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        let mut range_header = String::new();
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    if line.to_ascii_lowercase().starts_with("range:") {
                        range_header = line.trim().to_string();
                    }
                }
                Err(_) => break,
            }
        }

        let mut parts = request_line.split_whitespace();
        let _method = parts.next().unwrap_or_default();
        let raw_path = parts.next().unwrap_or("/").to_string();
        let path = raw_path.split('?').next().unwrap_or("/").to_string();

        {
            let mut guard = match seen.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            if range_header.is_empty() {
                guard.push(format!("GET {path}"));
            } else {
                guard.push(format!("RANGE {path} {range_header}"));
            }
        }

        let Some(body) = bodies.get(&path).cloned() else {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            return;
        };

        let attempt = {
            let mut guard = match counters.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let counter = guard.entry(path.clone()).or_insert(0);
            *counter += 1;
            *counter
        };
        let corrupt_for = corrupt.get(&path).copied().unwrap_or(0);
        let payload = if attempt <= corrupt_for {
            let mut broken = body.clone();
            if let Some(first) = broken.first_mut() {
                *first = first.wrapping_add(1);
            }
            broken
        } else {
            body.clone()
        };

        let start = range_header
            .to_ascii_lowercase()
            .strip_prefix("range: bytes=")
            .and_then(|value| value.trim().trim_end_matches('-').parse::<usize>().ok())
            .filter(|value| *value < payload.len());

        let response = match start {
            Some(start) => {
                let slice = &payload[start..];
                let header = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                    slice.len(),
                    start,
                    payload.len() - 1,
                    payload.len()
                );
                let mut bytes = header.into_bytes();
                bytes.extend_from_slice(slice);
                bytes
            }
            None => {
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                    payload.len()
                );
                let mut bytes = header.into_bytes();
                bytes.extend_from_slice(&payload);
                bytes
            }
        };

        let _ = stream.write_all(&response);
        let _ = stream.flush();
    }

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "cv-game-package-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn entry(path: &str, bytes: &[u8]) -> GamePackageFile {
        GamePackageFile {
            path: path.to_string(),
            size_bytes: bytes.len() as u64,
            sha256: sha256_hex(bytes),
            urls: Vec::new(),
        }
    }

    fn fixture() -> (StdHashMap<String, Vec<u8>>, Vec<GamePackageFile>) {
        let files: Vec<(&str, Vec<u8>)> = vec![
            ("CrossingVoid.exe", vec![7u8; 4096]),
            (
                "CrossingVoid/Content/Paks/pakchunk0-Windows.ucas",
                vec![13u8; 160 * 1024],
            ),
            (
                "CrossingVoid.version.json",
                br#"{"version":"0.5.14"}"#.to_vec(),
            ),
        ];
        let mut bodies = StdHashMap::new();
        let mut entries = Vec::new();
        for (path, body) in files {
            bodies.insert(format!("/{path}"), body.clone());
            entries.push(entry(path, &body));
        }
        (bodies, entries)
    }

    #[test]
    fn falls_back_to_the_next_source_when_the_first_one_has_no_such_file() {
        let (bodies, mut entries) = fixture();
        let server = start_fake_server(bodies, StdHashMap::new());
        let install = temp_dir("fallback");

        // 首选源上这个文件不存在（404），第二个候选地址才是真的 —— 这就是双源兜底。
        let good_url;
        let expected_sha;
        let target = entries
            .iter_mut()
            .find(|entry| entry.path == "CrossingVoid.exe")
            .expect("fixture entry");
        good_url = format!("{}/{}", server.base_url, target.path);
        expected_sha = target.sha256.clone();
        target.urls = vec![
            format!("{}/{}", server.base_url, "missing/not-there.exe"),
            good_url,
        ];

        download_files(&install, &server.base_url, &entries, 4, |_, _, _, _| {})
            .expect("fallback download");

        let bytes = fs::read(install.join("CrossingVoid.exe")).expect("downloaded file");
        assert_eq!(sha256_hex(&bytes), expected_sha);
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn downloads_every_file_and_leaves_no_part_files() {
        let (bodies, entries) = fixture();
        let server = start_fake_server(bodies, StdHashMap::new());
        let install = temp_dir("fresh");

        let summary = download_files(&install, &server.base_url, &entries, 4, |_, _, _, _| {})
            .expect("download package");

        assert_eq!(summary.files, entries.len() as u64);
        for item in &entries {
            let target = install.join(item.path.replace('/', "\\"));
            let bytes = fs::read(&target).expect("downloaded file");
            assert_eq!(sha256_hex(&bytes), item.sha256, "{}", item.path);
            assert!(!part_path(&target).exists());
        }
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn resumes_from_existing_part_file_with_range_request() {
        let (bodies, entries) = fixture();
        let server = start_fake_server(bodies.clone(), StdHashMap::new());
        let install = temp_dir("resume");

        let target_path = "CrossingVoid/Content/Paks/pakchunk0-Windows.ucas";
        let target = install.join(target_path.replace('/', "\\"));
        fs::create_dir_all(target.parent().expect("target parent")).expect("create parent");
        let full = bodies
            .get(&format!("/{target_path}"))
            .cloned()
            .expect("fixture body");
        fs::write(part_path(&target), &full[..4096]).expect("write partial file");

        download_files(&install, &server.base_url, &entries, 4, |_, _, _, _| {}).expect("resume download");

        let bytes = fs::read(&target).expect("downloaded file");
        assert_eq!(sha256_hex(&bytes), sha256_hex(&full));
        assert!(
            server.range_requests_for(&format!("/{target_path}")) >= 1,
            "expected a range request for the partial file"
        );
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn retries_after_hash_mismatch_and_fails_loudly_when_it_never_matches() {
        let (bodies, entries) = fixture();
        let target_path = "CrossingVoid.exe";

        let mut corrupt = StdHashMap::new();
        corrupt.insert(format!("/{target_path}"), 1usize);
        let server = start_fake_server(bodies.clone(), corrupt);
        let install = temp_dir("retry");
        download_files(&install, &server.base_url, &entries, 4, |_, _, _, _| {})
            .expect("second attempt should succeed");
        assert!(server.requests_for(&format!("/{target_path}")) >= 2);
        fs::remove_dir_all(&install).expect("remove temp dir");

        let mut always_corrupt = StdHashMap::new();
        always_corrupt.insert(format!("/{target_path}"), usize::MAX);
        let server = start_fake_server(bodies, always_corrupt);
        let install = temp_dir("retry-fail");
        let error = download_files(&install, &server.base_url, &entries, 4, |_, _, _, _| {})
            .expect_err("permanently corrupt file must fail");
        assert!(
            error.contains(target_path),
            "error should name the file: {error}"
        );
        assert!(!install.join(target_path).exists());
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn rejects_unsafe_paths_before_downloading_anything() {
        let (bodies, _) = fixture();
        let server = start_fake_server(bodies, StdHashMap::new());
        let install = temp_dir("unsafe");
        let hostile = vec![GamePackageFile {
            path: "../escape.txt".to_string(),
            size_bytes: 3,
            sha256: sha256_hex(b"abc"),
            urls: Vec::new(),
        }];

        let error = download_files(&install, &server.base_url, &hostile, 4, |_, _, _, _| {})
            .expect_err("unsafe path must be rejected");
        assert!(error.contains(".."), "unexpected error: {error}");
        assert_eq!(
            server
                .requests
                .lock()
                .map(|guard| guard.len())
                .unwrap_or(0),
            0
        );
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn prune_deletes_only_whitelisted_paths() {
        let install = temp_dir("prune");
        fs::create_dir_all(install.join("CrossingVoid").join("Content")).expect("create dirs");
        fs::create_dir_all(install.join("Saved").join("Config")).expect("create saved dir");
        fs::write(install.join("stale.pak"), b"old").expect("write stale");
        fs::write(
            install.join("CrossingVoid").join("Content").join("old.ucas"),
            b"old",
        )
        .expect("write nested stale");
        fs::write(
            install.join("Saved").join("Config").join("Game.ini"),
            b"settings",
        )
        .expect("write settings");
        fs::write(install.join(STATE_FILE_NAME), b"{}").expect("write state");

        let summary = prune_files(
            &install,
            &[
                "stale.pak".to_string(),
                "CrossingVoid/Content/old.ucas".to_string(),
                "Saved/Config/Game.ini".to_string(),
                STATE_FILE_NAME.to_string(),
                "../outside.txt".to_string(),
                "missing.pak".to_string(),
            ],
        );

        assert_eq!(summary.removed.len(), 2);
        assert!(!install.join("stale.pak").exists());
        assert!(!install
            .join("CrossingVoid")
            .join("Content")
            .join("old.ucas")
            .exists());
        assert!(install
            .join("Saved")
            .join("Config")
            .join("Game.ini")
            .exists());
        assert!(install.join(STATE_FILE_NAME).exists());
        assert_eq!(summary.skipped.len(), 3);
        assert_eq!(summary.failed.len(), 1);
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn scan_reports_only_files_that_are_really_present() {
        let install = temp_dir("scan");
        fs::create_dir_all(install.join("CrossingVoid")).expect("create dirs");
        fs::write(install.join("CrossingVoid").join("keep.bin"), b"keep").expect("write keep");
        fs::write(install.join("CrossingVoid").join("other.bin"), b"other").expect("write other");

        let wanted = vec![
            entry("CrossingVoid/keep.bin", b"keep"),
            entry("CrossingVoid/content.bin", b"missing"),
        ];
        let found = scan_local_files(&install, &wanted).expect("scan");

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "CrossingVoid/keep.bin");
        assert_eq!(found[0].sha256, sha256_hex(b"keep"));
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn state_file_round_trips_and_stays_readable_by_legacy_shape() {
        let install = temp_dir("state");
        let files = vec![entry("CrossingVoid.exe", b"binary")];

        write_state(&install, "crossingvoid-game", "0.5.14", &files).expect("write state");
        let state = read_state(&install)
            .expect("read state")
            .expect("state exists");
        assert_eq!(state.version, "0.5.14");
        assert_eq!(state.product_key, "crossingvoid-game");
        assert_eq!(state.files.len(), 1);
        assert_eq!(state.files[0].sha256, files[0].sha256);

        // 老形状（只有 files）也必须能读。
        fs::write(
            install.join(STATE_FILE_NAME),
            r#"{"files":[{"path":"a.txt","sizeBytes":1,"sha256":"x"}]}"#,
        )
        .expect("write legacy state");
        let legacy = read_state(&install)
            .expect("read legacy")
            .expect("legacy exists");
        assert_eq!(legacy.schema_version, 1);
        assert_eq!(legacy.files.len(), 1);
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn progress_calls_are_monotonic_and_end_at_total() {
        let (bodies, entries) = fixture();
        let server = start_fake_server(bodies, StdHashMap::new());
        let install = temp_dir("progress");
        let seen: Arc<Mutex<Vec<(u64, u64, u64, u64)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);

        let total: u64 = entries.iter().map(|entry| entry.size_bytes).sum();
        let total_files = entries.len() as u64;
        download_files(
            &install,
            &server.base_url,
            &entries,
            2,
            move |done, total_bytes, done_files, files_total| {
                sink.lock()
                    .expect("progress sink")
                    .push((done, total_bytes, done_files, files_total));
            },
        )
        .expect("download");

        let guard = seen.lock().expect("progress sink");
        assert!(!guard.is_empty());
        assert!(guard
            .iter()
            .all(|(_, observed, _, files_total)| *observed == total && *files_total == total_files));
        let mut previous = 0u64;
        let mut previous_files = 0u64;
        for (done, _, done_files, _) in guard.iter() {
            assert!(*done >= previous, "progress must not go backwards");
            assert!(*done_files >= previous_files, "file count must not go backwards");
            previous = *done;
            previous_files = *done_files;
        }
        assert_eq!(previous, total);
        assert_eq!(previous_files, total_files);
        drop(guard);
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    #[test]
    fn concurrency_is_clamped_to_safe_range() {
        let (bodies, entries) = fixture();
        let server = start_fake_server(bodies, StdHashMap::new());
        let install = temp_dir("clamp");
        // 传 99 也不应该打爆服务器（内部 clamp 到 6）。
        download_files(&install, &server.base_url, &entries, 99, |_, _, _, _| {}).expect("download");
        fs::remove_dir_all(install).expect("remove temp dir");
    }

    /// 真实下载站联调：只下 NOTICES.txt（100 多字节），验证活服务的清单 + 文件 + sha256。
    /// 手动跑：`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_download`
    #[test]
    #[ignore = "需要联网：验证 dl.crossingvoid.top 的真实清单与文件"]
    fn live_download_matches_published_sha256() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LiveManifest {
            base_url: String,
            files: Vec<GamePackageFile>,
        }

        let url = "https://dl.crossingvoid.top/games/crossingvoid/manifests/0.5.14.json";
        let agent = build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
        let manifest: LiveManifest = agent
            .get(url)
            .call()
            .expect("fetch live manifest")
            .into_json()
            .expect("parse live manifest");

        let target = manifest
            .files
            .iter()
            .find(|entry| entry.path == "NOTICES.txt")
            .cloned()
            .expect("NOTICES.txt in live manifest");

        let install = temp_dir("live");
        let summary = download_files(
            &install,
            &manifest.base_url,
            &[target.clone()],
            1,
            |_, _, _, _| {},
        )
        .expect("download NOTICE.txt");

        assert_eq!(summary.files, 1);
        let bytes = fs::read(install.join("NOTICES.txt")).expect("read downloaded notice");
        assert_eq!(bytes.len() as u64, target.size_bytes);
        assert_eq!(sha256_hex(&bytes), target.sha256);
        fs::remove_dir_all(install).expect("remove temp dir");
    }
}
