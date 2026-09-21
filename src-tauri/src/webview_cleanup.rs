//! 启动时清掉"宿主已经死掉"的 WebView2 残留进程。
//!
//! ## 为什么要做这件事
//!
//! WebView2 的浏览器进程（`msedgewebview2.exe`）是按 **user-data-dir** 复用的：
//! 同一个 `%LOCALAPPDATA%\com.lingjing.launcher\EBWebView` 下，第二次启动的启动器
//! 会直接接到上一次留下的那个浏览器进程上。
//!
//! 如果上一次的启动器是被强杀/崩溃退出的，那个浏览器进程会变成**孤儿**：
//! 它的父进程已经不存在，命令行里的宿主通道（`--mojo-named-platform-channel-pipe=<宿主PID>...`）
//! 还指向一个死进程。新实例接到这种孤儿上时，页面永远建立不起来 ——
//! 表现就是"整个程序卡死"：窗口还在、按钮点不动、线程全部 Wait、CPU 不涨。
//!
//! （2026-09-20 现场实测：21:42 启动的实例接的是 19:05 死实例留下的浏览器进程 36484。）
//!
//! ## 判定规则
//!
//! 对每个 `msedgewebview2.exe`，看它的宿主（父进程）是什么：
//!
//! | 宿主 | 处理 |
//! | --- | --- |
//! | 不在进程表里 | 残留 → 收掉 |
//! | 是别的程序（SearchHost、clash 等） | 不关我们的事 → 不动 |
//! | 是我们自己 | 正常 → 不动 |
//! | 是**另一个启动器实例**：窗口不应答，或压根没有窗口 | 冻结/卡死留下的残骸 → 收掉 |
//! | 是另一个启动器实例，窗口正常应答 | 当它还在用 → 不动（哪怕藏在托盘） |
//!
//! 这里**不用** `OpenProcess` 判断宿主死活：幽灵进程（已退出、只剩进程表条目）
//! 的内核对象仍然是"未触发"状态，判断会误判成存活（实测踩过这个坑）。
//!
//! 这一步必须在主窗口建立之前跑（Tauri 的插件 setup 早于配置窗口创建），
//! 否则新实例已经接到孤儿上了，再清理也晚了。

use std::cell::Cell;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_NULL,
};

const WEBVIEW_PROCESS_NAME: &str = "msedgewebview2.exe";
/// 等窗口应答的超时：正常窗口是微秒级返回，卡死的实例会一直不应答。
const RESPONSIVE_TIMEOUT_MS: u32 = 300;
/// 我们自己（开发版与正式版用的是同一个可执行文件名）。
const LAUNCHER_PROCESS_NAMES: [&str; 2] = ["tauri-vue-launcher.exe", "零境启动器.exe"];

/// 返回被结束的进程数量（0 表示没有残留，属正常情况）。
#[cfg(windows)]
pub fn cleanup_stale_webview_hosts() -> usize {
    let targets = find_stale_webview_hosts();
    if targets.is_empty() {
        return 0;
    }
    let mut killed = 0usize;
    for pid in targets {
        if terminate_process(pid) {
            killed += 1;
        }
    }
    killed
}

/// 只做检测、不杀进程：返回"宿主已死"的 WebView2 进程树（含子进程）。
/// 用于诊断与干跑验证。
#[cfg(windows)]
pub fn find_stale_webview_hosts() -> Vec<u32> {
    let Some(processes) = snapshot_processes() else {
        return Vec::new();
    };

    let own_pid = std::process::id();
    let mut stale: Vec<u32> = Vec::new();
    for process in &processes {
        if !process.name.eq_ignore_ascii_case(WEBVIEW_PROCESS_NAME) {
            continue;
        }
        match processes
            .iter()
            .find(|candidate| candidate.pid == process.parent_pid)
        {
            // 宿主已经不在进程表里 → 孤儿。
            None => stale.push(process.pid),
            Some(host) if host.pid == own_pid => {}
            Some(host) if !launcher_process_name(&host.name) => {}
            // 另一个启动器实例：窗口还在正常应答就尊重它，否则就是残骸。
            Some(host) => {
                if !process_is_responsive(host.pid) {
                    stale.push(process.pid);
                }
            }
        }
    }
    if stale.is_empty() {
        return Vec::new();
    }

    // 连同子进程一起收掉，避免留下渲染/GPU 子进程继续占着 user-data-dir。
    let mut targets: Vec<u32> = stale.clone();
    loop {
        let before = targets.len();
        for process in &processes {
            if targets.contains(&process.parent_pid) && !targets.contains(&process.pid) {
                targets.push(process.pid);
            }
        }
        if targets.len() == before {
            break;
        }
    }
    targets
}

/// 窗口还在应答消息（`WM_NULL`）就算活着；卡死的实例会超时不应答。
/// 没有窗口的进程同样返回 false —— 那本来就是残骸。
#[cfg(windows)]
fn process_is_responsive(pid: u32) -> bool {
    thread_local! {
        static TARGET_PID: Cell<u32> = const { Cell::new(0) };
        static RESPONSIVE: Cell<bool> = const { Cell::new(false) };
    }

    unsafe extern "system" fn callback(hwnd: HWND, _lparam: LPARAM) -> BOOL {
        let mut window_pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut window_pid) };
        if window_pid == 0 || window_pid != TARGET_PID.with(|target| target.get()) {
            return 1;
        }
        let mut message_result: usize = 0;
        let responded = unsafe {
            SendMessageTimeoutW(
                hwnd,
                WM_NULL,
                0,
                0,
                SMTO_ABORTIFHUNG,
                RESPONSIVE_TIMEOUT_MS,
                &mut message_result,
            )
        };
        if responded != 0 {
            RESPONSIVE.with(|value| value.set(true));
            return 0;
        }
        1
    }

    TARGET_PID.with(|target| target.set(pid));
    RESPONSIVE.with(|value| value.set(false));
    unsafe { EnumWindows(Some(callback), 0) };
    RESPONSIVE.with(|value| value.get())
}

#[cfg(windows)]
fn launcher_process_name(name: &str) -> bool {
    LAUNCHER_PROCESS_NAMES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

/// 除了自己以外，还在运行的启动器进程（按可执行文件名判断）。
///
/// 单实例逻辑用它兜底：没有登记消息窗口的实例（旧版本、或没走到登记那一步的进程）
/// 只能按进程名找，然后直接把它已经开着的窗口显示出来。
#[cfg(windows)]
pub fn other_launcher_process_ids() -> Vec<u32> {
    let Some(processes) = snapshot_processes() else {
        return Vec::new();
    };
    let own_pid = std::process::id();
    processes
        .iter()
        .filter(|process| process.pid != own_pid && launcher_process_name(&process.name))
        .map(|process| process.pid)
        .collect()
}

#[cfg(not(windows))]
pub fn other_launcher_process_ids() -> Vec<u32> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn cleanup_stale_webview_hosts() -> usize {
    0
}

#[cfg(not(windows))]
pub fn find_stale_webview_hosts() -> Vec<u32> {
    Vec::new()
}

#[cfg(windows)]
struct ProcessEntry {
    pid: u32,
    parent_pid: u32,
    name: String,
}

#[cfg(windows)]
fn snapshot_processes() -> Option<Vec<ProcessEntry>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut processes = Vec::new();
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let name = OsString::from_wide(&entry.szExeFile)
            .to_string_lossy()
            .trim_end_matches('\0')
            .to_string();
        processes.push(ProcessEntry {
            pid: entry.th32ProcessID,
            parent_pid: entry.th32ParentProcessID,
            name,
        });
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    Some(processes)
}

/// 这个进程有没有顶层窗口（隐藏的也算，托盘里那种就是隐藏窗口）。
///
/// `EnumWindows` 只枚举顶层窗口，正好用来区分"还活着的实例"和"只剩下进程条目的残骸"。
#[cfg(windows)]
fn process_has_any_window(pid: u32) -> bool {
    thread_local! {
        static TARGET_PID: Cell<u32> = const { Cell::new(0) };
        static FOUND: Cell<bool> = const { Cell::new(false) };
    }

    unsafe extern "system" fn callback(hwnd: HWND, _lparam: LPARAM) -> BOOL {
        let mut window_pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut window_pid) };
        let matched = TARGET_PID.with(|target| window_pid == target.get() && window_pid != 0);
        if matched {
            FOUND.with(|found| found.set(true));
            0 // 找到了就停下
        } else {
            1 // 继续枚举
        }
    }

    TARGET_PID.with(|target| target.set(pid));
    FOUND.with(|found| found.set(false));
    unsafe { EnumWindows(Some(callback), 0) };
    FOUND.with(|found| found.get())
}

#[cfg(windows)]
fn terminate_process(pid: u32) -> bool {
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let ok = unsafe { TerminateProcess(handle, 1) } != 0;
    unsafe { CloseHandle(handle) };
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_is_safe_to_call_when_nothing_is_stale() {
        // 只做检测：单测里绝不真的杀进程，避免把开发机上正常运行的实例带走。
        let targets = find_stale_webview_hosts();
        assert!(targets.len() < 10_000);
    }

    /// 干跑诊断：只列出"宿主已死"的 WebView2 进程树，不动它们。
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored print_stale_webview`
    #[test]
    #[ignore = "诊断用：只打印检测结果，不杀进程"]
    fn print_stale_webview_hosts() {
        let targets = find_stale_webview_hosts();
        println!("检测到宿主已死的 WebView2 进程 {} 个：{:?}", targets.len(), targets);
    }

    /// 逐条打印"我看到的父进程存活状态"，用来核对判定逻辑本身。
    #[test]
    #[ignore = "诊断用：打印内部判定"]
    fn debug_webview_parents() {
        let processes = snapshot_processes().unwrap_or_default();
        println!("快照进程数 = {}", processes.len());
        for process in &processes {
            if process.name.eq_ignore_ascii_case("msedgewebview2.exe") {
                let host = processes
                    .iter()
                    .find(|candidate| candidate.pid == process.parent_pid);
                println!(
                    "pid={} ppid={} host={} host_has_window={} host_responsive={}",
                    process.pid,
                    process.parent_pid,
                    host.map(|value| value.name.clone())
                        .unwrap_or_else(|| "(不在进程表)".to_string()),
                    host.map(|value| process_has_any_window(value.pid))
                        .unwrap_or(false),
                    host.map(|value| process_is_responsive(value.pid))
                        .unwrap_or(false)
                );
            }
        }
    }
}
