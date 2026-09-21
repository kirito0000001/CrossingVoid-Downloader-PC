//! 单实例：再次启动启动器时，**直接显示已经在跑的那个窗口**（哪怕它正藏在托盘里），
//! 而不是关掉旧的再开一个新的。
//!
//! 为什么不用 `tauri-plugin-single-instance`：它只认命名互斥量。互斥量命中、但老实例的隐藏
//! 消息窗口没找到时，它会**静默地继续启动** —— 机器上于是多出一个启动器，而这个新进程自己
//! 也没登记，下一次点击又会再开一个。用户看到的就是"点一次多一个"。
//!
//! 这里的顺序固定，任何情况下都不会"先关旧再开新"：
//!
//! 1. **找已经开着的启动器**：先看它登记过的隐藏消息窗口（同款新版本会登记，旧版本也会），
//!    没有登记就走兜底 —— 按进程名找到同款启动器进程，再按 PID 找它已经开着的 `Tauri Window`。
//! 2. **把那个窗口显示出来**，然后本进程退出。老实例能应答消息就让它自己显示（Tauri 的内部
//!    状态也跟着同步）；不应答就直接 `ShowWindow` + `SetForegroundWindow` 把它顶出来。
//!
//! 只有在"确实一个都没找到"时才登记自己、正常启动。
//!
//! 互斥量/窗口类名/`WM_COPYDATA` 沿用官方插件的约定（`{id}-sim` / `{id}-sic` / `{id}-siw`），
//! 新旧版本混跑也能互相识别。

#[cfg(not(windows))]
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("cv-single-instance").build()
}

#[cfg(windows)]
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    platform::plugin()
}

#[cfg(windows)]
mod platform {
    use std::cell::Cell;
    use std::ffi::OsStr;
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::windows::ffi::OsStrExt;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Manager, Runtime};
    use windows_sys::Win32::{
        Foundation::{BOOL, CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::COPYDATASTRUCT,
            LibraryLoader::GetModuleHandleW,
            Threading::{CreateMutexW, ReleaseMutex},
        },
        UI::WindowsAndMessaging::{
            AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, DestroyWindow, EnumWindows,
            FindWindowW, GetClassNameW, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible, RegisterClassExW, SendMessageTimeoutW, SetForegroundWindow,
            SetWindowLongPtrW, ShowWindowAsync, CREATESTRUCTW, GWLP_USERDATA, GWL_STYLE,
            SMTO_ABORTIFHUNG, SW_RESTORE, SW_SHOW, WM_COPYDATA, WM_CREATE, WM_DESTROY, WM_NULL,
            WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
            WS_OVERLAPPED, WS_POPUP, WS_VISIBLE,
        },
    };

    /// 官方插件用的就是这个值，保持一样以便它发来的消息也能被我们接住。
    const COPYDATA_MAGIC: usize = 1542;
    /// 等老实例回话的上限。超过就退化成"直接把它的窗口显示出来"，仍然不另开进程。
    const REPLY_TIMEOUT_MS: u32 = 1500;
    /// 判断老窗口是否还有应答的上限；卡死的窗口会立刻返回，不会真的等这么久。
    const RESPONSE_TIMEOUT_MS: u32 = 300;
    /// 互斥量说"已经有一个在跑"、但它的登记窗口还没出现时的等待节奏（多半是刚启动）。
    const REGISTRY_WAIT_STEPS: usize = 6;
    const REGISTRY_WAIT_STEP_MS: u64 = 250;
    /// wry 给主窗口注册的类名；隐藏到托盘的启动器窗口也是这个类名。
    const MAIN_WINDOW_CLASS: &str = "Tauri Window";

    struct InstanceContext<R: Runtime> {
        app: AppHandle<R>,
    }

    /// 互斥量句柄：旧版本只看互斥量，句柄必须活到进程结束。
    struct MutexHandle(isize);
    /// 隐藏消息窗口句柄：它是"这个进程还活着"的登记凭证。
    struct MarkerWindow(isize);

    /// 已经开着的那个启动器。
    struct RunningInstance {
        pid: u32,
        /// 它登记的隐藏消息窗口（有的话）。
        marker: Option<HWND>,
        /// 它已经开着的 `Tauri Window`（有的话）。
        window: Option<HWND>,
    }

    pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
        tauri::plugin::Builder::new("cv-single-instance")
            .setup(|app, _api| {
                let identifier = app.config().identifier.clone();
                let class_name = encode_wide(format!("{identifier}-sic"));
                let window_name = encode_wide(format!("{identifier}-siw"));
                let mutex_name = encode_wide(format!("{identifier}-sim"));

                let mutex = unsafe { CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr()) };
                // 必须在 CreateMutexW 之后立刻取，晚一点就会被别的调用覆盖。
                let mutex_existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
                app.manage(MutexHandle(mutex as isize));

                // 已经开着的启动器 → 把它的窗口显示出来，然后自己退出。
                if let Some(instance) = find_running_instance(app, &class_name, &window_name, mutex_existed) {
                    if show_existing_instance(app, instance) {
                        app.cleanup_before_exit();
                        std::process::exit(0);
                    }
                }

                // 确实没有别的实例：登记自己，正常启动。
                let context = Box::into_raw(Box::new(InstanceContext { app: app.clone() }));
                let hwnd = unsafe { create_marker_window(&class_name, &window_name, context) };
                app.manage(MarkerWindow(hwnd as isize));
                Ok(())
            })
            .on_event(|app, event| {
                if let tauri::RunEvent::Exit = event {
                    release(app);
                }
            })
            .build()
    }

    /// 找到"已经开着的启动器"。找不到返回 None。
    fn find_running_instance<R: Runtime>(
        app: &AppHandle<R>,
        class_name: &[u16],
        window_name: &[u16],
        mutex_existed: bool,
    ) -> Option<RunningInstance> {
        if let Some(marker) = find_marker(class_name, window_name, mutex_existed) {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(marker, &mut pid) };
            if pid != 0 && pid != std::process::id() {
                return Some(RunningInstance {
                    pid,
                    marker: Some(marker),
                    window: find_main_window(pid),
                });
            }
        }

        // 没有登记窗口的实例：按进程名找同款启动器，再找它已经开着的窗口。
        // （旧版本、或没走到登记那一步的进程只有这条路径能找到。）
        find_unregistered_instance_window(app)
    }

    fn find_marker(class_name: &[u16], window_name: &[u16], mutex_existed: bool) -> Option<HWND> {
        let hwnd = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
        if !hwnd.is_null() {
            return Some(hwnd);
        }
        if !mutex_existed {
            return None;
        }
        // 互斥量说已经有一个在跑、登记窗口却还没出现：多半是刚启动还没来得及登记
        // （连点两下图标就是这种情况），等它一下再判断。
        for _ in 0..REGISTRY_WAIT_STEPS {
            thread::sleep(Duration::from_millis(REGISTRY_WAIT_STEP_MS));
            let hwnd = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
            if !hwnd.is_null() {
                return Some(hwnd);
            }
        }
        None
    }

    /// 把已经开着的那个启动器的窗口显示出来。返回 true 表示确实处理了它，调用方应当退出。
    fn show_existing_instance<R: Runtime>(app: &AppHandle<R>, instance: RunningInstance) -> bool {
        // 前台权默认只给刚刚被用户点开的进程，而真正要显示窗口的是老实例，所以显式转交。
        unsafe { AllowSetForegroundWindow(instance.pid) };

        if let Some(marker) = instance.marker {
            // 老实例自己显示时，Tauri 内部的可见状态也跟着同步，是最干净的一条路。
            if ask_instance_to_show(marker) {
                return true;
            }
        }

        if let Some(window) = instance.window {
            // 叫不应（或压根没登记过）就直接把窗口顶出来：仍然只是"显示之前那个窗口"。
            if restore_window(instance.pid, window) {
                return true;
            }
        }

        // 只有登记窗口、主窗口还没建好：那说明老实例还在启动，让它自己把窗口显示出来即可。
        if instance.window.is_none() && instance.marker.is_some() {
            return true;
        }

        // 老实例已经卡死到收不到任何消息：它的窗口谁也显示不出来（ShowWindow 也不生效）。
        // 这不是"关掉旧的再开新的"，而是那个进程已经不再响应；只能让新进程正常起来，
        // 否则玩家点一下什么都没有。
        log_frozen_instance(app, instance.pid);
        false
    }

    /// 请老实例把主窗口显示出来。返回 false 表示它超时没应答。
    fn ask_instance_to_show(marker: HWND) -> bool {
        let cwd = std::env::current_dir().unwrap_or_default();
        let args = std::env::args().collect::<Vec<_>>().join("|");
        let payload = format!("{}|{}\0", cwd.to_string_lossy(), args);
        let bytes = payload.as_bytes();
        let data = COPYDATASTRUCT {
            dwData: COPYDATA_MAGIC,
            cbData: bytes.len() as u32,
            lpData: bytes.as_ptr() as *mut core::ffi::c_void,
        };

        let mut result: usize = 0;
        let delivered = unsafe {
            SendMessageTimeoutW(
                marker,
                WM_COPYDATA,
                0,
                &data as *const COPYDATASTRUCT as isize,
                SMTO_ABORTIFHUNG,
                REPLY_TIMEOUT_MS,
                &mut result,
            )
        };
        delivered != 0
    }

    /// 直接显示某个窗口：藏着就 `SW_SHOW`，最小化就 `SW_RESTORE`，然后抢到前台。
    /// 返回 false 表示这个窗口根本显示不出来（线程已经卡死）。
    fn restore_window(pid: u32, window: HWND) -> bool {
        if !window_responds(window) {
            return false;
        }
        unsafe { AllowSetForegroundWindow(pid) };
        let iconic = unsafe { IsIconic(window) } != 0;
        unsafe { ShowWindowAsync(window, if iconic { SW_RESTORE } else { SW_SHOW }) };
        // 刚异步显示出来的窗口不一定立刻能被设成前台，重试几次。
        for _ in 0..10 {
            let shown = unsafe { IsWindowVisible(window) } != 0;
            if shown && unsafe { SetForegroundWindow(window) } != 0 {
                return true;
            }
            thread::sleep(Duration::from_millis(40));
        }
        let visible = unsafe { IsWindowVisible(window) } != 0;
        visible
    }

    /// 窗口还应不应答消息。卡死的实例在这里就会被挡下来（`SMTO_ABORTIFHUNG` 让它立刻返回）。
    fn window_responds(window: HWND) -> bool {
        let mut result: usize = 0;
        let responded = unsafe {
            SendMessageTimeoutW(
                window,
                WM_NULL,
                0,
                0,
                SMTO_ABORTIFHUNG,
                RESPONSE_TIMEOUT_MS,
                &mut result,
            )
        };
        responded != 0
    }

    /// 按进程名找到"没有登记的"启动器实例，并返回它已经开着的窗口。
    ///
    /// 挑选顺序很重要：**先挑窗口还应答的**（卡死的那个谁也显示不出来），
    /// 都能应答时再挑已经显示在屏幕上的 —— 那才是玩家正在用的那个。
    fn find_unregistered_instance_window<R: Runtime>(app: &AppHandle<R>) -> Option<RunningInstance> {
        let mut visible: Option<RunningInstance> = None;
        let mut alive: Option<RunningInstance> = None;
        let mut frozen: Option<u32> = None;

        for pid in crate::webview_cleanup::other_launcher_process_ids() {
            let Some(window) = find_main_window(pid) else {
                continue;
            };
            if !window_responds(window) {
                if frozen.is_none() {
                    frozen = Some(pid);
                }
                continue;
            }
            let instance = RunningInstance {
                pid,
                marker: None,
                window: Some(window),
            };
            if unsafe { IsWindowVisible(window) } != 0 {
                visible.get_or_insert(instance);
            } else {
                alive.get_or_insert(instance);
            }
        }

        if let Some(pid) = frozen {
            log_frozen_instance(app, pid);
        }
        visible.or(alive)
    }

    /// 找某个进程的主窗口（类名 `Tauri Window`；隐藏到托盘的窗口同样能找到）。
    fn find_main_window(pid: u32) -> Option<HWND> {
        thread_local! {
            static TARGET_PID: Cell<u32> = const { Cell::new(0) };
            static FOUND: Cell<isize> = const { Cell::new(0) };
        }

        unsafe extern "system" fn callback(hwnd: HWND, _lparam: LPARAM) -> BOOL {
            let mut window_pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, &mut window_pid) };
            let matched = TARGET_PID.with(|target| window_pid != 0 && window_pid == target.get());
            if !matched {
                return 1;
            }
            let mut class = [0u16; 64];
            let length = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32) };
            if length <= 0 {
                return 1;
            }
            if String::from_utf16_lossy(&class[..length as usize]) != MAIN_WINDOW_CLASS {
                return 1;
            }
            FOUND.with(|found| found.set(hwnd as isize));
            0
        }

        TARGET_PID.with(|target| target.set(pid));
        FOUND.with(|found| found.set(0));
        unsafe { EnumWindows(Some(callback), 0) };
        let found = FOUND.with(|value| value.get());
        if found == 0 {
            None
        } else {
            Some(found as HWND)
        }
    }

    fn release<R: Runtime>(app: &AppHandle<R>) {
        if let Some(mutex) = app.try_state::<MutexHandle>() {
            if mutex.0 != 0 {
                unsafe {
                    ReleaseMutex(mutex.0 as _);
                    CloseHandle(mutex.0 as _);
                }
            }
        }
        if let Some(window) = app.try_state::<MarkerWindow>() {
            if window.0 != 0 {
                unsafe { DestroyWindow(window.0 as _) };
            }
        }
    }

    unsafe fn create_marker_window<R: Runtime>(
        class_name: &[u16],
        window_name: &[u16],
        context: *const InstanceContext<R>,
    ) -> HWND {
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(marker_window_proc::<R>),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: GetModuleHandleW(std::ptr::null()),
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        RegisterClassExW(&class);

        let hwnd = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            window_name.as_ptr(),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            context as *const core::ffi::c_void,
        );
        // 窗口得算可见才收得到消息；靠 LAYERED + TOOLWINDOW 保证它不会被玩家看到。
        SetWindowLongPtrW(hwnd, GWL_STYLE, (WS_VISIBLE | WS_POPUP) as isize);
        hwnd
    }

    unsafe extern "system" fn marker_window_proc<R: Runtime>(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CREATE => {
                let create = &*(lparam as *const CREATESTRUCTW);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
                0
            }

            WM_COPYDATA => {
                // 老实例（跑官方插件那一版）也会用这条消息请求把窗口叫回来，
                // 所以不校验内容，收到就显示主窗口。
                let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const InstanceContext<R>;
                if !context.is_null() {
                    crate::show_main_window(&(*context).app);
                }
                1
            }

            WM_DESTROY => {
                let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut InstanceContext<R>;
                if !context.is_null() {
                    drop(Box::from_raw(context));
                }
                0
            }

            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    fn log_frozen_instance<R: Runtime>(app: &AppHandle<R>, pid: u32) {
        let Ok(log_dir) = app.path().app_log_dir() else {
            return;
        };
        if fs::create_dir_all(&log_dir).is_err() {
            return;
        }
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let line = format!("[{seconds}] 已运行的启动器进程 {pid} 已卡死（窗口不响应消息），改由新实例启动\n");
        let path = log_dir.join("single-instance.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = file.write_all(line.as_bytes());
        }
    }

    fn encode_wide(value: impl AsRef<OsStr>) -> Vec<u16> {
        value
            .as_ref()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}
