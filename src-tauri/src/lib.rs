// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
#[cfg(debug_assertions)]
use std::io::{BufRead, BufReader};
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(debug_assertions)]
use std::process::Stdio;
#[cfg(debug_assertions)]
use std::sync::atomic::AtomicU32;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(debug_assertions)]
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_SPEED_LIMIT_BYTES_PER_SECOND: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
#[cfg(debug_assertions)]
static DEV_SCRIPT_PROCESS_ID: AtomicU32 = AtomicU32::new(0);
#[cfg(debug_assertions)]
static DEV_SCRIPT_PAUSE_REQUESTED: AtomicBool = AtomicBool::new(false);
const DOWNLOAD_CANCELLED_ERROR: &str = "DOWNLOAD_CANCELLED";
#[cfg(debug_assertions)]
const DEV_SCRIPT_PAUSED: &str = "DEV_SCRIPT_PAUSED";
const DOWNLOAD_RETRY_ATTEMPTS: u32 = 3;
const MAX_ERROR_LOG_TOTAL_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ERROR_LOG_DETAIL_BYTES: usize = 256 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    stage: String,
    percent: f64,
    current_items: Option<u64>,
    total_items: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubNetworkStatus {
    proxy_detected: bool,
    reachable: bool,
    latency_ms: Option<u64>,
}

struct DownloadThrottle {
    current_limit_bytes_per_second: u64,
    started_at: Instant,
    started_bytes: u64,
}

impl DownloadThrottle {
    fn new(started_bytes: u64) -> Self {
        Self {
            current_limit_bytes_per_second: DOWNLOAD_SPEED_LIMIT_BYTES_PER_SECOND
                .load(Ordering::SeqCst),
            started_at: Instant::now(),
            started_bytes,
        }
    }

    fn wait_if_needed(&mut self, current_bytes: u64) -> Result<(), String> {
        let limit = DOWNLOAD_SPEED_LIMIT_BYTES_PER_SECOND.load(Ordering::SeqCst);
        if limit != self.current_limit_bytes_per_second {
            self.current_limit_bytes_per_second = limit;
            self.started_at = Instant::now();
            self.started_bytes = current_bytes;
        }
        if limit == 0 {
            return Ok(());
        }
        let transferred = current_bytes.saturating_sub(self.started_bytes);
        let expected_elapsed = Duration::from_secs_f64(transferred as f64 / limit as f64);
        let actual_elapsed = self.started_at.elapsed();
        if expected_elapsed > actual_elapsed {
            sleep_with_cancel(expected_elapsed - actual_elapsed)?;
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveChunk {
    index: Option<u32>,
    file_name: String,
    #[serde(default)]
    url: String,
    sha256: Option<String>,
    size_bytes: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportGameChunksResult {
    imported_chunks: u64,
    total_chunks: u64,
    complete: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkImportProgress {
    current_chunk: u64,
    total_chunks: u64,
    file_name: String,
    processed_bytes: u64,
    total_bytes: u64,
    current_chunk_bytes: u64,
    current_chunk_total_bytes: u64,
    percent: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepairSummary {
    checked_files: u64,
    repaired_files: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestVerifySummary {
    checked_files: u64,
    invalid_files: u64,
    missing_files: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameProcessExited {
    code: Option<i32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchGameResult {
    already_running: bool,
    process_id: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepairProgress {
    stage: String,
    checked_files: u64,
    total_files: u64,
    repaired_files: u64,
    current_file: Option<String>,
    processed_bytes: u64,
    total_bytes: u64,
    current_file_bytes: u64,
    current_file_total_bytes: u64,
    percent: f64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadStateFile {
    install_path: String,
    selected_install_base_path: String,
    download_source: String,
    mode: Option<String>,
    downloaded_bytes: u64,
    total_bytes: u64,
    state: String,
    install_stage: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameFileManifest {
    files: Vec<GameFileManifestEntry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameFileManifestEntry {
    path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevScriptResult {
    code: i32,
    stdout: String,
    stderr: String,
}

#[cfg(debug_assertions)]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevScriptFinished {
    script: String,
    success: bool,
    code: i32,
    message: String,
}

#[cfg(debug_assertions)]
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevScriptProgress {
    stage: String,
    percent: f64,
    message: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
fn get_available_space(path: String) -> Result<u64, String> {
    platform_available_space(&path)
}

#[tauri::command]
async fn get_game_migration_size(install_path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let game_path = Path::new(&install_path)
            .canonicalize()
            .map_err(|error| format!("无法读取当前游戏目录 {}: {}", install_path, error))?;
        directory_size(&game_migration_source(&game_path))
    })
    .await
    .map_err(|error| format!("游戏迁移空间统计失败: {}", error))?
}

#[tauri::command]
fn pause_game_download() {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn cancel_game_operation() {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn set_download_speed_limit(speed_limit_bytes_per_second: Option<u64>) {
    DOWNLOAD_SPEED_LIMIT_BYTES_PER_SECOND
        .store(speed_limit_bytes_per_second.unwrap_or(0), Ordering::SeqCst);
}

#[tauri::command]
fn read_download_state_file(install_path: String) -> Result<Option<DownloadStateFile>, String> {
    let path = download_state_file_path(&install_path);
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Unable to read download state {}: {}",
            path.display(),
            error
        )
    })?;
    let state = serde_json::from_str::<DownloadStateFile>(&text).map_err(|error| {
        format!(
            "Unable to parse download state {}: {}",
            path.display(),
            error
        )
    })?;
    Ok(Some(state))
}

#[tauri::command]
fn write_download_state_file(state: DownloadStateFile) -> Result<(), String> {
    let path = download_state_file_path(&state.install_path);
    let parent = path
        .parent()
        .ok_or_else(|| format!("Download state path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to create download state directory {}: {}",
            parent.display(),
            error
        )
    })?;
    let text = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Unable to serialize download state: {}", error))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, text).map_err(|error| {
        format!(
            "Unable to write download state {}: {}",
            temporary_path.display(),
            error
        )
    })?;
    replace_file_atomic(&temporary_path, &path).map_err(|error| {
        format!(
            "Unable to replace download state {} with {}: {}",
            path.display(),
            temporary_path.display(),
            error
        )
    })
}

#[tauri::command]
fn clear_download_state_file(install_path: String) -> Result<(), String> {
    let path = download_state_file_path(&install_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| {
            format!(
                "Unable to remove download state {}: {}",
                path.display(),
                error
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
fn clear_game_download_artifacts(install_path: String) -> Result<(), String> {
    let download_dir = PathBuf::from(&install_path).join("_download");
    remove_download_artifacts(&download_dir)?;
    clear_download_state_file(install_path)
}

#[tauri::command]
fn dev_get_launcher_version() -> Result<Option<String>, String> {
    #[cfg(not(debug_assertions))]
    {
        Ok(None)
    }

    #[cfg(debug_assertions)]
    {
        read_dev_launcher_version(&dev_project_root()?)
    }
}

#[tauri::command]
fn dev_set_launcher_version(version: String) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = version;
        return Err("开发工具仅在调试模式可用。".into());
    }

    #[cfg(debug_assertions)]
    {
        let clean_version = version.trim();
        if !is_safe_semver(clean_version) {
            return Err("版本号格式不正确，请使用 0.1.1 或 0.1.1-beta.1。".into());
        }

        let project_root = dev_project_root()?;
        write_dev_launcher_version(&project_root, clean_version)?;
        Ok(clean_version.to_string())
    }
}

#[tauri::command]
async fn dev_publish_remote_notice(
    title: String,
    content: String,
    level: String,
    enabled: bool,
) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = title;
        let _ = content;
        let _ = level;
        let _ = enabled;
        return Err("开发工具仅在调试模式可用。".into());
    }

    #[cfg(debug_assertions)]
    {
        let published_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Unable to read system time: {}", error))?
            .as_millis() as u64;
        let payload = build_remote_notice_payload(&title, &content, &level, enabled, published_at)?;
        let project_root = dev_project_root()?;
        tauri::async_runtime::spawn_blocking(move || {
            publish_remote_notice_blocking(&project_root, &payload)
        })
        .await
        .map_err(|error| format!("Remote notice task failed: {}", error))??;
        Ok(if enabled {
            "远程公告已发布。".to_string()
        } else {
            "远程公告已关闭。".to_string()
        })
    }
}

#[tauri::command]
fn dev_run_launcher_script(
    app: AppHandle,
    script: String,
    output_dir: Option<String>,
    installer_path: Option<String>,
    manifest_path: Option<String>,
    game_platform: Option<String>,
    game_channel: Option<String>,
    game_directory: Option<String>,
    release_version: Option<String>,
    release_title: Option<String>,
) -> Result<DevScriptResult, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        let _ = script;
        let _ = output_dir;
        let _ = installer_path;
        let _ = manifest_path;
        let _ = game_platform;
        let _ = game_channel;
        let _ = game_directory;
        let _ = release_version;
        let _ = release_title;
        return Err("开发工具仅在调试模式可用。".into());
    }

    #[cfg(debug_assertions)]
    {
        let project_root = dev_project_root()?;
        DEV_SCRIPT_PROCESS_ID
            .compare_exchange(0, u32::MAX, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "已有开发任务正在运行。".to_string())?;
        DEV_SCRIPT_PAUSE_REQUESTED.store(false, Ordering::SeqCst);
        let script_for_thread = script.clone();
        let app_for_thread = app.clone();
        thread::spawn(move || {
            let mut result = run_dev_launcher_script_blocking(
                app_for_thread.clone(),
                project_root,
                script_for_thread.clone(),
                output_dir,
                installer_path,
                manifest_path,
                game_platform,
                game_channel,
                game_directory,
                release_version,
                release_title,
            );
            let pause_requested = DEV_SCRIPT_PAUSE_REQUESTED.swap(false, Ordering::SeqCst);
            DEV_SCRIPT_PROCESS_ID.store(0, Ordering::SeqCst);
            if pause_requested {
                result = Err(DEV_SCRIPT_PAUSED.to_string());
            }
            let finished = match result {
                Ok(result) => DevScriptFinished {
                    script: script_for_thread,
                    success: true,
                    code: result.code,
                    message: "任务完成".to_string(),
                },
                Err(error) => DevScriptFinished {
                    script: script_for_thread,
                    success: false,
                    code: -1,
                    message: error,
                },
            };
            let _ = app_for_thread.emit("dev-script-finished", finished);
        });
        Ok(DevScriptResult {
            code: 0,
            stdout: "started".to_string(),
            stderr: String::new(),
        })
    }
}

#[tauri::command]
fn dev_pause_script() -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        return Err("开发工具仅在调试模式可用。".into());
    }

    #[cfg(debug_assertions)]
    {
        let process_id = DEV_SCRIPT_PROCESS_ID.load(Ordering::SeqCst);
        if process_id == 0 {
            return Err("当前没有可暂停的上传任务。".into());
        }

        DEV_SCRIPT_PAUSE_REQUESTED.store(true, Ordering::SeqCst);
        if process_id == u32::MAX {
            return Ok(());
        }

        if let Err(error) = terminate_dev_script_process_tree(process_id) {
            DEV_SCRIPT_PAUSE_REQUESTED.store(false, Ordering::SeqCst);
            return Err(error);
        }
        Ok(())
    }
}

#[tauri::command]
fn open_launcher_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = launcher_log_dir(&app).or_else(|error| {
        #[cfg(debug_assertions)]
        {
            let _ = error;
            dev_project_root().map(|root| dev_launcher_log_dir(&root))
        }
        #[cfg(not(debug_assertions))]
        {
            Err(error)
        }
    })?;
    fs::create_dir_all(&log_dir).map_err(|error| {
        format!(
            "Unable to create launcher log directory {}: {}",
            log_dir.display(),
            error
        )
    })?;
    open_folder(&log_dir)
}

#[tauri::command]
fn write_launcher_error_log(
    app: AppHandle,
    title: String,
    detail: String,
    context: Option<String>,
    occurred_at: String,
    file_timestamp: String,
) -> Result<String, String> {
    let log_dir = launcher_log_dir(&app)?;
    let file_name = launcher_error_log_file_name(&title, &file_timestamp);
    let detail = truncate_utf8(&detail, MAX_ERROR_LOG_DETAIL_BYTES);
    let context = truncate_utf8(context.as_deref().unwrap_or(""), 64 * 1024);
    let content = format!(
        "标题：{}\n发生时间：{}\n\n错误详情：\n{}\n\n运行状态：\n{}\n",
        title.trim(),
        occurred_at.trim(),
        detail,
        context
    );
    write_text_log_file(&log_dir, &file_name, &content)?;
    prune_launcher_error_logs(&log_dir)?;
    Ok(log_dir.join(file_name).to_string_lossy().to_string())
}

#[tauri::command]
fn dev_open_project_folder() -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        return Err("开发工具仅在调试模式可用。".into());
    }

    #[cfg(debug_assertions)]
    {
        open_folder(&dev_project_root()?)
    }
}

#[tauri::command]
fn validate_game_install_state(install_path: String, state: String) -> Result<bool, String> {
    validate_install_state(&install_path, &state)
}

#[tauri::command]
async fn find_game_installation(root_path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        find_game_installation_internal(Path::new(&root_path))
            .map(|path| path.map(|value| value.to_string_lossy().to_string()))
    })
    .await
    .map_err(|error| format!("Game location search task failed: {}", error))?
}

#[tauri::command]
async fn move_game_installation(source_path: String, destination_base_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_game_installation_internal(Path::new(&source_path), Path::new(&destination_base_path))
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("Game migration task failed: {}", error))?
}

fn move_game_installation_internal(source: &Path, destination_base: &Path) -> Result<PathBuf, String> {
    if !validate_install_state(source.to_string_lossy().as_ref(), "ready")? {
        return Err("当前目录不是完整游戏，无法迁移。".to_string());
    }
    if !destination_base.is_dir() {
        return Err(format!("新的安装位置不存在：{}", destination_base.display()));
    }

    let source_game = source
        .canonicalize()
        .map_err(|error| format!("无法读取当前游戏目录 {}: {}", source.display(), error))?;
    let destination_base_canonical = destination_base
        .canonicalize()
        .map_err(|error| format!("无法读取新的安装位置 {}: {}", destination_base.display(), error))?;
    let game_directory_name = source_game
        .file_name()
        .ok_or_else(|| "无法识别当前游戏目录名称。".to_string())?;
    let source_to_move = game_migration_source(&source_game);
    let moves_container = source_to_move != source_game;
    let destination_container = destination_base.join("TFAC-hz64");
    let destination_game = destination_container.join(game_directory_name);
    let destination_to_move = if moves_container {
        destination_container.clone()
    } else {
        destination_game.clone()
    };
    let canonical_destination_game = destination_base_canonical
        .join("TFAC-hz64")
        .join(game_directory_name);
    let canonical_destination_to_move = if moves_container {
        destination_base_canonical.join("TFAC-hz64")
    } else {
        canonical_destination_game
    };

    if canonical_destination_to_move == source_to_move {
        return Err("新的安装位置与当前游戏目录相同。".to_string());
    }
    if canonical_destination_to_move.starts_with(&source_to_move) {
        return Err("新的安装位置不能位于当前游戏目录内。".to_string());
    }
    if destination_to_move.exists() {
        return Err(format!(
            "新的安装位置已存在同名游戏目录：{}",
            destination_to_move.display()
        ));
    }
    if !moves_container {
        fs::create_dir_all(&destination_container).map_err(|error| {
            format!(
                "无法创建新的游戏容器目录 {}: {}",
                destination_container.display(),
                error
            )
        })?;
    }

    match fs::rename(&source_to_move, &destination_to_move) {
        Ok(()) => Ok(destination_game),
        Err(rename_error) if rename_error.raw_os_error() == Some(17) => {
            copy_game_directory(&source_to_move, &destination_to_move)?;
            if !validate_install_state(destination_game.to_string_lossy().as_ref(), "ready")? {
                let _ = fs::remove_dir_all(&destination_to_move);
                return Err("迁移后的游戏文件不完整，已取消迁移。".to_string());
            }
            fs::remove_dir_all(&source_to_move).map_err(|error| {
                format!(
                    "游戏文件已复制到 {}，但无法删除旧目录 {}: {}",
                    destination_to_move.display(),
                    source_to_move.display(),
                    error
                )
            })?;
            Ok(destination_game)
        }
        Err(error) => Err(format!("迁移游戏文件失败：{}", error)),
    }
}

fn game_migration_source(game_path: &Path) -> PathBuf {
    let Some(parent) = game_path.parent() else {
        return game_path.to_path_buf();
    };
    let is_container = parent
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("TFAC-hz64"));
    if is_container {
        parent.to_path_buf()
    } else {
        game_path.to_path_buf()
    }
}

fn directory_size(root: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in fs::read_dir(root)
        .map_err(|error| format!("无法读取迁移目录 {}: {}", root.display(), error))?
    {
        let entry = entry.map_err(|error| format!("无法读取迁移文件: {}", error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取迁移文件属性 {}: {}", entry.path().display(), error))?;
        if file_type.is_symlink() {
            return Err(format!("迁移目录包含不支持的链接：{}", entry.path().display()));
        }
        if file_type.is_dir() {
            total = total
                .checked_add(directory_size(&entry.path())?)
                .ok_or_else(|| "迁移目录大小超过支持范围。".to_string())?;
        } else if file_type.is_file() {
            total = total
                .checked_add(entry.metadata().map_err(|error| {
                    format!("无法读取迁移文件大小 {}: {}", entry.path().display(), error)
                })?.len())
                .ok_or_else(|| "迁移目录大小超过支持范围。".to_string())?;
        }
    }
    Ok(total)
}

fn copy_game_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("无法创建迁移目录 {}: {}", destination.display(), error))?;
    let copy_result = (|| {
        for entry in fs::read_dir(source)
            .map_err(|error| format!("无法读取游戏目录 {}: {}", source.display(), error))?
        {
            let entry = entry.map_err(|error| format!("无法读取游戏文件: {}", error))?;
            let source_path = entry.path();
            let destination_path = destination.join(entry.file_name());
            let file_type = entry
                .file_type()
                .map_err(|error| format!("无法读取游戏文件属性 {}: {}", source_path.display(), error))?;
            if file_type.is_symlink() {
                return Err(format!("游戏目录包含不支持迁移的链接：{}", source_path.display()));
            }
            if file_type.is_dir() {
                copy_game_directory(&source_path, &destination_path)?;
            } else if file_type.is_file() {
                fs::copy(&source_path, &destination_path).map_err(|error| {
                    format!("无法复制游戏文件 {}: {}", source_path.display(), error)
                })?;
            }
        }
        Ok(())
    })();
    if copy_result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    copy_result
}

fn find_game_installation_internal(root: &Path) -> Result<Option<PathBuf>, String> {
    if !root.is_dir() {
        return Err(format!("Selected game location is not a directory: {}", root.display()));
    }

    const MAX_SCANNED_DIRECTORIES: usize = 10_000;
    let mut pending = VecDeque::from([root.to_path_buf()]);
    let mut scanned = 0usize;
    while let Some(directory) = pending.pop_front() {
        scanned += 1;
        if scanned > MAX_SCANNED_DIRECTORIES {
            return Err("重新定位搜索范围过大，请选择更接近游戏目录的文件夹。".to_string());
        }
        if validate_install_state(directory.to_string_lossy().as_ref(), "ready")? {
            return Ok(Some(directory));
        }

        let mut children = match fs::read_dir(&directory) {
            Ok(entries) => entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    entry.file_type().ok().filter(|kind| kind.is_dir() && !kind.is_symlink())?;
                    Some(entry.path())
                })
                .collect::<Vec<_>>(),
            Err(_) => continue,
        };
        children.sort();
        pending.extend(children);
    }
    Ok(None)
}

#[tauri::command]
fn read_game_version_file(install_path: String) -> Result<String, String> {
    let path = PathBuf::from(&install_path).join("CrossingVoid.version.json");
    fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read game version {}: {}", path.display(), error))
}

fn migrate_mislabeled_game_version_internal(install_dir: &Path) -> Result<bool, String> {
    let version_path = install_dir.join("CrossingVoid.version.json");
    let manifest_path = install_dir.join("CrossingVoid.manifest.json");
    if !version_path.is_file() || !manifest_path.is_file() {
        return Ok(false);
    }

    let mut version: serde_json::Value = serde_json::from_slice(
        &fs::read(&version_path)
            .map_err(|error| format!("Unable to read {}: {}", version_path.display(), error))?,
    )
    .map_err(|error| format!("Unable to parse {}: {}", version_path.display(), error))?;
    let is_mislabeled_release = version.get("productKey").and_then(|value| value.as_str())
        == Some("crossingvoid-game")
        && version.get("runtime").and_then(|value| value.as_str()) == Some("Windows")
        && version.get("version").and_then(|value| value.as_str()) == Some("V0.5.13")
        && version.get("title").and_then(|value| value.as_str()) == Some("V0.5.13测试下载")
        && version
            .get("archiveFileName")
            .and_then(|value| value.as_str())
            == Some("CrossingVoid.zip");
    if !is_mislabeled_release {
        return Ok(false);
    }

    let mut manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("Unable to read {}: {}", manifest_path.display(), error))?,
    )
    .map_err(|error| format!("Unable to parse {}: {}", manifest_path.display(), error))?;
    if manifest.get("version").and_then(|value| value.as_str()) != Some("V0.5.13") {
        return Ok(false);
    }

    version["version"] = serde_json::json!("V0.5.12");
    version["title"] = serde_json::json!("V0.5.12");
    let version_bytes = serde_json::to_vec_pretty(&version)
        .map_err(|error| format!("Unable to serialize corrected game version: {}", error))?;
    let version_hash = format!("{:x}", Sha256::digest(&version_bytes));

    manifest["version"] = serde_json::json!("V0.5.12");
    manifest["title"] = serde_json::json!("V0.5.12");
    let version_entry = manifest
        .get_mut("files")
        .and_then(|value| value.as_array_mut())
        .and_then(|entries| {
            entries.iter_mut().find(|entry| {
                entry.get("path").and_then(|value| value.as_str())
                    == Some("CrossingVoid.version.json")
            })
        })
        .ok_or_else(|| "Game manifest is missing CrossingVoid.version.json".to_string())?;
    version_entry["sizeBytes"] = serde_json::json!(version_bytes.len() as u64);
    version_entry["sha256"] = serde_json::json!(version_hash);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to serialize corrected game manifest: {}", error))?;

    fs::write(&version_path, version_bytes)
        .map_err(|error| format!("Unable to update {}: {}", version_path.display(), error))?;
    fs::write(&manifest_path, manifest_bytes)
        .map_err(|error| format!("Unable to update {}: {}", manifest_path.display(), error))?;
    Ok(true)
}

#[tauri::command]
fn migrate_mislabeled_game_version(install_path: String) -> Result<bool, String> {
    migrate_mislabeled_game_version_internal(&PathBuf::from(install_path))
}

#[tauri::command]
fn open_game_folder(install_path: String) -> Result<(), String> {
    open_folder(&PathBuf::from(install_path))
}

#[tauri::command]
fn delete_installed_game(app: AppHandle, install_path: String) -> Result<(), String> {
    delete_installed_game_internal(&app, &PathBuf::from(install_path))
}

#[tauri::command]
fn uninstall_launcher() -> Result<(), String> {
    uninstall_launcher_internal()
}

#[tauri::command]
fn is_game_running() -> bool {
    is_game_process_running()
}

#[tauri::command]
fn exit_launcher(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn launch_game(
    app: AppHandle,
    install_path: String,
    use_dx11: bool,
    exit_launcher: bool,
) -> Result<LaunchGameResult, String> {
    launch_game_internal(app, &PathBuf::from(install_path), use_dx11, exit_launcher)
}

#[tauri::command]
fn create_game_desktop_shortcut_now(install_path: String) -> Result<(), String> {
    create_game_desktop_shortcut(&PathBuf::from(install_path))
}

#[tauri::command]
fn install_vc_redist(app: AppHandle, install_path: String) -> Result<(), String> {
    install_vc_redist_internal(Some(&app), &PathBuf::from(install_path))
}

#[tauri::command]
async fn repair_game_from_archive(
    app: AppHandle,
    install_path: String,
    expected_size: u64,
    file_name: String,
    chunks: Vec<ArchiveChunk>,
) -> Result<RepairSummary, String> {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        repair_game_from_staged_archive(app, install_path, expected_size, file_name, chunks)
    })
    .await
    .map_err(|error| format!("Repair task failed: {}", error))?
}

#[tauri::command]
async fn verify_game_manifest(
    app: AppHandle,
    install_path: String,
) -> Result<ManifestVerifySummary, String> {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || verify_game_manifest_internal(app, install_path))
        .await
        .map_err(|error| format!("Manifest verify task failed: {}", error))?
}

#[tauri::command]
async fn check_game_manifest_files(install_path: String) -> Result<ManifestVerifySummary, String> {
    tauri::async_runtime::spawn_blocking(move || check_game_manifest_files_internal(&install_path))
        .await
        .map_err(|error| format!("Manifest check task failed: {}", error))?
}

#[tauri::command]
fn validate_downloaded_archive_state(
    install_path: String,
    expected_size: u64,
    file_name: String,
    chunks: Vec<ArchiveChunk>,
    install_stage: Option<String>,
) -> Result<bool, String> {
    validate_staged_archive(
        &install_path,
        expected_size,
        &file_name,
        &chunks,
        install_stage.as_deref(),
    )
}

#[tauri::command]
async fn fetch_remote_text(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = build_http_agent(&url, Duration::from_secs(8), Duration::from_secs(8));
        let response = agent
            .get(&url)
            .set("User-Agent", "CrossingVoidLauncher/0.1")
            .call()
            .map_err(|error| format!("Unable to request {}: {}", url, error))?;

        response
            .into_string()
            .map_err(|error| format!("Unable to read response from {}: {}", url, error))
    })
    .await
    .map_err(|error| format!("Remote request task failed: {}", error))?
}

#[tauri::command]
async fn fetch_github_release_asset_text(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = build_http_agent(&url, Duration::from_secs(8), Duration::from_secs(15));
        let response = agent
            .get(&url)
            .set("User-Agent", "CrossingVoidLauncher/0.1")
            .set("Accept", "application/octet-stream")
            .call()
            .map_err(|error| {
                format!("Unable to request GitHub release asset {}: {}", url, error)
            })?;

        response
            .into_string()
            .map_err(|error| format!("Unable to read GitHub release asset {}: {}", url, error))
    })
    .await
    .map_err(|error| format!("GitHub release asset request task failed: {}", error))?
}

#[tauri::command]
async fn get_github_network_status() -> GithubNetworkStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let proxy_url = system_proxy_url();
        let proxy_detected = proxy_url.is_some();
        let started = Instant::now();
        let reachable = build_http_agent_with_proxy(
            Duration::from_secs(5),
            Duration::from_secs(8),
            proxy_url.as_deref(),
        )
        .get("https://github.com/")
        .set("User-Agent", "CrossingVoidLauncher/0.1")
        .call()
        .is_ok();
        GithubNetworkStatus {
            proxy_detected,
            reachable,
            latency_ms: reachable.then(|| started.elapsed().as_millis() as u64),
        }
    })
    .await
    .unwrap_or(GithubNetworkStatus {
        proxy_detected: false,
        reachable: false,
        latency_ms: None,
    })
}

fn build_http_agent(url: &str, connect_timeout: Duration, read_timeout: Duration) -> ureq::Agent {
    let proxy_url = is_github_url(url).then(system_proxy_url).flatten();
    build_http_agent_with_proxy(connect_timeout, read_timeout, proxy_url.as_deref())
}

fn build_http_agent_with_proxy(
    connect_timeout: Duration,
    read_timeout: Duration,
    proxy_url: Option<&str>,
) -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(connect_timeout)
        .timeout_read(read_timeout);
    if let Some(proxy_url) = proxy_url {
        if let Ok(proxy) = ureq::Proxy::new(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }
    builder.build()
}

fn is_github_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://api.github.com/")
        || url.starts_with("https://objects.githubusercontent.com/")
        || url.starts_with("https://release-assets.githubusercontent.com/")
}

fn system_proxy_url() -> Option<String> {
    ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
        .iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .and_then(|value| normalize_proxy_url(&value))
        })
        .or_else(windows_internet_proxy_url)
}

#[cfg(windows)]
fn windows_internet_proxy_url() -> Option<String> {
    let mut enabled_command = hidden_windows_command("reg.exe");
    let enabled = enabled_command
        .args([
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            "/v",
            "ProxyEnable",
        ])
        .output()
        .ok()
        .filter(|result| result.status.success())
        .map(|result| String::from_utf8_lossy(&result.stdout).contains("0x1"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    let mut server_command = hidden_windows_command("reg.exe");
    let output = server_command
        .args([
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            "/v",
            "ProxyServer",
        ])
        .output();
    output
        .ok()
        .filter(|result| result.status.success())
        .and_then(|result| {
            String::from_utf8_lossy(&result.stdout)
                .lines()
                .find(|line| line.contains("ProxyServer"))
                .and_then(|line| line.split_whitespace().last())
                .and_then(normalize_proxy_url)
        })
}

#[cfg(windows)]
fn hidden_windows_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn windows_internet_proxy_url() -> Option<String> {
    None
}

fn normalize_proxy_url(value: &str) -> Option<String> {
    let candidate = value
        .split(';')
        .find_map(|item| {
            let item = item.trim();
            item.strip_prefix("https=")
                .or_else(|| item.strip_prefix("HTTPS="))
                .map(str::trim)
        })
        .or_else(|| value.split(';').next().map(str::trim))?;
    if candidate.is_empty() {
        return None;
    }
    if candidate.contains("://") {
        Some(candidate.to_string())
    } else {
        Some(format!("http://{}", candidate))
    }
}

#[tauri::command]
async fn post_remote_json(url: String, body: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(8))
            .timeout_read(std::time::Duration::from_secs(8))
            .build();
        let response = agent
            .post(&url)
            .set("User-Agent", "CrossingVoidLauncher/0.1")
            .set("Content-Type", "application/json")
            .send_string(&body)
            .map_err(|error| format!("Unable to post {}: {}", url, error))?;

        response
            .into_string()
            .map_err(|error| format!("Unable to read response from {}: {}", url, error))
    })
    .await
    .map_err(|error| format!("Remote post task failed: {}", error))?
}

#[tauri::command]
async fn download_game_archive(
    app: AppHandle,
    url: String,
    install_path: String,
    expected_size: u64,
    file_name: String,
    chunks: Vec<ArchiveChunk>,
    speed_limit_bytes_per_second: Option<u64>,
) -> Result<(), String> {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    DOWNLOAD_SPEED_LIMIT_BYTES_PER_SECOND
        .store(speed_limit_bytes_per_second.unwrap_or(0), Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        download_archive_to_staging(app, url, install_path, expected_size, file_name, chunks)
    })
    .await
    .map_err(|error| format!("Download task failed: {}", error))?
}

#[tauri::command]
async fn import_game_chunks(
    app: AppHandle,
    install_path: String,
    chunks: Vec<ArchiveChunk>,
    source_paths: Vec<String>,
) -> Result<ImportGameChunksResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if chunks.is_empty() {
            return Err("当前游戏清单没有可导入的碎片。".to_string());
        }

        let download_dir = PathBuf::from(install_path).join("_download");
        let mut imported_sources = Vec::new();

        for source_path in source_paths {
            let source = PathBuf::from(source_path);
            if source.is_dir() {
                imported_sources.extend(collect_imported_chunk_files(&source, &chunks)?);
            } else if source.is_file() {
                imported_sources.push(source);
            } else {
                return Err(format!("选择的游戏分片路径不存在：{}", source.display()));
            }
        }
        if imported_sources.is_empty() {
            return Err("所选文件夹中没有找到当前版本的游戏分片。".to_string());
        }

        let mut sources_by_manifest_name = HashMap::new();
        for source in imported_sources {
            let source_name = sanitize_file_name(&source.to_string_lossy())
                .ok_or_else(|| "Imported chunk file name is empty".to_string())?;
            let expected = resolve_imported_chunk(&source_name, &chunks)
                .ok_or_else(|| "Imported chunk is not part of the current manifest".to_string())?;
            let destination_name = sanitize_file_name(&expected.file_name)
                .ok_or_else(|| "Manifest chunk file name is empty".to_string())?;
            sources_by_manifest_name
                .entry(destination_name)
                .or_insert((source, source_name));
        }

        let mut candidates = Vec::new();
        for (destination_name, (source, source_name)) in sources_by_manifest_name {
            if source.starts_with(&download_dir) {
                return Err("请选择启动器下载缓存以外的游戏分片文件夹。".to_string());
            }
            let expected = resolve_imported_chunk(&destination_name, &chunks)
                .ok_or_else(|| "Imported chunk is not part of the current manifest".to_string())?;
            let metadata = fs::metadata(&source)
                .map_err(|error| format!("Unable to inspect imported chunk {}: {}", source.display(), error))?;
            if !metadata.is_file() {
                return Err(format!("Imported chunk is not a file: {}", source.display()));
            }
            if let Some(expected_size) = expected.size_bytes {
                if metadata.len() != expected_size {
                    return Err(format!("Imported chunk size mismatch: {}", source_name));
                }
            }
            candidates.push((
                destination_name,
                source,
                source_name,
                metadata.len(),
                expected.sha256.clone(),
            ));
        }
        candidates.sort_by(|left, right| left.0.cmp(&right.0));

        let total_chunks = candidates.len() as u64;
        let total_bytes = candidates
            .iter()
            .map(|candidate| candidate.3)
            .sum::<u64>()
            .max(1);
        let mut processed_bytes = 0u64;
        let mut validated_sources = Vec::new();
        for (index, (destination_name, source, source_name, file_size, expected_hash)) in
            candidates.into_iter().enumerate()
        {
            let current_chunk = index as u64 + 1;
            let emit_progress = |current_chunk_bytes: u64| {
                let absolute_bytes = processed_bytes
                    .saturating_add(current_chunk_bytes.min(file_size))
                    .min(total_bytes);
                let _ = app.emit(
                    "game-chunk-import-progress",
                    ChunkImportProgress {
                        current_chunk,
                        total_chunks,
                        file_name: source_name.clone(),
                        processed_bytes: absolute_bytes,
                        total_bytes,
                        current_chunk_bytes: current_chunk_bytes.min(file_size),
                        current_chunk_total_bytes: file_size,
                        percent: absolute_bytes as f64 / total_bytes as f64 * 100.0,
                    },
                );
            };
            emit_progress(0);
            if let Some(expected_hash) = expected_hash.as_deref() {
                let normalized_expected = expected_hash.trim().to_ascii_lowercase();
                let actual = calculate_file_sha256_with_progress(&source, emit_progress)?;
                if !normalized_expected.is_empty() && actual != normalized_expected {
                    return Err(format!("Imported chunk SHA256 mismatch: {}", source_name));
                }
            } else {
                emit_progress(file_size);
            }
            processed_bytes = processed_bytes.saturating_add(file_size).min(total_bytes);
            validated_sources.push((destination_name, source));
        }

        remove_download_artifacts(&download_dir)?;
        fs::create_dir_all(&download_dir).map_err(|error| {
            format!("Unable to create import directory {}: {}", download_dir.display(), error)
        })?;
        let mut imported_chunks = 0u64;
        for (destination_name, source) in validated_sources {
            let destination = download_dir.join(destination_name);
            fs::copy(&source, &destination).map_err(|error| {
                format!("Unable to import chunk {}: {}", source.display(), error)
            })?;
            imported_chunks = imported_chunks.saturating_add(1);
        }

        let complete = validate_staged_archive(&download_dir.parent().unwrap_or(&download_dir).to_string_lossy(), 0, "", &chunks, Some("downloaded"))?;
        Ok(ImportGameChunksResult { imported_chunks, total_chunks: chunks.len() as u64, complete })
    })
    .await
    .map_err(|error| format!("Import task failed: {}", error))?
}

#[tauri::command]
async fn install_downloaded_game_archive(
    app: AppHandle,
    install_path: String,
    sha256: String,
    expected_size: u64,
    file_name: String,
    create_desktop_shortcut: bool,
    chunks: Vec<ArchiveChunk>,
    install_stage: Option<String>,
) -> Result<(), String> {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        install_staged_archive(
            app,
            install_path,
            sha256,
            expected_size,
            file_name,
            create_desktop_shortcut,
            chunks,
            install_stage,
        )
    })
    .await
    .map_err(|error| format!("Install task failed: {}", error))?
}

fn emit_download_progress(app: &AppHandle, downloaded_bytes: u64, total_bytes: u64) {
    let percent = if total_bytes > 0 {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let _ = app.emit(
        "game-download-progress",
        DownloadProgress {
            downloaded_bytes,
            total_bytes,
            percent,
        },
    );
}

fn emit_repair_progress(
    app: &AppHandle,
    stage: &str,
    checked_files: u64,
    total_files: u64,
    repaired_files: u64,
) {
    emit_repair_progress_detail(
        app,
        stage,
        checked_files,
        total_files,
        repaired_files,
        None,
        0,
        0,
        0,
        0,
    );
}

fn repair_progress_percent(
    checked_files: u64,
    total_files: u64,
    processed_bytes: u64,
    total_bytes: u64,
) -> f64 {
    if total_bytes > 0 {
        ((processed_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else if total_files > 0 {
        ((checked_files as f64 / total_files as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_repair_progress_detail(
    app: &AppHandle,
    stage: &str,
    checked_files: u64,
    total_files: u64,
    repaired_files: u64,
    current_file: Option<&str>,
    processed_bytes: u64,
    total_bytes: u64,
    current_file_bytes: u64,
    current_file_total_bytes: u64,
) {
    let percent = repair_progress_percent(checked_files, total_files, processed_bytes, total_bytes);
    let _ = app.emit(
        "game-repair-progress",
        RepairProgress {
            stage: stage.to_string(),
            checked_files,
            total_files,
            repaired_files,
            current_file: current_file.map(str::to_string),
            processed_bytes,
            total_bytes,
            current_file_bytes,
            current_file_total_bytes,
            percent,
        },
    );
}

fn emit_install_progress(app: &AppHandle, stage: &str, percent: f64) {
    let _ = app.emit(
        "game-install-progress",
        InstallProgress {
            stage: stage.to_string(),
            percent: percent.clamp(0.0, 100.0),
            current_items: None,
            total_items: None,
        },
    );
}

fn emit_install_progress_with_items(
    app: &AppHandle,
    stage: &str,
    percent: f64,
    current_items: u64,
    total_items: u64,
) {
    let _ = app.emit(
        "game-install-progress",
        InstallProgress {
            stage: stage.to_string(),
            percent: percent.clamp(0.0, 100.0),
            current_items: Some(current_items),
            total_items: Some(total_items),
        },
    );
}

fn download_archive_to_staging(
    app: AppHandle,
    url: String,
    install_path: String,
    expected_size: u64,
    file_name: String,
    chunks: Vec<ArchiveChunk>,
) -> Result<(), String> {
    let install_dir = PathBuf::from(&install_path);
    let download_dir = install_dir.join("_download");
    fs::create_dir_all(&download_dir).map_err(|error| {
        format!(
            "Unable to create download directory {}: {}",
            download_dir.display(),
            error
        )
    })?;
    fs::create_dir_all(&install_dir).map_err(|error| {
        format!(
            "Unable to create install directory {}: {}",
            install_dir.display(),
            error
        )
    })?;

    let archive_name =
        sanitize_file_name(&file_name).unwrap_or_else(|| "CrossingVoid.zip".to_string());
    let archive_path = download_dir.join(archive_name);
    download_archive_once(
        &app,
        &url,
        &chunks,
        &download_dir,
        &archive_path,
        expected_size,
    )?;
    Ok(())
}

fn install_staged_archive(
    app: AppHandle,
    install_path: String,
    sha256: String,
    expected_size: u64,
    file_name: String,
    create_desktop_shortcut: bool,
    chunks: Vec<ArchiveChunk>,
    install_stage: Option<String>,
) -> Result<(), String> {
    let install_dir = PathBuf::from(&install_path);
    let download_dir = install_dir.join("_download");
    fs::create_dir_all(&download_dir).map_err(|error| {
        format!(
            "Unable to create download directory {}: {}",
            download_dir.display(),
            error
        )
    })?;
    fs::create_dir_all(&install_dir).map_err(|error| {
        format!(
            "Unable to create install directory {}: {}",
            install_dir.display(),
            error
        )
    })?;

    let archive_name =
        sanitize_file_name(&file_name).unwrap_or_else(|| "CrossingVoid.zip".to_string());
    let archive_path = download_dir.join(archive_name);
    let starting_stage = install_stage.as_deref().unwrap_or("downloaded");
    let archive_ready = archive_has_expected_size(&archive_path, expected_size);
    if (starting_stage.eq_ignore_ascii_case("merged")
        || starting_stage.eq_ignore_ascii_case("extracting"))
        && !archive_ready
    {
        return Err(format!(
            "Staged archive is missing: {}",
            archive_path.display()
        ));
    }
    if !archive_ready {
        combine_existing_chunks(&app, &chunks, &download_dir, &archive_path, expected_size)?;
    }

    check_download_cancelled()?;
    emit_install_progress(&app, "verifying", 30.0);
    if let Err(error) = verify_sha256(
        &archive_path,
        &sha256,
        Some((&app, "verifying", 30.0, 20.0)),
    ) {
        if sha256.trim().is_empty() {
            return Err(error);
        }
        return Err(error);
    }
    persist_install_stage(&install_path, expected_size, "merged")?;
    remove_chunk_files(&download_dir, &chunks)?;

    check_download_cancelled()?;
    persist_install_stage(&install_path, expected_size, "extracting")?;
    emit_install_progress(&app, "extracting", 50.0);
    extract_zip(&archive_path, &install_dir, &app, 50.0, 50.0)?;
    if create_desktop_shortcut {
        create_game_desktop_shortcut(&install_dir)?;
    }
    install_vc_redist_internal(Some(&app), &install_dir)?;
    remove_download_artifacts(&download_dir)?;
    emit_install_progress(&app, "completed", 100.0);
    Ok(())
}

fn download_archive_once(
    app: &AppHandle,
    url: &str,
    chunks: &[ArchiveChunk],
    download_dir: &Path,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    if chunks.is_empty() {
        download_file(app, url, archive_path, expected_size)
    } else {
        download_chunks_and_combine(app, chunks, download_dir, archive_path, expected_size)
    }
}

fn check_download_cancelled() -> Result<(), String> {
    if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
        Err(DOWNLOAD_CANCELLED_ERROR.to_string())
    } else {
        Ok(())
    }
}

fn sleep_with_cancel(duration: Duration) -> Result<(), String> {
    let mut remaining = duration;
    let slice = Duration::from_millis(100);
    while remaining > Duration::ZERO {
        check_download_cancelled()?;
        let sleep_for = remaining.min(slice);
        std::thread::sleep(sleep_for);
        remaining = remaining.saturating_sub(sleep_for);
    }
    Ok(())
}

fn is_range_not_satisfiable(error: &ureq::Error) -> bool {
    matches!(error, ureq::Error::Status(416, _))
}

fn is_github_release_asset_api_url(url: &str) -> bool {
    url.starts_with("https://api.github.com/repos/") && url.contains("/releases/assets/")
}

fn configure_download_request(request: ureq::Request, url: &str) -> ureq::Request {
    let request = request.set("User-Agent", "CrossingVoidLauncher/0.1");
    if is_github_release_asset_api_url(url) {
        request
            .set("Accept", "application/octet-stream")
            .set("X-GitHub-Api-Version", "2022-11-28")
    } else {
        request
    }
}

fn download_file(
    app: &AppHandle,
    url: &str,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    retry_download("archive", || {
        download_file_once(app, url, archive_path, expected_size)
    })
}

fn retry_download<F>(label: &str, mut action: F) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    let mut last_error = String::new();
    for attempt in 1..=DOWNLOAD_RETRY_ATTEMPTS {
        check_download_cancelled()?;
        match action() {
            Ok(()) => return Ok(()),
            Err(error) if error == DOWNLOAD_CANCELLED_ERROR => return Err(error),
            Err(error) => {
                last_error = error;
                if attempt < DOWNLOAD_RETRY_ATTEMPTS {
                    sleep_with_cancel(Duration::from_millis(350 * attempt as u64))?;
                }
            }
        }
    }
    Err(format!(
        "Unable to download {} after {} attempts: {}",
        label, DOWNLOAD_RETRY_ATTEMPTS, last_error
    ))
}

fn download_file_once(
    app: &AppHandle,
    url: &str,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let agent = build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
    let mut resume_from = existing_download_size(archive_path, expected_size)?;
    let mut request = configure_download_request(agent.get(url), url);
    let range_header;
    if resume_from > 0 {
        range_header = format!("bytes={}-", resume_from);
        request = request.set("Range", &range_header);
    }
    let response = match request.call() {
        Ok(response) => response,
        Err(error) if resume_from > 0 && is_range_not_satisfiable(&error) => {
            if expected_size > 0 && archive_has_expected_size(archive_path, expected_size) {
                emit_download_progress(app, expected_size, expected_size);
                return Ok(());
            }
            remove_file_if_exists(archive_path)?;
            return download_file_once(app, url, archive_path, expected_size);
        }
        Err(error) => return Err(format!("Unable to download archive: {}", error)),
    };
    if resume_from > 0 && response.status() != 206 {
        resume_from = 0;
    }

    let total_bytes = response
        .header("content-length")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(|value| value.saturating_add(resume_from))
        .unwrap_or(expected_size);
    let mut reader = response.into_reader();
    let mut writer = open_download_writer(archive_path, resume_from).map_err(|error| {
        format!(
            "Unable to create archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let mut buffer = vec![0u8; 1024 * 256];
    let mut downloaded = resume_from;
    let mut throttle = DownloadThrottle::new(resume_from);
    emit_download_progress(app, downloaded, total_bytes);

    loop {
        check_download_cancelled()?;
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read download stream: {}", error))?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            format!(
                "Unable to write archive {}: {}",
                archive_path.display(),
                error
            )
        })?;
        downloaded += read as u64;
        emit_download_progress(app, downloaded, total_bytes);
        throttle.wait_if_needed(downloaded)?;
    }
    writer.flush().map_err(|error| {
        format!(
            "Unable to flush archive {}: {}",
            archive_path.display(),
            error
        )
    })?;

    if expected_size > 0 && downloaded != expected_size {
        return Err(format!(
            "Archive size mismatch: downloaded {} bytes, expected {} bytes",
            downloaded, expected_size
        ));
    }

    Ok(())
}

fn existing_download_size(output_path: &Path, expected_size: u64) -> Result<u64, String> {
    let Ok(metadata) = fs::metadata(output_path) else {
        return Ok(0);
    };
    let current_size = metadata.len();
    if expected_size > 0 && current_size > expected_size {
        fs::remove_file(output_path).map_err(|error| {
            format!(
                "Unable to remove oversized partial file {}: {}",
                output_path.display(),
                error
            )
        })?;
        return Ok(0);
    }

    Ok(current_size)
}

fn open_download_writer(output_path: &Path, resume_from: u64) -> std::io::Result<File> {
    if resume_from > 0 {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(output_path)
    } else {
        File::create(output_path)
    }
}

fn download_chunks_and_combine(
    app: &AppHandle,
    chunks: &[ArchiveChunk],
    download_dir: &Path,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let mut ordered_chunks = chunks.to_vec();
    ordered_chunks.sort_by_key(|chunk| chunk.index.unwrap_or(u32::MAX));

    let total_bytes = if expected_size > 0 {
        expected_size
    } else {
        ordered_chunks
            .iter()
            .filter_map(|chunk| chunk.size_bytes)
            .sum()
    };

    let mut chunk_paths = Vec::new();
    for chunk in &ordered_chunks {
        let chunk_name = sanitize_file_name(&chunk.file_name)
            .ok_or_else(|| "Chunk file name is empty".to_string())?;
        chunk_paths.push(download_dir.join(chunk_name));
    }

    let existing_bytes = chunk_paths
        .iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .sum::<u64>()
        .min(total_bytes);
    let mut completed_bytes = 0u64;
    if existing_bytes < total_bytes {
        emit_download_progress(app, existing_bytes, total_bytes);
    }

    for (chunk, chunk_path) in ordered_chunks.iter().zip(chunk_paths.iter()) {
        check_download_cancelled()?;
        let chunk_size = chunk.size_bytes.unwrap_or(0);
        let was_complete =
            chunk_size > 0 && existing_download_size(chunk_path, chunk_size)? == chunk_size;
        download_file_with_offset(
            app,
            &chunk.url,
            chunk_path,
            chunk_size,
            completed_bytes,
            total_bytes,
        )?;
        if let Some(expected_hash) = chunk.sha256.as_deref() {
            if let Err(error) = verify_sha256(&chunk_path, expected_hash, None) {
                if expected_hash.trim().is_empty() {
                    return Err(error);
                }
                remove_file_if_exists(&chunk_path)?;
                download_file_with_offset(
                    app,
                    &chunk.url,
                    chunk_path,
                    chunk_size,
                    completed_bytes,
                    total_bytes,
                )?;
                verify_sha256(&chunk_path, expected_hash, None)?;
            }
        }
        let actual_size = fs::metadata(&chunk_path)
            .map_err(|error| {
                format!(
                    "Unable to inspect chunk {}: {}",
                    chunk_path.display(),
                    error
                )
            })?
            .len();
        completed_bytes = completed_bytes.saturating_add(actual_size);
        if !was_complete {
            emit_download_progress(app, completed_bytes, total_bytes);
        }
    }

    let temporary_archive_path = archive_path.with_extension("zip.merging");
    remove_file_if_exists(&temporary_archive_path)?;
    let mut archive = File::create(&temporary_archive_path).map_err(|error| {
        format!(
            "Unable to create combined archive {}: {}",
            temporary_archive_path.display(),
            error
        )
    })?;
    let mut combined_bytes = 0u64;
    for chunk_path in &chunk_paths {
        let mut chunk_file = File::open(chunk_path)
            .map_err(|error| format!("Unable to open chunk {}: {}", chunk_path.display(), error))?;
        let copied_bytes = std::io::copy(&mut chunk_file, &mut archive).map_err(|error| {
            format!("Unable to append chunk {}: {}", chunk_path.display(), error)
        })?;
        combined_bytes = combined_bytes.saturating_add(copied_bytes);
        emit_download_progress(app, combined_bytes.min(total_bytes), total_bytes);
    }
    archive.flush().map_err(|error| {
        format!(
            "Unable to flush combined archive {}: {}",
            temporary_archive_path.display(),
            error
        )
    })?;
    drop(archive);

    if expected_size > 0 {
        let combined_size = fs::metadata(&temporary_archive_path)
            .map_err(|error| {
                format!(
                    "Unable to inspect combined archive {}: {}",
                    temporary_archive_path.display(),
                    error
                )
            })?
            .len();
        if combined_size != expected_size {
            remove_file_if_exists(&temporary_archive_path)?;
            return Err(format!(
                "Combined archive size mismatch: combined {} bytes, expected {} bytes",
                combined_size, expected_size
            ));
        }
    }

    replace_file_atomic(&temporary_archive_path, archive_path).map_err(|error| {
        format!(
            "Unable to move combined archive {} to {}: {}",
            temporary_archive_path.display(),
            archive_path.display(),
            error
        )
    })?;

    Ok(())
}

fn combine_existing_chunks(
    app: &AppHandle,
    chunks: &[ArchiveChunk],
    download_dir: &Path,
    archive_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let mut ordered_chunks = chunks.to_vec();
    ordered_chunks.sort_by_key(|chunk| chunk.index.unwrap_or(u32::MAX));
    if ordered_chunks.is_empty() {
        return Err(format!(
            "Staged archive is missing and no chunks were provided: {}",
            archive_path.display()
        ));
    }

    emit_install_progress(app, "merging", 0.0);
    let total_bytes = if expected_size > 0 {
        expected_size
    } else {
        ordered_chunks
            .iter()
            .filter_map(|chunk| chunk.size_bytes)
            .sum::<u64>()
            .max(1)
    };
    let mut archive = File::create(archive_path).map_err(|error| {
        format!(
            "Unable to create combined archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let mut combined_bytes = 0u64;

    for chunk in &ordered_chunks {
        check_download_cancelled()?;
        let chunk_name = sanitize_file_name(&chunk.file_name)
            .ok_or_else(|| "Chunk file name is empty".to_string())?;
        let chunk_path = download_dir.join(chunk_name);
        let chunk_size = chunk.size_bytes.unwrap_or(0);
        let actual_size = fs::metadata(&chunk_path)
            .map_err(|error| {
                format!(
                    "Unable to inspect chunk {}: {}",
                    chunk_path.display(),
                    error
                )
            })?
            .len();
        if chunk_size > 0 && actual_size != chunk_size {
            return Err(format!(
                "Chunk size mismatch before merge: {} is {} bytes, expected {} bytes",
                chunk_path.display(),
                actual_size,
                chunk_size
            ));
        }
        if let Some(expected_hash) = chunk.sha256.as_deref() {
            verify_sha256(&chunk_path, expected_hash, None)?;
        }
        let mut chunk_file = File::open(&chunk_path)
            .map_err(|error| format!("Unable to open chunk {}: {}", chunk_path.display(), error))?;
        let copied_bytes = std::io::copy(&mut chunk_file, &mut archive).map_err(|error| {
            format!("Unable to append chunk {}: {}", chunk_path.display(), error)
        })?;
        combined_bytes = combined_bytes.saturating_add(copied_bytes);
        let percent = 30.0 * (combined_bytes.min(total_bytes) as f64 / total_bytes.max(1) as f64);
        emit_install_progress(app, "merging", percent);
    }
    archive.flush().map_err(|error| {
        format!(
            "Unable to flush combined archive {}: {}",
            archive_path.display(),
            error
        )
    })?;

    if expected_size > 0 {
        let combined_size = fs::metadata(archive_path)
            .map_err(|error| {
                format!(
                    "Unable to inspect combined archive {}: {}",
                    archive_path.display(),
                    error
                )
            })?
            .len();
        if combined_size != expected_size {
            return Err(format!(
                "Combined archive size mismatch: combined {} bytes, expected {} bytes",
                combined_size, expected_size
            ));
        }
    }

    Ok(())
}

fn download_file_with_offset(
    app: &AppHandle,
    url: &str,
    output_path: &Path,
    expected_size: u64,
    downloaded_offset: u64,
    total_bytes: u64,
) -> Result<(), String> {
    let label = format!("chunk {}", output_path.display());
    retry_download(&label, || {
        download_file_with_offset_once(
            app,
            url,
            output_path,
            expected_size,
            downloaded_offset,
            total_bytes,
        )
    })
}

fn download_file_with_offset_once(
    app: &AppHandle,
    url: &str,
    output_path: &Path,
    expected_size: u64,
    downloaded_offset: u64,
    total_bytes: u64,
) -> Result<(), String> {
    let mut resume_from = existing_download_size(output_path, expected_size)?;
    if expected_size > 0 && resume_from == expected_size {
        emit_download_progress(
            app,
            downloaded_offset.saturating_add(resume_from),
            total_bytes,
        );
        return Ok(());
    }

    let agent = build_http_agent(url, Duration::from_secs(12), Duration::from_secs(30));
    let mut request = configure_download_request(agent.get(url), url);
    let range_header;
    if resume_from > 0 {
        range_header = format!("bytes={}-", resume_from);
        request = request.set("Range", &range_header);
    }
    let response = match request.call() {
        Ok(response) => response,
        Err(error) if resume_from > 0 && is_range_not_satisfiable(&error) => {
            if expected_size > 0 && archive_has_expected_size(output_path, expected_size) {
                emit_download_progress(
                    app,
                    downloaded_offset.saturating_add(expected_size),
                    total_bytes,
                );
                return Ok(());
            }
            remove_file_if_exists(output_path)?;
            return download_file_with_offset_once(
                app,
                url,
                output_path,
                expected_size,
                downloaded_offset,
                total_bytes,
            );
        }
        Err(error) => return Err(format!("Unable to download chunk: {}", error)),
    };
    if resume_from > 0 && response.status() != 206 {
        resume_from = 0;
    }

    let mut reader = response.into_reader();
    let mut writer = open_download_writer(output_path, resume_from).map_err(|error| {
        format!(
            "Unable to create chunk {}: {}",
            output_path.display(),
            error
        )
    })?;
    let mut buffer = vec![0u8; 1024 * 256];
    let mut downloaded = resume_from;
    let mut throttle = DownloadThrottle::new(downloaded_offset.saturating_add(resume_from));
    emit_download_progress(
        app,
        downloaded_offset.saturating_add(downloaded),
        total_bytes,
    );

    loop {
        check_download_cancelled()?;
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read chunk stream: {}", error))?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            format!("Unable to write chunk {}: {}", output_path.display(), error)
        })?;
        downloaded += read as u64;
        let absolute_downloaded = downloaded_offset.saturating_add(downloaded);
        emit_download_progress(app, absolute_downloaded, total_bytes);
        throttle.wait_if_needed(absolute_downloaded)?;
    }
    writer
        .flush()
        .map_err(|error| format!("Unable to flush chunk {}: {}", output_path.display(), error))?;

    if expected_size > 0 && downloaded != expected_size {
        return Err(format!(
            "Chunk size mismatch: downloaded {} bytes, expected {} bytes",
            downloaded, expected_size
        ));
    }

    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to remove {}: {}", path.display(), error))?;
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_COPY_ALLOWED, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH | MOVEFILE_COPY_ALLOWED;
    let ok = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), flags) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| error.to_string())
}

fn replace_file_from_reader<R: Read>(reader: &mut R, output_path: &Path) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Unable to create directory {}: {}", parent.display(), error)
        })?;
    }
    let temporary_path = output_path.with_extension("cvtmp");
    remove_file_if_exists(&temporary_path)?;
    let mut output = File::create(&temporary_path).map_err(|error| {
        format!(
            "Unable to create temporary file {}: {}",
            temporary_path.display(),
            error
        )
    })?;
    let mut buffer = vec![0u8; 1024 * 256];
    loop {
        check_download_cancelled()?;
        let read = reader.read(&mut buffer).map_err(|error| {
            format!(
                "Unable to read source for {}: {}",
                output_path.display(),
                error
            )
        })?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read]).map_err(|error| {
            format!(
                "Unable to write temporary file {}: {}",
                temporary_path.display(),
                error
            )
        })?;
    }
    output.flush().map_err(|error| {
        format!(
            "Unable to flush temporary file {}: {}",
            temporary_path.display(),
            error
        )
    })?;
    drop(output);
    replace_file_atomic(&temporary_path, output_path).map_err(|error| {
        format!(
            "Unable to replace {} with {}: {}",
            output_path.display(),
            temporary_path.display(),
            error
        )
    })
}

fn remove_chunk_files(download_dir: &Path, chunks: &[ArchiveChunk]) -> Result<(), String> {
    for chunk in chunks {
        if let Some(chunk_name) = sanitize_file_name(&chunk.file_name) {
            remove_file_if_exists(&download_dir.join(chunk_name))?;
        }
    }
    Ok(())
}

fn remove_download_artifacts(download_dir: &Path) -> Result<(), String> {
    if download_dir.exists() {
        fs::remove_dir_all(download_dir).map_err(|error| {
            format!(
                "Unable to remove download artifacts {}: {}",
                download_dir.display(),
                error
            )
        })?;
    }
    Ok(())
}

fn archive_has_expected_size(path: &Path, expected_size: u64) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    if expected_size > 0 {
        metadata.len() == expected_size
    } else {
        metadata.len() > 0
    }
}

fn validate_staged_archive(
    install_path: &str,
    expected_size: u64,
    file_name: &str,
    chunks: &[ArchiveChunk],
    install_stage: Option<&str>,
) -> Result<bool, String> {
    let download_dir = PathBuf::from(install_path).join("_download");
    let archive_name =
        sanitize_file_name(file_name).unwrap_or_else(|| "CrossingVoid.zip".to_string());
    let archive_path = download_dir.join(archive_name);
    let stage = install_stage.unwrap_or("downloaded");

    if stage.eq_ignore_ascii_case("merged") || stage.eq_ignore_ascii_case("extracting") {
        return Ok(archive_has_expected_size(&archive_path, expected_size));
    }

    if archive_has_expected_size(&archive_path, expected_size) {
        return Ok(true);
    }

    if chunks.is_empty() {
        return Ok(false);
    }

    for chunk in chunks {
        let Some(chunk_name) = sanitize_file_name(&chunk.file_name) else {
            return Ok(false);
        };
        let chunk_path = download_dir.join(chunk_name);
        let Ok(metadata) = fs::metadata(&chunk_path) else {
            return Ok(false);
        };
        if !metadata.is_file() {
            return Ok(false);
        }
        if let Some(expected_chunk_size) = chunk.size_bytes {
            if metadata.len() != expected_chunk_size {
                return Ok(false);
            }
        } else if metadata.len() == 0 {
            return Ok(false);
        }
    }

    Ok(true)
}

fn staged_archive_path(install_path: &str, file_name: &str) -> PathBuf {
    let archive_name =
        sanitize_file_name(file_name).unwrap_or_else(|| "CrossingVoid.zip".to_string());
    PathBuf::from(install_path)
        .join("_download")
        .join(archive_name)
}

fn repair_game_from_staged_archive(
    app: AppHandle,
    install_path: String,
    expected_size: u64,
    file_name: String,
    chunks: Vec<ArchiveChunk>,
) -> Result<RepairSummary, String> {
    let install_dir = PathBuf::from(&install_path);
    let archive_path = staged_archive_path(&install_path, &file_name);
    if !archive_has_expected_size(&archive_path, expected_size) {
        combine_existing_chunks(
            &app,
            &chunks,
            &install_dir.join("_download"),
            &archive_path,
            expected_size,
        )?;
    }
    if !archive_has_expected_size(&archive_path, expected_size) {
        return Err(format!(
            "Repair archive is missing or incomplete: {}",
            archive_path.display()
        ));
    }

    let file = File::open(&archive_path).map_err(|error| {
        format!(
            "Unable to open repair archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| {
        format!(
            "Unable to read repair archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let manifest_entries = load_manifest_entry_map(&install_dir).ok();
    let mut checked_files = 0u64;
    let mut repaired_files = 0u64;
    let mut total_files = 0u64;
    for index in 0..archive.len() {
        if let Ok(entry) = archive.by_index(index) {
            if !entry.is_dir() && entry.enclosed_name().is_some() {
                total_files = total_files.saturating_add(1);
            }
        }
    }
    emit_repair_progress(&app, "checking", 0, total_files, 0);

    for index in 0..archive.len() {
        check_download_cancelled()?;
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to read repair zip entry {}: {}", index, error))?;
        let Some(enclosed_name) = entry.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };
        let output_path = install_dir.join(&enclosed_name);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| {
                format!(
                    "Unable to create directory {}: {}",
                    output_path.display(),
                    error
                )
            })?;
            continue;
        }

        checked_files = checked_files.saturating_add(1);
        let manifest_key = normalize_manifest_path(&enclosed_name.to_string_lossy());
        let needs_repair = match manifest_entries.as_ref() {
            Some(entries) => match entries.get(&manifest_key) {
                Some((expected_size, expected_hash)) => {
                    file_needs_manifest_repair(&output_path, *expected_size, expected_hash)?
                }
                None => fs::metadata(&output_path)
                    .map(|metadata| !metadata.is_file() || metadata.len() != entry.size())
                    .unwrap_or(true),
            },
            None => true,
        };
        if !needs_repair {
            emit_repair_progress(&app, "checking", checked_files, total_files, repaired_files);
            continue;
        }

        replace_file_from_reader(&mut entry, &output_path)?;
        repaired_files = repaired_files.saturating_add(1);
        emit_repair_progress(
            &app,
            "repairing",
            checked_files,
            total_files,
            repaired_files,
        );
    }

    emit_repair_progress(&app, "runtime", total_files, total_files, repaired_files);
    install_vc_redist_internal(Some(&app), &install_dir)?;
    emit_repair_progress(&app, "completed", total_files, total_files, repaired_files);
    Ok(RepairSummary {
        checked_files,
        repaired_files,
    })
}

fn normalize_manifest_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_ascii_lowercase()
}

fn load_manifest_entry_map(install_dir: &Path) -> Result<HashMap<String, (u64, String)>, String> {
    let manifest_path = install_dir.join("CrossingVoid.manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Unable to read game manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest = serde_json::from_str::<GameFileManifest>(&manifest_text).map_err(|error| {
        format!(
            "Unable to parse game manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    Ok(manifest
        .files
        .into_iter()
        .map(|entry| {
            (
                normalize_manifest_path(&entry.path),
                (entry.size_bytes, entry.sha256),
            )
        })
        .collect())
}

fn file_needs_manifest_repair(
    path: &Path,
    expected_size: u64,
    expected_hash: &str,
) -> Result<bool, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(true),
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        return Ok(true);
    }
    if expected_hash.trim().is_empty() {
        return Ok(false);
    }
    let actual_hash = match calculate_file_sha256(path) {
        Ok(hash) => hash,
        Err(_) => return Ok(true),
    };
    Ok(!actual_hash.eq_ignore_ascii_case(expected_hash.trim()))
}

fn check_game_manifest_files_internal(install_path: &str) -> Result<ManifestVerifySummary, String> {
    let install_dir = PathBuf::from(install_path);
    let manifest_entries = load_manifest_entry_map(&install_dir)?;
    let mut invalid_files = 0u64;
    let mut missing_files = 0u64;

    for (relative_path, (expected_size, _)) in &manifest_entries {
        let file_path = install_dir.join(relative_path.replace('/', "\\"));
        match fs::metadata(&file_path) {
            Ok(metadata) if metadata.is_file() && metadata.len() == *expected_size => {}
            Ok(_) => invalid_files = invalid_files.saturating_add(1),
            Err(_) => {
                invalid_files = invalid_files.saturating_add(1);
                missing_files = missing_files.saturating_add(1);
            }
        }
    }

    Ok(ManifestVerifySummary {
        checked_files: manifest_entries.len() as u64,
        invalid_files,
        missing_files,
    })
}

fn verify_game_manifest_internal(
    app: AppHandle,
    install_path: String,
) -> Result<ManifestVerifySummary, String> {
    let install_dir = PathBuf::from(&install_path);
    let manifest_path = install_dir.join("CrossingVoid.manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Unable to read game manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest = serde_json::from_str::<GameFileManifest>(&manifest_text).map_err(|error| {
        format!(
            "Unable to parse game manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let total_files = manifest.files.len() as u64;
    let total_bytes = manifest
        .files
        .iter()
        .fold(0u64, |total, entry| total.saturating_add(entry.size_bytes));
    let mut checked_files = 0u64;
    let mut invalid_files = 0u64;
    let mut missing_files = 0u64;
    let mut processed_bytes = 0u64;

    emit_repair_progress_detail(
        &app,
        "checking",
        0,
        total_files,
        0,
        None,
        0,
        total_bytes,
        0,
        0,
    );
    for entry in manifest.files {
        check_download_cancelled()?;
        checked_files = checked_files.saturating_add(1);
        let display_path = entry.path.replace('\\', "/");
        let relative_path = display_path.replace('/', "\\");
        let file_path = install_dir.join(relative_path);
        let current_file_total_bytes = entry.size_bytes;
        emit_repair_progress_detail(
            &app,
            "checking",
            checked_files,
            total_files,
            invalid_files,
            Some(&display_path),
            processed_bytes,
            total_bytes,
            0,
            current_file_total_bytes,
        );
        let file_ok = match fs::metadata(&file_path) {
            Ok(metadata) if metadata.is_file() && metadata.len() == entry.size_bytes => {
                match calculate_file_sha256_with_progress(&file_path, |current_file_bytes| {
                    emit_repair_progress_detail(
                        &app,
                        "checking",
                        checked_files,
                        total_files,
                        invalid_files,
                        Some(&display_path),
                        processed_bytes.saturating_add(current_file_bytes),
                        total_bytes,
                        current_file_bytes,
                        current_file_total_bytes,
                    );
                }) {
                    Ok(actual_hash) => actual_hash.eq_ignore_ascii_case(entry.sha256.trim()),
                    Err(_) => false,
                }
            }
            Ok(_) => false,
            Err(_) => {
                missing_files = missing_files.saturating_add(1);
                false
            }
        };

        if !file_ok {
            invalid_files = invalid_files.saturating_add(1);
        }
        processed_bytes = processed_bytes.saturating_add(current_file_total_bytes);
        emit_repair_progress_detail(
            &app,
            "checking",
            checked_files,
            total_files,
            invalid_files,
            Some(&display_path),
            processed_bytes,
            total_bytes,
            current_file_total_bytes,
            current_file_total_bytes,
        );
    }

    emit_repair_progress_detail(
        &app,
        "completed",
        total_files,
        total_files,
        invalid_files,
        None,
        total_bytes,
        total_bytes,
        0,
        0,
    );
    Ok(ManifestVerifySummary {
        checked_files,
        invalid_files,
        missing_files,
    })
}

fn calculate_file_sha256(path: &Path) -> Result<String, String> {
    calculate_file_sha256_with_progress(path, |_| {})
}

fn calculate_file_sha256_with_progress<F>(path: &Path, mut on_progress: F) -> Result<String, String>
where
    F: FnMut(u64),
{
    let mut file = File::open(path)
        .map_err(|error| format!("Unable to open {}: {}", path.display(), error))?;
    let total_bytes = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 512];
    let mut processed_bytes = 0u64;
    let mut last_emit = Instant::now();
    loop {
        check_download_cancelled()?;
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read {}: {}", path.display(), error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        processed_bytes = processed_bytes.saturating_add(read as u64);
        if last_emit.elapsed() >= Duration::from_millis(100) || processed_bytes >= total_bytes {
            on_progress(processed_bytes);
            last_emit = Instant::now();
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn persist_install_stage(
    install_path: &str,
    total_bytes: u64,
    install_stage: &str,
) -> Result<(), String> {
    let state = DownloadStateFile {
        install_path: install_path.to_string(),
        selected_install_base_path: infer_install_base_path(install_path),
        download_source: "official".to_string(),
        mode: Some("install".to_string()),
        downloaded_bytes: total_bytes,
        total_bytes,
        state: "downloaded".to_string(),
        install_stage: Some(install_stage.to_string()),
    };
    write_download_state_file(state)
}

fn infer_install_base_path(install_path: &str) -> String {
    Path::new(install_path)
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| install_path.to_string())
}

fn verify_sha256(
    path: &Path,
    expected: &str,
    progress: Option<(&AppHandle, &str, f64, f64)>,
) -> Result<(), String> {
    let normalized_expected = expected.trim().to_ascii_lowercase();
    if normalized_expected.is_empty() {
        return Ok(());
    }

    let mut file = File::open(path)
        .map_err(|error| format!("Unable to open {}: {}", path.display(), error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 256];
    let mut hashed_bytes = 0u64;
    loop {
        check_download_cancelled()?;
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to hash {}: {}", path.display(), error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        hashed_bytes = hashed_bytes.saturating_add(read as u64);
        if let Some((app, stage, base, span)) = progress {
            let file_size = fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or(0)
                .max(1);
            let percent = base + span * (hashed_bytes as f64 / file_size as f64);
            emit_install_progress(app, stage, percent);
        }
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != normalized_expected {
        return Err(format!(
            "SHA256 mismatch: actual {}, expected {}",
            actual, normalized_expected
        ));
    }

    Ok(())
}

fn extract_zip(
    archive_path: &Path,
    install_dir: &Path,
    app: &AppHandle,
    progress_base: f64,
    progress_span: f64,
) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "Unable to open archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Unable to read zip {}: {}", archive_path.display(), error))?;

    let entry_count = archive.len().max(1);
    for index in 0..archive.len() {
        check_download_cancelled()?;
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to read zip entry {}: {}", index, error))?;
        let Some(enclosed_name) = entry.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };
        let output_path = install_dir.join(enclosed_name);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| {
                format!(
                    "Unable to create directory {}: {}",
                    output_path.display(),
                    error
                )
            })?;
            let extracted_progress =
                progress_base + progress_span * ((index + 1) as f64 / entry_count as f64);
            emit_install_progress_with_items(
                app,
                "extracting",
                extracted_progress,
                (index + 1) as u64,
                entry_count as u64,
            );
            continue;
        }

        replace_file_from_reader(&mut entry, &output_path)?;
        let extracted_progress =
            progress_base + progress_span * ((index + 1) as f64 / entry_count as f64);
        emit_install_progress_with_items(
            app,
            "extracting",
            extracted_progress,
            (index + 1) as u64,
            entry_count as u64,
        );
    }

    Ok(())
}

fn sanitize_file_name(file_name: &str) -> Option<String> {
    let name = Path::new(file_name)
        .file_name()?
        .to_string_lossy()
        .trim()
        .to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn github_chunk_index(file_name: &str) -> Option<u32> {
    let suffix = file_name.strip_prefix("CrossingVoid.")?;
    if suffix.len() != 3 || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<u32>().ok().filter(|index| *index > 0)
}

fn resolve_imported_chunk<'a>(
    source_name: &str,
    chunks: &'a [ArchiveChunk],
) -> Option<&'a ArchiveChunk> {
    if let Some(chunk) = chunks.iter().find(|chunk| {
        sanitize_file_name(&chunk.file_name).as_deref() == Some(source_name)
    }) {
        return Some(chunk);
    }

    let github_index = github_chunk_index(source_name)?;
    chunks
        .iter()
        .find(|chunk| chunk.index == Some(github_index))
}

fn collect_imported_chunk_files(
    root: &Path,
    chunks: &[ArchiveChunk],
) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Err(format!("选择的游戏分片文件夹不存在：{}", root.display()));
    }

    const MAX_SCANNED_ENTRIES: usize = 10_000;
    let mut pending = VecDeque::from([root.to_path_buf()]);
    let mut found = Vec::new();
    let mut scanned = 0usize;
    while let Some(directory) = pending.pop_front() {
        let mut entries = match fs::read_dir(&directory) {
            Ok(entries) => entries.filter_map(Result::ok).collect::<Vec<_>>(),
            Err(error) if directory == root => {
                return Err(format!("无法读取游戏分片文件夹 {}：{}", root.display(), error));
            }
            Err(_) => continue,
        };
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            scanned += 1;
            if scanned > MAX_SCANNED_ENTRIES {
                return Err("游戏分片文件夹内容过多，请选择更接近分片的位置。".to_string());
            }
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push_back(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if resolve_imported_chunk(&file_name, chunks).is_some() {
                found.push(entry.path());
            }
        }
    }
    Ok(found)
}

fn download_state_file_path(install_path: &str) -> PathBuf {
    PathBuf::from(install_path)
        .join("_download")
        .join("download-state.json")
}

fn launcher_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|error| format!("Unable to resolve launcher log directory: {}", error))
}

fn launcher_error_log_file_name(title: &str, file_timestamp: &str) -> String {
    let mut safe_title = title
        .trim()
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                character
            }
        })
        .take(48)
        .collect::<String>();
    safe_title = safe_title.trim_matches([' ', '.']).to_string();
    if safe_title.is_empty() {
        safe_title = "启动器运行错误".to_string();
    }
    let safe_timestamp = file_timestamp
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == '-')
        .collect::<String>();
    let safe_timestamp = if safe_timestamp.is_empty() {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis().to_string())
            .unwrap_or_else(|_| "unknown-time".to_string())
    } else {
        safe_timestamp
    };
    format!("错误-{}-{}.log", safe_title, safe_timestamp)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn prune_launcher_error_logs(log_dir: &Path) -> Result<(), String> {
    let mut files = fs::read_dir(log_dir)
        .map_err(|error| format!("Unable to inspect launcher log directory {}: {}", log_dir.display(), error))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("错误-") || !name.ends_with(".log") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((entry.path(), metadata.len(), metadata.modified().ok()))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut total_bytes = files.iter().map(|(_, size, _)| *size).sum::<u64>();
    for (path, size, _) in files {
        if total_bytes <= MAX_ERROR_LOG_TOTAL_BYTES {
            break;
        }
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to prune launcher error log {}: {}", path.display(), error))?;
        total_bytes = total_bytes.saturating_sub(size);
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn dev_launcher_log_dir(project_root: &Path) -> PathBuf {
    project_root.join("Logs").join("Launcher")
}

#[cfg(debug_assertions)]
fn write_dev_script_log(
    app: &AppHandle,
    project_root: Option<&Path>,
    script: &str,
    code: i32,
    stdout_text: &str,
    stderr_text: &str,
) -> Result<(), String> {
    let content = format!(
        "script: {}\nexit_code: {}\n\n--- stdout ---\n{}\n--- stderr ---\n{}",
        script, code, stdout_text, stderr_text
    );
    let file_name = format!("dev-script-{}-latest.log", script);
    let mut errors = Vec::new();
    let mut wrote_any = false;

    match launcher_log_dir(app) {
        Ok(log_dir) => match write_text_log_file(&log_dir, &file_name, &content) {
            Ok(()) => wrote_any = true,
            Err(error) => errors.push(error),
        },
        Err(error) => errors.push(error),
    }

    if let Some(root) = project_root {
        let log_dir = dev_launcher_log_dir(root);
        match write_text_log_file(&log_dir, &file_name, &content) {
            Ok(()) => wrote_any = true,
            Err(error) => errors.push(error),
        }
    }

    if wrote_any {
        Ok(())
    } else {
        Err(format!(
            "Unable to write launcher logs: {}",
            errors.join(" | ")
        ))
    }
}

#[cfg(debug_assertions)]
fn run_dev_launcher_script_blocking(
    app: AppHandle,
    project_root: PathBuf,
    script: String,
    output_dir: Option<String>,
    installer_path: Option<String>,
    manifest_path: Option<String>,
    game_platform: Option<String>,
    game_channel: Option<String>,
    game_directory: Option<String>,
    release_version: Option<String>,
    release_title: Option<String>,
) -> Result<DevScriptResult, String> {
    let script_name = match script.as_str() {
        "build" => "Build-LauncherUpdaterPackage.ps1",
        "publish" => "Publish-LauncherGiteePackage.ps1",
        "game-windows" | "game-android" => "Publish-GamePackage.ps1",
        _ => return Err(format!("未知开发脚本：{}", script)),
    };
    let script_path = project_root.join("Scripts").join(script_name);
    if !script_path.is_file() {
        return Err(format!("脚本不存在：{}", script_path.display()));
    }

    let shell = dev_powershell_command();
    let mut command = Command::new(&shell);
    command.arg("-NoProfile");
    if shell.eq_ignore_ascii_case("powershell")
        || shell.to_ascii_lowercase().ends_with("powershell.exe")
    {
        command.arg("-ExecutionPolicy").arg("Bypass");
    }
    command
        .arg("-File")
        .arg(&script_path)
        .arg("-ProjectRoot")
        .arg(&project_root);

    if script == "build" || script == "publish" {
        if let Some(dir) = output_dir
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let output_path = PathBuf::from(dir);
            if !output_path.is_dir() {
                fs::create_dir_all(&output_path).map_err(|error| {
                    format!(
                        "Unable to create output directory {}: {}",
                        output_path.display(),
                        error
                    )
                })?;
            }
            if script == "build" {
                command.arg("-OutputDir").arg(output_path);
            } else {
                command.arg("-ReleasePackageDir").arg(output_path);
            }
        }
    }

    if script == "publish" {
        if let Some(path) = installer_path.filter(|value| !value.trim().is_empty()) {
            command.arg("-InstallerPath").arg(PathBuf::from(path));
        }
        if let Some(path) = manifest_path.filter(|value| !value.trim().is_empty()) {
            command.arg("-ManifestPath").arg(PathBuf::from(path));
        }
    }

    if script == "game-windows" || script == "game-android" {
        let platform = game_platform.unwrap_or_else(|| {
            if script == "game-windows" {
                "Windows".to_string()
            } else {
                "Android".to_string()
            }
        });
        let channel = game_channel.unwrap_or_else(|| "Stable".to_string());
        let game_directory = game_directory
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "请选择游戏打包目录。".to_string())?;
        if !game_directory.is_dir() {
            return Err(format!("游戏打包目录不存在：{}", game_directory.display()));
        }
        let package_output = output_dir
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.join("Saved").join("GamePackages"));
        fs::create_dir_all(&package_output)
            .map_err(|error| format!("Unable to create {}: {}", package_output.display(), error))?;
        let game_args = build_dev_game_publish_arguments(
            &platform,
            &channel,
            &game_directory,
            release_version.as_deref().unwrap_or_default(),
            release_title.as_deref().unwrap_or_default(),
            &package_output,
        )?;
        command.args(game_args);
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to run {}: {}", script_path.display(), error))?;
    let process_id = child.id();
    DEV_SCRIPT_PROCESS_ID.store(process_id, Ordering::SeqCst);
    if DEV_SCRIPT_PAUSE_REQUESTED.load(Ordering::SeqCst) {
        terminate_dev_script_process_tree(process_id)?;
    }

    let stderr_app = app.clone();
    let stderr_script = script.clone();
    let stderr_reader = child.stderr.take().map(|stderr| {
        thread::spawn(move || -> Result<String, String> {
            let mut stderr_text = String::new();
            let mut reader = BufReader::new(stderr);
            let mut line_bytes = Vec::new();
            loop {
                line_bytes.clear();
                let count = reader
                    .read_until(b'\n', &mut line_bytes)
                    .map_err(|error| format!("Unable to read script error output: {}", error))?;
                if count == 0 {
                    break;
                }
                let line = String::from_utf8_lossy(trim_line_ending_bytes(&line_bytes));
                handle_dev_script_output_line(&stderr_app, &stderr_script, &line);
                stderr_text.push_str(&line);
                stderr_text.push('\n');
            }
            Ok(stderr_text)
        })
    });

    let mut stdout_text = String::new();
    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout);
        let mut line_bytes = Vec::new();
        loop {
            line_bytes.clear();
            let count = match reader.read_until(b'\n', &mut line_bytes) {
                Ok(count) => count,
                Err(error) => {
                    let message = format!("Unable to read script output: {}", error);
                    let _ = write_dev_script_log(
                        &app,
                        Some(&project_root),
                        &script,
                        -1,
                        &stdout_text,
                        &message,
                    );
                    return Err(message);
                }
            };
            if count == 0 {
                break;
            }
            let line = String::from_utf8_lossy(trim_line_ending_bytes(&line_bytes)).to_string();
            handle_dev_script_output_line(&app, &script, &line);
            stdout_text.push_str(&line);
            stdout_text.push('\n');
        }
    }

    let stderr_text = if let Some(reader) = stderr_reader {
        match reader.join() {
            Ok(Ok(text)) => text,
            Ok(Err(error)) => {
                let _ = write_dev_script_log(
                    &app,
                    Some(&project_root),
                    &script,
                    -1,
                    &stdout_text,
                    &error,
                );
                return Err(error);
            }
            Err(_) => {
                let message = "Unable to join script error output reader".to_string();
                let _ = write_dev_script_log(
                    &app,
                    Some(&project_root),
                    &script,
                    -1,
                    &stdout_text,
                    &message,
                );
                return Err(message);
            }
        }
    } else {
        String::new()
    };

    let status = match child.wait() {
        Ok(status) => status,
        Err(error) => {
            let message = format!("Unable to wait for {}: {}", script_path.display(), error);
            let _ = write_dev_script_log(
                &app,
                Some(&project_root),
                &script,
                -1,
                &stdout_text,
                &format!("{}\n{}", stderr_text, message),
            );
            return Err(message);
        }
    };
    let code = status.code().unwrap_or(-1);
    write_dev_script_log(
        &app,
        Some(&project_root),
        &script,
        code,
        &stdout_text,
        &stderr_text,
    )?;
    if !status.success() {
        return Err(format!(
            "脚本执行失败，exit code {}\n{}\n{}",
            code, stdout_text, stderr_text
        ));
    }

    Ok(DevScriptResult {
        code,
        stdout: stdout_text,
        stderr: stderr_text,
    })
}

fn write_text_log_file(log_dir: &Path, file_name: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(log_dir).map_err(|error| {
        format!(
            "Unable to create log directory {}: {}",
            log_dir.display(),
            error
        )
    })?;
    let log_path = log_dir.join(file_name);
    fs::write(&log_path, content)
        .map_err(|error| format!("Unable to write log {}: {}", log_path.display(), error))
}

#[cfg(debug_assertions)]
fn trim_line_ending_bytes(bytes: &[u8]) -> &[u8] {
    let without_lf = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    without_lf.strip_suffix(b"\r").unwrap_or(without_lf)
}

#[cfg(debug_assertions)]
fn select_dev_powershell_command(where_output: Option<&str>) -> String {
    where_output
        .and_then(|output| {
            output
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "pwsh".to_string())
}

#[cfg(debug_assertions)]
fn dev_powershell_command() -> String {
    let output = Command::new("where")
        .arg("pwsh")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned());
    select_dev_powershell_command(output.as_deref())
}

#[cfg(all(debug_assertions, windows))]
fn terminate_dev_script_process_tree(process_id: u32) -> Result<(), String> {
    let output = Command::new("taskkill")
        .arg("/PID")
        .arg(process_id.to_string())
        .arg("/T")
        .arg("/F")
        .output()
        .map_err(|error| format!("无法暂停上传任务：{}", error))?;
    if output.status.success() {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        format!(
            "无法暂停上传任务，taskkill exit code {:?}",
            output.status.code()
        )
    } else {
        format!("无法暂停上传任务：{}", detail)
    })
}

#[cfg(all(debug_assertions, not(windows)))]
fn terminate_dev_script_process_tree(_process_id: u32) -> Result<(), String> {
    Err("当前平台不支持暂停开发上传任务。".to_string())
}

#[cfg(debug_assertions)]
fn dev_project_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Unable to resolve project root".to_string())
}

#[cfg(debug_assertions)]
fn is_safe_semver(version: &str) -> bool {
    if version.len() > 48 || version.is_empty() {
        return false;
    }

    let mut parts = version.splitn(2, '-');
    let core = parts.next().unwrap_or_default();
    let core_parts: Vec<&str> = core.split('.').collect();
    if core_parts.len() != 3
        || !core_parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return false;
    }

    parts
        .next()
        .map(|pre| {
            !pre.is_empty()
                && pre
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
        })
        .unwrap_or(true)
}

#[cfg(debug_assertions)]
fn is_safe_game_release_version(version: &str) -> bool {
    let value = version.trim().trim_start_matches(['V', 'v']);
    if value.is_empty() || value.len() > 64 {
        return false;
    }
    let mut parts = value.splitn(2, '-');
    let core = parts.next().unwrap_or_default();
    let core_parts: Vec<&str> = core.split('.').collect();
    if !(3..=4).contains(&core_parts.len())
        || !core_parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return false;
    }
    parts
        .next()
        .map(|suffix| {
            !suffix.is_empty()
                && suffix
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
        })
        .unwrap_or(true)
}

#[cfg(debug_assertions)]
fn build_dev_game_publish_arguments(
    platform: &str,
    channel: &str,
    game_directory: &Path,
    release_version: &str,
    release_title: &str,
    package_output_root: &Path,
) -> Result<Vec<String>, String> {
    if !matches!(platform, "Windows" | "Android") {
        return Err(format!("不支持的游戏平台：{}", platform));
    }
    if !matches!(channel, "Stable" | "Test") {
        return Err(format!("不支持的游戏发布频道：{}", channel));
    }
    let version = release_version.trim();
    if !is_safe_game_release_version(version) {
        return Err("游戏版本号格式不正确，请使用 V0.5.12 或 0.5.12.1-Beta。".into());
    }
    let title = release_title.trim();
    if title.is_empty() || title.chars().count() > 100 || title.contains(['\r', '\n']) {
        return Err("游戏发布标题不能为空、不能换行，且不能超过 100 个字符。".into());
    }
    Ok(vec![
        "-Platform".into(),
        platform.into(),
        "-Channel".into(),
        channel.into(),
        "-GameDirectory".into(),
        game_directory.to_string_lossy().into_owned(),
        "-ReleaseVersion".into(),
        version.into(),
        "-ReleaseTitle".into(),
        title.into(),
        "-PackageOutputRoot".into(),
        package_output_root.to_string_lossy().into_owned(),
    ])
}

#[cfg(debug_assertions)]
fn dev_launcher_version_path(project_root: &Path) -> PathBuf {
    project_root
        .join("Saved")
        .join("Launcher")
        .join("developer-version.json")
}

#[cfg(debug_assertions)]
fn read_dev_launcher_version(project_root: &Path) -> Result<Option<String>, String> {
    let path = dev_launcher_version_path(project_root);
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read {}: {}", path.display(), error))?;
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Unable to parse {}: {}", path.display(), error))?;
    let version = json
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match version {
        Some(value) if is_safe_semver(value) => Ok(Some(value.to_string())),
        Some(_) => Err(format!("{} contains an invalid version", path.display())),
        None => Ok(None),
    }
}

#[cfg(debug_assertions)]
fn write_dev_launcher_version(project_root: &Path, version: &str) -> Result<(), String> {
    let path = dev_launcher_version_path(project_root);
    let parent = path
        .parent()
        .ok_or_else(|| format!("Developer version path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create {}: {}", parent.display(), error))?;
    let text = serde_json::to_string_pretty(&serde_json::json!({ "version": version }))
        .map_err(|error| format!("Unable to serialize developer version: {}", error))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, format!("{}\n", text))
        .map_err(|error| format!("Unable to write {}: {}", temporary_path.display(), error))?;
    replace_file_atomic(&temporary_path, &path)
        .map_err(|error| format!("Unable to replace {}: {}", path.display(), error))
}

#[cfg(debug_assertions)]
fn build_remote_notice_payload(
    title: &str,
    content: &str,
    level: &str,
    enabled: bool,
    published_at: u64,
) -> Result<String, String> {
    let clean_title = title.trim();
    let clean_content = content.trim();
    if enabled && clean_title.is_empty() {
        return Err("公告标题不能为空。".into());
    }
    if enabled && clean_content.is_empty() {
        return Err("公告正文不能为空。".into());
    }
    if clean_title.chars().count() > 80 {
        return Err("公告标题不能超过 80 个字符。".into());
    }
    if clean_content.chars().count() > 2000 {
        return Err("公告正文不能超过 2000 个字符。".into());
    }
    if !matches!(level, "info" | "warning" | "error") {
        return Err("公告类型不正确。".into());
    }

    let payload = serde_json::json!({
        "schemaVersion": 1,
        "id": format!("notice-{}", published_at),
        "enabled": enabled,
        "level": level,
        "title": clean_title,
        "content": clean_content,
        "publishedAt": published_at,
    });
    serde_json::to_string_pretty(&payload)
        .map(|text| format!("{}\n", text))
        .map_err(|error| format!("Unable to serialize remote notice: {}", error))
}

#[cfg(debug_assertions)]
fn publish_remote_notice_blocking(project_root: &Path, payload: &str) -> Result<(), String> {
    let saved_dir = project_root.join("Saved").join("Launcher");
    fs::create_dir_all(&saved_dir)
        .map_err(|error| format!("Unable to create {}: {}", saved_dir.display(), error))?;
    let notice_path = saved_dir.join("remote-notice.json");
    let temporary_path = notice_path.with_extension("json.tmp");
    fs::write(&temporary_path, payload)
        .map_err(|error| format!("Unable to write {}: {}", temporary_path.display(), error))?;
    replace_file_atomic(&temporary_path, &notice_path)
        .map_err(|error| format!("Unable to replace {}: {}", notice_path.display(), error))?;

    let script_path = project_root
        .join("Scripts")
        .join("Publish-LauncherRemoteNotice.ps1");
    if !script_path.is_file() {
        return Err(format!("公告发布脚本不存在：{}", script_path.display()));
    }
    let shell = dev_powershell_command();
    let mut command = Command::new(&shell);
    command.arg("-NoProfile");
    if shell.eq_ignore_ascii_case("powershell")
        || shell.to_ascii_lowercase().ends_with("powershell.exe")
    {
        command.arg("-ExecutionPolicy").arg("Bypass");
    }
    let output = command
        .arg("-File")
        .arg(&script_path)
        .arg("-InputFile")
        .arg(&notice_path)
        .output()
        .map_err(|error| format!("Unable to run {}: {}", script_path.display(), error))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "公告发布失败，exit code {:?}: {}{}",
        output.status.code(),
        stderr,
        if stdout.is_empty() {
            String::new()
        } else {
            format!(" | {}", stdout)
        }
    ))
}

#[cfg(debug_assertions)]
fn handle_dev_script_output_line(app: &AppHandle, script: &str, line: &str) {
    const PREFIX: &str = "::progress";
    if line.starts_with(PREFIX) {
        let payload = &line[PREFIX.len()..];
        if let Ok(progress) = serde_json::from_str::<DevScriptProgress>(payload) {
            let _ = app.emit(
                "dev-script-progress",
                normalize_dev_script_progress(script, progress),
            );
        }
        return;
    }

    if let Some(progress) = classify_dev_build_output_line(script, line) {
        let _ = app.emit("dev-script-progress", progress);
    }
}

#[cfg(debug_assertions)]
fn normalize_dev_script_progress(
    script: &str,
    mut progress: DevScriptProgress,
) -> DevScriptProgress {
    let is_outer_publish_stage = match progress.stage.as_str() {
        "build" | "upload" | "server" => true,
        "manifest" => (progress.percent - 72.0).abs() < f64::EPSILON,
        "export" => (progress.percent - 78.0).abs() < f64::EPSILON,
        "completed" => progress.message.contains("发布完成"),
        _ => false,
    };
    if script == "publish" && !is_outer_publish_stage {
        progress.percent = 5.0 + progress.percent.clamp(0.0, 100.0) * 0.65;
        progress.stage = format!("build-{}", progress.stage);
    }
    progress
}

#[cfg(debug_assertions)]
fn classify_dev_build_output_line(script: &str, line: &str) -> Option<DevScriptProgress> {
    line.split('\r')
        .rev()
        .find_map(|segment| classify_dev_build_output_segment(script, segment))
}

#[cfg(debug_assertions)]
fn classify_dev_build_output_segment(script: &str, line: &str) -> Option<DevScriptProgress> {
    let trimmed = line.trim();
    let progress = if trimmed.contains("Running beforeBuildCommand") {
        DevScriptProgress {
            stage: "frontend-prepare".into(),
            percent: 17.0,
            message: "准备界面".into(),
        }
    } else if trimmed.contains("building for production") && trimmed.contains("vite") {
        DevScriptProgress {
            stage: "frontend-build".into(),
            percent: 18.0,
            message: "构建界面".into(),
        }
    } else if trimmed.contains("transforming...") {
        DevScriptProgress {
            stage: "frontend-transform".into(),
            percent: 20.0,
            message: "整理页面".into(),
        }
    } else if trimmed.contains("rendering chunks...") {
        DevScriptProgress {
            stage: "frontend-render".into(),
            percent: 23.0,
            message: "生成页面文件".into(),
        }
    } else if trimmed.contains("computing gzip size...") {
        DevScriptProgress {
            stage: "frontend-size".into(),
            percent: 25.0,
            message: "统计文件大小".into(),
        }
    } else if let Some((current, total, _)) = parse_cargo_build_progress(trimmed) {
        let ratio = if total > 0 {
            current as f64 / total as f64
        } else {
            0.0
        };
        DevScriptProgress {
            stage: "rust-compile".into(),
            percent: 27.0 + ratio.clamp(0.0, 1.0) * 21.0,
            message: format!("编译程序 {}/{}", current, total),
        }
    } else if trimmed.contains("Compiling ") {
        DevScriptProgress {
            stage: "rust-compile".into(),
            percent: 27.0,
            message: "准备程序模块".into(),
        }
    } else if trimmed.contains("Finished `release` profile") {
        DevScriptProgress {
            stage: "rust-finished".into(),
            percent: 48.0,
            message: "程序编译完成".into(),
        }
    } else if trimmed.contains("Patching ") && trimmed.contains("bundle type") {
        DevScriptProgress {
            stage: "bundle-patch".into(),
            percent: 52.0,
            message: "准备安装包".into(),
        }
    } else if trimmed.contains("Running makensis") {
        DevScriptProgress {
            stage: "nsis-bundle".into(),
            percent: 56.0,
            message: "生成安装包".into(),
        }
    } else if trimmed.contains("Finished 1 bundle") {
        DevScriptProgress {
            stage: "bundle-finished".into(),
            percent: 62.0,
            message: "安装包已生成".into(),
        }
    } else if trimmed.contains("Finished 1 updater signature") {
        DevScriptProgress {
            stage: "bundle-signature".into(),
            percent: 65.0,
            message: "生成更新签名".into(),
        }
    } else {
        return None;
    };

    Some(normalize_dev_script_progress(script, progress))
}

#[cfg(debug_assertions)]
fn parse_cargo_build_progress(line: &str) -> Option<(u64, u64, String)> {
    let marker = "Building [";
    let marker_index = line.find(marker)?;
    let after_marker = &line[marker_index + marker.len()..];
    let bracket_end = after_marker.find(']')?;
    let remainder = after_marker[bracket_end + 1..].trim();
    let (fraction, target) = remainder.split_once(':')?;
    let (current, total) = fraction.trim().split_once('/')?;
    Some((
        current.trim().parse().ok()?,
        total.trim().parse().ok()?,
        target.trim().to_string(),
    ))
}

fn validate_install_state(install_path: &str, state: &str) -> Result<bool, String> {
    let install_dir = PathBuf::from(install_path);
    if state.eq_ignore_ascii_case("repairable") {
        return Ok(load_manifest_entry_map(&install_dir).is_ok());
    }
    if state.eq_ignore_ascii_case("ready") {
        return Ok(install_dir.join("CrossingVoid.version.json").is_file()
            && install_dir.join("CrossingVoid.manifest.json").is_file()
            && install_dir.join("CrossingVoid.exe").is_file());
    }

    let state_path = download_state_file_path(install_path);
    let download_dir = install_dir.join("_download");
    if !state_path.is_file() || !download_dir.is_dir() {
        return Ok(false);
    }
    let state_text = fs::read_to_string(&state_path).map_err(|error| {
        format!(
            "Unable to read download state {}: {}",
            state_path.display(),
            error
        )
    })?;
    let state_file = serde_json::from_str::<DownloadStateFile>(&state_text).map_err(|error| {
        format!(
            "Unable to parse download state {}: {}",
            state_path.display(),
            error
        )
    })?;
    let expected_total = state_file.total_bytes;

    let entries = fs::read_dir(&download_dir).map_err(|error| {
        format!(
            "Unable to inspect download directory {}: {}",
            download_dir.display(),
            error
        )
    })?;
    let mut part_bytes = 0u64;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Unable to read download directory entry: {}", error))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let size = fs::metadata(&path)
            .map_err(|error| {
                format!(
                    "Unable to inspect download artifact {}: {}",
                    path.display(),
                    error
                )
            })?
            .len();
        if name.eq_ignore_ascii_case("CrossingVoid.zip")
            && archive_has_expected_size(&path, expected_total)
        {
            return Ok(true);
        }
        if name.ends_with(".part001") || name.contains(".zip.part") {
            part_bytes = part_bytes.saturating_add(size);
        }
    }

    if expected_total > 0 && part_bytes >= expected_total {
        return Ok(true);
    }

    Ok(false)
}

fn delete_installed_game_internal(app: &AppHandle, install_dir: &Path) -> Result<(), String> {
    if !install_dir.exists() {
        return Ok(());
    }
    if !install_dir.is_dir() {
        return Err(format!(
            "Game install path is not a directory: {}",
            install_dir.display()
        ));
    }

    let target = install_dir.canonicalize().map_err(|error| {
        format!(
            "Unable to resolve game install path {}: {}",
            install_dir.display(),
            error
        )
    })?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !name.eq_ignore_ascii_case("CrossingVoid") {
        return Err(format!(
            "Refuse to delete non-game directory: {}",
            target.display()
        ));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Ok(current_exe) = current_exe.canonicalize() {
            if current_exe.starts_with(&target) {
                return Err(format!(
                    "Refuse to delete launcher directory: {}",
                    target.display()
                ));
            }
            if let Some(current_exe_dir) = current_exe.parent() {
                if target == current_exe_dir {
                    return Err(format!(
                        "Refuse to delete launcher executable directory: {}",
                        target.display()
                    ));
                }
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Ok(resource_dir) = resource_dir.canonicalize() {
            if resource_dir.starts_with(&target) || target.starts_with(&resource_dir) {
                return Err(format!(
                    "Refuse to delete launcher resource directory: {}",
                    target.display()
                ));
            }
        }
    }

    fs::remove_dir_all(&target).map_err(|error| {
        format!(
            "Unable to delete game directory {}: {}",
            target.display(),
            error
        )
    })
}

#[cfg(windows)]
fn create_game_desktop_shortcut(install_dir: &Path) -> Result<(), String> {
    let exe_path = install_dir.join("CrossingVoid.exe");
    if !exe_path.is_file() {
        return Err(format!("Game executable not found: {}", exe_path.display()));
    }
    let script_path = std::env::temp_dir().join("crossingvoid_create_game_shortcut.ps1");
    let script = format!(
        r#"$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('DesktopDirectory')
$Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop '零境交错：空界幻境.lnk'))
$Shortcut.TargetPath = @'
{}
'@
$Shortcut.WorkingDirectory = @'
{}
'@
$Shortcut.IconLocation = @'
{},0
'@
$Shortcut.Save()
"#,
        exe_path.display(),
        install_dir.display(),
        exe_path.display()
    );
    fs::write(&script_path, script).map_err(|error| {
        format!(
            "Unable to write shortcut script {}: {}",
            script_path.display(),
            error
        )
    })?;

    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path.to_str().ok_or_else(|| {
                format!(
                    "Shortcut script path is not valid Unicode: {}",
                    script_path.display()
                )
            })?,
        ])
        .status()
        .map_err(|error| format!("Unable to run shortcut script: {}", error))?;
    if !status.success() {
        return Err(format!(
            "Shortcut script failed with exit code {:?}",
            status.code()
        ));
    }

    Ok(())
}

#[cfg(not(windows))]
fn create_game_desktop_shortcut(_install_dir: &Path) -> Result<(), String> {
    Ok(())
}

fn launch_game_internal(
    app: AppHandle,
    install_dir: &Path,
    use_dx11: bool,
    exit_launcher: bool,
) -> Result<LaunchGameResult, String> {
    let exe_path = install_dir.join("CrossingVoid.exe");
    if !exe_path.is_file() {
        return Err(format!("Game executable not found: {}", exe_path.display()));
    }
    if is_game_process_running() {
        if exit_launcher {
            app.exit(0);
        }
        return Ok(LaunchGameResult {
            already_running: true,
            process_id: 0,
        });
    }

    let mut command = Command::new(&exe_path);
    command.current_dir(install_dir);
    if use_dx11 {
        command.args(["-d3d11", "-dx11"]);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to launch game {}: {}", exe_path.display(), error))?;
    let process_id = child.id();
    std::thread::sleep(Duration::from_secs(5));
    match child.try_wait() {
        Ok(Some(status)) => {
            return Err(format!(
                "GAME_EXITED_EARLY:{}",
                status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ));
        }
        Ok(None) => {}
        Err(error) => {
            return Err(format!(
                "Unable to inspect game process after launch: {}",
                error
            ))
        }
    }
    if exit_launcher {
        app.exit(0);
        return Ok(LaunchGameResult {
            already_running: false,
            process_id,
        });
    }
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let _ = app.emit("game-process-exited", GameProcessExited { code });
    });
    Ok(LaunchGameResult {
        already_running: false,
        process_id,
    })
}

#[cfg(windows)]
fn is_game_process_running() -> bool {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }

        let mut entry = std::mem::zeroed::<PROCESSENTRY32W>();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = Process32FirstW(snapshot, &mut entry) != 0;
        while found {
            let name_end = entry
                .szExeFile
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(entry.szExeFile.len());
            let exe_name = String::from_utf16_lossy(&entry.szExeFile[..name_end]);
            if exe_name.eq_ignore_ascii_case("CrossingVoid.exe") {
                let _ = CloseHandle(snapshot);
                return true;
            }
            found = Process32NextW(snapshot, &mut entry) != 0;
        }

        let _ = CloseHandle(snapshot);
        false
    }
}

#[cfg(not(windows))]
fn is_game_process_running() -> bool {
    false
}

#[cfg(windows)]
fn open_folder(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder not found: {}", path.display()));
    }
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Unable to open folder {}: {}", path.display(), error))?;
    Ok(())
}

fn install_vc_redist_internal(app: Option<&AppHandle>, install_dir: &Path) -> Result<(), String> {
    let bundled_redist = app.and_then(|handle| {
        handle
            .path()
            .resolve(
                "resources/VC_redist.x64.exe",
                tauri::path::BaseDirectory::Resource,
            )
            .ok()
    });
    let game_redist = install_dir
        .join("Engine")
        .join("Extras")
        .join("Redist")
        .join("en-us")
        .join("vc_redist.x64.exe");
    let redist_path = bundled_redist
        .filter(|path| path.is_file())
        .or_else(|| {
            if game_redist.is_file() {
                Some(game_redist)
            } else {
                None
            }
        })
        .ok_or_else(|| "VC++ redistributable installer was not found".to_string())?;

    let status = Command::new(&redist_path)
        .args(["/install", "/quiet", "/norestart"])
        .status()
        .map_err(|error| {
            format!(
                "Unable to run VC++ redistributable {}: {}",
                redist_path.display(),
                error
            )
        })?;
    if !status.success() {
        let code = status.code().unwrap_or(-1);
        if code == 3010 || code == 1638 {
            return Ok(());
        }
        return Err(format!(
            "VC++ redistributable failed with exit code {:?}",
            status.code()
        ));
    }

    Ok(())
}

#[cfg(windows)]
fn uninstall_launcher_internal() -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
$appNames = @('零境启动器', 'CrossingVoidinitiator-PC')
$keys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entry = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object {
    $displayName = $_.DisplayName
    $appNames -contains $displayName -or
      $displayName -like '*零境启动器*' -or
      $displayName -like '*CrossingVoidinitiator-PC*'
  } |
  Select-Object -First 1
if (-not $entry) {
  throw "没有找到启动器卸载信息：零境启动器"
}
$command = $entry.QuietUninstallString
if ([string]::IsNullOrWhiteSpace($command)) {
  $command = $entry.UninstallString
}
if ([string]::IsNullOrWhiteSpace($command)) {
  throw "启动器卸载命令为空：零境启动器"
}
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $command) -WindowStyle Hidden
"#;
    let script_path = std::env::temp_dir().join("crossingvoid_uninstall_launcher.ps1");
    fs::write(&script_path, script).map_err(|error| {
        format!(
            "Unable to write launcher uninstall script {}: {}",
            script_path.display(),
            error
        )
    })?;

    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path.to_str().ok_or_else(|| {
                format!(
                    "Uninstall script path is not valid Unicode: {}",
                    script_path.display()
                )
            })?,
        ])
        .status()
        .map_err(|error| format!("Unable to run launcher uninstall script: {}", error))?;
    if !status.success() {
        return Err(format!(
            "Launcher uninstall script failed with exit code {:?}",
            status.code()
        ));
    }

    Ok(())
}

#[cfg(not(windows))]
fn uninstall_launcher_internal() -> Result<(), String> {
    Err("Launcher uninstall is only implemented on Windows".into())
}

#[cfg(not(windows))]
fn open_folder(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder not found: {}", path.display()));
    }
    Ok(())
}

#[cfg(windows)]
fn platform_available_space(path: &str) -> Result<u64, String> {
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let root = if path.len() >= 2 && path.as_bytes()[1] == b':' {
        format!("{}\\", &path[..2])
    } else {
        path.to_string()
    };
    let wide: Vec<u16> = OsStr::new(&root)
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let mut free_bytes = 0u64;

    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(format!("Unable to query available space for {}", root));
    }

    Ok(free_bytes)
}

#[cfg(not(windows))]
fn platform_available_space(_path: &str) -> Result<u64, String> {
    Err("Disk space query is only implemented on Windows".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let mut builder = TrayIconBuilder::with_id("main")
                .tooltip("零境交错:空界幻境")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }
            let tray = builder
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            is_debug_build,
            get_available_space,
            get_game_migration_size,
            fetch_remote_text,
            fetch_github_release_asset_text,
            get_github_network_status,
            post_remote_json,
            pause_game_download,
            cancel_game_operation,
            set_download_speed_limit,
            read_download_state_file,
            write_download_state_file,
            clear_download_state_file,
            clear_game_download_artifacts,
            validate_game_install_state,
            find_game_installation,
            move_game_installation,
            migrate_mislabeled_game_version,
            read_game_version_file,
            open_game_folder,
            delete_installed_game,
            uninstall_launcher,
            is_game_running,
            exit_launcher,
            launch_game,
            create_game_desktop_shortcut_now,
            install_vc_redist,
            repair_game_from_archive,
            verify_game_manifest,
            check_game_manifest_files,
            validate_downloaded_archive_state,
            download_game_archive,
            import_game_chunks,
            install_downloaded_game_archive,
            dev_get_launcher_version,
            dev_set_launcher_version,
            dev_publish_remote_notice,
            dev_run_launcher_script,
            dev_pause_script,
            open_launcher_log_folder,
            write_launcher_error_log,
            dev_open_project_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_archive_chunk(index: u32, file_name: &str) -> ArchiveChunk {
        ArchiveChunk {
            index: Some(index),
            file_name: file_name.to_string(),
            url: String::new(),
            sha256: None,
            size_bytes: None,
        }
    }

    #[test]
    fn imported_chunk_resolves_manifest_name_and_github_numeric_alias() {
        let chunks = vec![
            test_archive_chunk(1, "CrossingVoid电脑端.碎片001"),
            test_archive_chunk(2, "CrossingVoid电脑端.碎片002"),
        ];

        assert_eq!(
            resolve_imported_chunk("CrossingVoid电脑端.碎片001", &chunks)
                .map(|chunk| chunk.index),
            Some(Some(1))
        );
        assert_eq!(
            resolve_imported_chunk("CrossingVoid.002", &chunks).map(|chunk| chunk.index),
            Some(Some(2))
        );
    }

    #[test]
    fn imported_chunk_rejects_unrelated_numeric_files() {
        let chunks = vec![test_archive_chunk(1, "CrossingVoid电脑端.碎片001")];

        assert!(resolve_imported_chunk("OtherGame.001", &chunks).is_none());
        assert!(resolve_imported_chunk("CrossingVoid.999", &chunks).is_none());
        assert!(resolve_imported_chunk("CrossingVoid.exe", &chunks).is_none());
    }

    #[test]
    fn cancelling_download_removes_cache_without_touching_installed_game_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-cancel-download-{}-{}",
            std::process::id(),
            unique
        ));
        let download_dir = root.join("_download");
        fs::create_dir_all(&download_dir).expect("create download cache");
        fs::write(root.join("CrossingVoid.exe"), b"installed").expect("write installed game file");
        fs::write(download_dir.join("CrossingVoid.001"), b"partial").expect("write partial chunk");
        fs::write(download_dir.join("download-state.json"), b"{}").expect("write download state");

        clear_game_download_artifacts(root.to_string_lossy().into_owned())
            .expect("clear game download artifacts");

        assert!(!download_dir.exists());
        assert_eq!(
            fs::read(root.join("CrossingVoid.exe")).expect("read installed game file"),
            b"installed"
        );
        fs::remove_dir_all(root).expect("remove cancel test directory");
    }

    #[test]
    fn imported_chunk_folder_scan_finds_nested_manifest_and_github_names() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-chunk-folder-{}-{}",
            std::process::id(),
            unique
        ));
        let nested = root.join("网盘下载");
        fs::create_dir_all(&nested).expect("create nested chunk directory");
        fs::write(root.join("说明.txt"), "ignore").expect("write unrelated file");
        fs::write(root.join("CrossingVoid电脑端.碎片001"), "one")
            .expect("write manifest chunk");
        fs::write(nested.join("CrossingVoid.002"), "two").expect("write github chunk");

        let chunks = vec![
            test_archive_chunk(1, "CrossingVoid电脑端.碎片001"),
            test_archive_chunk(2, "CrossingVoid电脑端.碎片002"),
        ];
        let found = collect_imported_chunk_files(&root, &chunks).expect("scan chunk folder");

        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|path| path.ends_with("CrossingVoid电脑端.碎片001")));
        assert!(found.iter().any(|path| path.ends_with("CrossingVoid.002")));
        fs::remove_dir_all(root).expect("remove chunk folder");
    }

    #[test]
    fn archive_chunk_accepts_missing_url_for_local_installation() {
        let chunk: ArchiveChunk = serde_json::from_value(serde_json::json!({
            "index": 1,
            "fileName": "CrossingVoid电脑端.碎片001",
            "sha256": "abc",
            "sizeBytes": 123
        }))
        .expect("deserialize local chunk without url");

        assert_eq!(chunk.url, "");
    }

    #[test]
    fn launcher_error_log_file_name_keeps_chinese_title_and_removes_invalid_characters() {
        assert_eq!(
            launcher_error_log_file_name("安装游戏/分片失败:参数错误", "20260820-130500-123"),
            "错误-安装游戏_分片失败_参数错误-20260820-130500-123.log"
        );
    }

    #[test]
    fn developer_version_is_saved_without_touching_watched_manifests() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-version-{}-{}",
            std::process::id(),
            unique
        ));
        let tauri_dir = root.join("src-tauri");
        fs::create_dir_all(&tauri_dir).expect("create test project");
        let tauri_config = tauri_dir.join("tauri.conf.json");
        let package_json = root.join("package.json");
        fs::write(&tauri_config, "{\"version\":\"1.0.3\"}\n").expect("write tauri config");
        fs::write(&package_json, "{\"version\":\"1.0.3\"}\n").expect("write package json");

        write_dev_launcher_version(&root, "1.0.4").expect("save developer version");

        assert_eq!(
            read_dev_launcher_version(&root).expect("read developer version"),
            Some("1.0.4".to_string())
        );
        assert_eq!(
            fs::read_to_string(&tauri_config).expect("read tauri config"),
            "{\"version\":\"1.0.3\"}\n"
        );
        assert_eq!(
            fs::read_to_string(&package_json).expect("read package json"),
            "{\"version\":\"1.0.3\"}\n"
        );

        fs::remove_dir_all(root).expect("remove test project");
    }

    #[test]
    fn cargo_build_output_reports_real_compile_progress() {
        let progress = classify_dev_build_output_line(
            "build",
            "    Building [=======================> ] 541/553: rustls\r    Building [=======================> ] 542/553: ring(build)",
        )
        .expect("cargo build line should produce progress");

        assert_eq!(progress.stage, "rust-compile");
        assert!(progress.percent > 45.0 && progress.percent < 48.0);
        assert_eq!(progress.message, "编译程序 542/553");
    }

    #[test]
    fn bundle_output_reports_installer_generation() {
        let progress = classify_dev_build_output_line(
            "build",
            "Running makensis to produce D:\\output\\launcher.exe",
        )
        .expect("makensis line should produce progress");

        assert_eq!(progress.stage, "nsis-bundle");
        assert_eq!(progress.percent, 56.0);
    }

    #[test]
    fn publish_maps_nested_build_manifest_before_upload_stages() {
        let progress = normalize_dev_script_progress(
            "publish",
            DevScriptProgress {
                stage: "manifest".into(),
                percent: 88.0,
                message: "生成启动器更新清单".into(),
            },
        );

        assert_eq!(progress.stage, "build-manifest");
        assert!(progress.percent > 62.0 && progress.percent < 63.0);
    }

    #[test]
    fn game_publish_arguments_preserve_platform_path_and_version() {
        let args = build_dev_game_publish_arguments(
            "Windows",
            "Test",
            Path::new(r"D:\TFAC-hz64\CrossingVoid"),
            "V0.5.14",
            "零境交错：空界幻境更新包",
            Path::new(r"D:\Packages"),
        )
        .expect("build game publish arguments");

        assert_eq!(args[0..2], ["-Platform", "Windows"]);
        assert!(args.windows(2).any(|pair| pair == ["-Channel", "Test"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-GameDirectory", r"D:\TFAC-hz64\CrossingVoid"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-ReleaseVersion", "V0.5.14"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-PackageOutputRoot", r"D:\Packages"]));
    }

    #[test]
    fn developer_powershell_fallback_stays_on_pwsh() {
        assert_eq!(select_dev_powershell_command(None), "pwsh");
        assert_eq!(
            select_dev_powershell_command(Some("C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n")),
            r"C:\Program Files\PowerShell\7\pwsh.exe"
        );
    }

    #[test]
    fn game_publish_arguments_reject_invalid_platform_or_version() {
        assert!(build_dev_game_publish_arguments(
            "Linux",
            "Stable",
            Path::new(r"D:\Game"),
            "V0.5.14",
            "更新包",
            Path::new(r"D:\Packages"),
        )
        .is_err());
        assert!(build_dev_game_publish_arguments(
            "Android",
            "Stable",
            Path::new(r"D:\Game"),
            "next",
            "更新包",
            Path::new(r"D:\Packages"),
        )
        .is_err());
        assert!(build_dev_game_publish_arguments(
            "Windows",
            "Preview",
            Path::new(r"D:\Game"),
            "V0.5.14",
            "更新包",
            Path::new(r"D:\Packages"),
        )
        .is_err());
    }

    #[test]
    fn remote_notice_payload_requires_title_and_content_when_enabled() {
        assert!(build_remote_notice_payload("", "维护通知", "warning", true, 100).is_err());
        assert!(build_remote_notice_payload("服务器通知", "", "warning", true, 100).is_err());
    }

    #[test]
    fn remote_notice_payload_is_stable_and_can_be_disabled() {
        let enabled =
            build_remote_notice_payload("更新异常", "请手动下载安装包。", "error", true, 123456)
                .expect("build enabled notice");
        let enabled_json: serde_json::Value =
            serde_json::from_str(&enabled).expect("parse enabled notice");
        assert_eq!(enabled_json["schemaVersion"], 1);
        assert_eq!(enabled_json["id"], "notice-123456");
        assert_eq!(enabled_json["enabled"], true);
        assert_eq!(enabled_json["level"], "error");
        assert_eq!(enabled_json["title"], "更新异常");
        assert_eq!(enabled_json["content"], "请手动下载安装包。");
        assert_eq!(enabled_json["publishedAt"], 123456);

        let disabled = build_remote_notice_payload("", "", "info", false, 123457)
            .expect("build disabled notice");
        let disabled_json: serde_json::Value =
            serde_json::from_str(&disabled).expect("parse disabled notice");
        assert_eq!(disabled_json["enabled"], false);
    }

    #[test]
    fn ready_install_requires_version_manifest_and_executable() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-ready-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&root).expect("create install directory");
        fs::write(root.join("CrossingVoid.version.json"), "{}").expect("write version marker");

        assert!(
            !validate_install_state(root.to_string_lossy().as_ref(), "ready")
                .expect("validate partial install")
        );
        assert!(
            !validate_install_state(root.to_string_lossy().as_ref(), "repairable")
                .expect("validate install without manifest")
        );

        fs::write(root.join("CrossingVoid.manifest.json"), "not-json")
            .expect("write invalid manifest");
        assert!(
            !validate_install_state(root.to_string_lossy().as_ref(), "repairable")
                .expect("reject invalid repair manifest")
        );

        fs::write(root.join("CrossingVoid.manifest.json"), "{\"files\":[]}")
            .expect("write manifest");
        assert!(
            validate_install_state(root.to_string_lossy().as_ref(), "repairable")
                .expect("validate repairable install")
        );
        fs::write(root.join("CrossingVoid.exe"), []).expect("write executable");
        assert!(
            validate_install_state(root.to_string_lossy().as_ref(), "ready")
                .expect("validate complete install")
        );

        fs::remove_dir_all(root).expect("remove test install");
    }

    #[test]
    fn find_game_installation_scans_below_selected_directory() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-relocate-{}-{}",
            std::process::id(),
            unique
        ));
        let incomplete = root.join("old");
        let game = root.join("release").join("CrossingVoid");
        fs::create_dir_all(&incomplete).expect("create incomplete directory");
        fs::create_dir_all(&game).expect("create nested game directory");
        fs::write(incomplete.join("CrossingVoid.exe"), []).expect("write incomplete executable");
        fs::write(game.join("CrossingVoid.version.json"), "{}").expect("write version marker");
        fs::write(game.join("CrossingVoid.manifest.json"), "{\"files\":[]}").expect("write manifest");
        fs::write(game.join("CrossingVoid.exe"), []).expect("write executable");

        assert_eq!(
            find_game_installation_internal(&root).expect("scan selected directory"),
            Some(game)
        );
        fs::remove_dir_all(root).expect("remove relocate test directory");
    }

    #[test]
    fn move_game_installation_moves_complete_game_to_new_install_base() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-move-{}-{}",
            std::process::id(),
            unique
        ));
        let source_container = root.join("old").join("TFAC-hz64");
        let source = source_container.join("CrossingVoid");
        let destination_base = root.join("new");
        fs::create_dir_all(&source).expect("create source game directory");
        fs::create_dir_all(&destination_base).expect("create destination base directory");
        fs::write(source.join("CrossingVoid.version.json"), "{}").expect("write version marker");
        fs::write(source.join("CrossingVoid.manifest.json"), "{\"files\":[]}").expect("write manifest");
        fs::write(source.join("CrossingVoid.exe"), []).expect("write executable");
        fs::write(source.join("saved.dat"), "game data").expect("write game data");
        fs::write(source_container.join("platform-extra.dat"), "extra data")
            .expect("write container extra file");

        let destination = move_game_installation_internal(&source, &destination_base)
            .expect("move complete game");

        assert_eq!(
            destination,
            destination_base.join("TFAC-hz64").join("CrossingVoid")
        );
        assert!(!source_container.exists());
        assert_eq!(fs::read_to_string(destination.join("saved.dat")).expect("read moved file"), "game data");
        assert_eq!(
            fs::read_to_string(destination_base.join("TFAC-hz64").join("platform-extra.dat"))
                .expect("read moved container extra file"),
            "extra data"
        );
        assert!(validate_install_state(destination.to_string_lossy().as_ref(), "ready").expect("validate moved game"));

        fs::remove_dir_all(root).expect("remove move test directory");
    }

    #[test]
    fn mislabeled_windows_release_is_migrated_without_redownloading_game_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-version-migration-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&root).expect("create migration test directory");
        let version_path = root.join("CrossingVoid.version.json");
        let manifest_path = root.join("CrossingVoid.manifest.json");
        fs::write(
            &version_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "productKey": "crossingvoid-game",
                "runtime": "Windows",
                "version": "V0.5.13",
                "title": "V0.5.13测试下载",
                "archiveFileName": "CrossingVoid.zip"
            }))
            .expect("serialize version marker"),
        )
        .expect("write version marker");
        let old_hash = calculate_file_sha256(&version_path).expect("hash old version marker");
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "productKey": "crossingvoid-game",
                "runtime": "Windows",
                "version": "V0.5.13",
                "title": "V0.5.13测试下载",
                "files": [{
                    "path": "CrossingVoid.version.json",
                    "sizeBytes": fs::metadata(&version_path).expect("version metadata").len(),
                    "sha256": old_hash,
                    "lastWriteUtc": "2026-06-27T18:26:33Z"
                }]
            }))
            .expect("serialize file manifest"),
        )
        .expect("write file manifest");

        assert!(migrate_mislabeled_game_version_internal(&root).expect("migrate release label"));

        let version: serde_json::Value = serde_json::from_slice(
            &fs::read(&version_path).expect("read migrated version marker"),
        )
        .expect("parse migrated version marker");
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(&manifest_path).expect("read migrated file manifest"),
        )
        .expect("parse migrated file manifest");
        assert_eq!(version["version"], "V0.5.12");
        assert_eq!(manifest["version"], "V0.5.12");
        assert_eq!(
            manifest["files"][0]["sha256"],
            calculate_file_sha256(&version_path).expect("hash migrated version marker")
        );
        assert_eq!(
            manifest["files"][0]["sizeBytes"],
            fs::metadata(&version_path).expect("migrated version metadata").len()
        );

        assert!(!migrate_mislabeled_game_version_internal(&root).expect("migration is idempotent"));
        fs::remove_dir_all(root).expect("remove migration test directory");
    }

    #[test]
    fn same_size_file_with_wrong_hash_requires_repair() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-repair-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&root).expect("create repair test directory");
        let target = root.join("payload.bin");
        fs::write(&target, b"wrong").expect("write damaged payload");
        let expected_hash = format!("{:x}", Sha256::digest(b"right"));

        assert!(file_needs_manifest_repair(&target, 5, &expected_hash)
            .expect("inspect damaged payload"));

        fs::write(&target, b"right").expect("write correct payload");
        assert!(!file_needs_manifest_repair(&target, 5, &expected_hash)
            .expect("inspect correct payload"));

        fs::remove_dir_all(root).expect("remove repair test directory");
    }

    #[test]
    fn quick_manifest_check_detects_missing_and_wrong_size_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cv-launcher-quick-check-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(root.join("Content")).expect("create quick check directory");
        fs::write(root.join("Content").join("present.bin"), b"ready")
            .expect("write present payload");
        let manifest = serde_json::json!({
            "files": [
                { "path": "Content/present.bin", "sizeBytes": 5, "sha256": "" },
                { "path": "Content/missing.bin", "sizeBytes": 5, "sha256": "" }
            ]
        });
        fs::write(
            root.join("CrossingVoid.manifest.json"),
            serde_json::to_vec(&manifest).expect("serialize quick check manifest"),
        )
        .expect("write quick check manifest");

        let missing = check_game_manifest_files_internal(root.to_string_lossy().as_ref())
            .expect("check missing payload");
        assert_eq!(missing.checked_files, 2);
        assert_eq!(missing.invalid_files, 1);
        assert_eq!(missing.missing_files, 1);

        fs::write(root.join("Content").join("missing.bin"), b"bad")
            .expect("write wrong-size payload");
        let wrong_size = check_game_manifest_files_internal(root.to_string_lossy().as_ref())
            .expect("check wrong-size payload");
        assert_eq!(wrong_size.invalid_files, 1);
        assert_eq!(wrong_size.missing_files, 0);

        fs::remove_dir_all(root).expect("remove quick check directory");
    }

    #[test]
    fn repair_progress_percent_prefers_bytes_when_available() {
        assert_eq!(repair_progress_percent(1, 4, 500, 1_000), 50.0);
        assert_eq!(repair_progress_percent(1, 4, 0, 0), 25.0);
    }

    #[test]
    fn github_release_asset_api_requests_binary_content() {
        assert!(is_github_release_asset_api_url(
            "https://api.github.com/repos/kirito0000001/CrossingVoid/releases/assets/459550183"
        ));
        assert!(!is_github_release_asset_api_url(
            "https://github.com/kirito0000001/CrossingVoid/releases/download/V0.5.13/CrossingVoid.zip.part001"
        ));
    }

    #[test]
    fn normalizes_windows_proxy_server_for_github_requests() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_string())
        );
        assert_eq!(
            normalize_proxy_url("http=127.0.0.1:7890;https=127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_string())
        );
    }

    #[test]
    #[ignore = "live GitHub release asset contract"]
    fn github_release_asset_api_reaches_binary_cdn() {
        let url =
            "https://api.github.com/repos/kirito0000001/CrossingVoid/releases/assets/459550183";
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(12))
            .timeout_read(Duration::from_secs(30))
            .build();
        let response = configure_download_request(agent.get(url), url)
            .set("Range", "bytes=0-1023")
            .call()
            .expect("request GitHub release asset");

        assert_eq!(response.status(), 206);
        assert_eq!(response.header("Content-Length"), Some("1024"));
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(1024)
            .read_to_end(&mut bytes)
            .expect("read binary sample");
        assert_eq!(bytes.len(), 1024);
    }
}
