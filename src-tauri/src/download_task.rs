//! 下载任务的取消标志：**按安装目录一份**。
//!
//! 以前是一个进程级的 `AtomicBool`：玩家在 A 游戏下载时切到 B、点了暂停，A 的下载也跟着停。
//! 现在按任务存，谁的活查谁的标志。
//!
//! 为什么用线程局部而不是把 token 一层层传下去：取消检查散在下载 / 校验 / 解压 / 导入
//! 十几个函数里（见 `check_download_cancelled` 的调用点），逐层加参数要改十几处签名。
//! 改成"任务入口把本线程标记成在为某个安装目录干活"，检查处照着查表即可。
//!
//! **没进过作用域的线程退回原来的全局标志** —— 旧的切片下载链路（`download_game_archive` 等）
//! 没迁过来的地方行为完全不变，属于渐进迁移。

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// 旧链路用的进程级标志（没有任务作用域时的回退）。
static GLOBAL_CANCELLED: AtomicBool = AtomicBool::new(false);

/// 安装目录 → 该任务的取消标志。一个安装目录同时只会有一个下载任务。
static TASKS: Mutex<Vec<(String, Arc<AtomicBool>)>> = Mutex::new(Vec::new());

thread_local! {
    /// 本线程当前在给哪个安装目录干活（`None` = 旧链路）。
    static CURRENT_TASK: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn normalize(install_path: &str) -> String {
    install_path.trim().to_lowercase()
}

fn flag_for(install_path: &str) -> Arc<AtomicBool> {
    let key = normalize(install_path);
    let mut tasks = TASKS.lock().unwrap_or_else(|error| error.into_inner());
    if let Some((_, flag)) = tasks.iter().find(|(item, _)| *item == key) {
        return Arc::clone(flag);
    }
    let flag = Arc::new(AtomicBool::new(false));
    tasks.push((key, Arc::clone(&flag)));
    flag
}

/// 任务入口：把本线程标记成"在为这个安装目录干活"，并清掉上一轮留下的取消标志。
///
/// 上一轮暂停留下 true 的坑在这里补：不清的话，本次任务会在第一个检查点立刻退出，
/// 前端把它当"用户主动暂停"，现场就是"点继续下载没反应"。
pub fn begin(install_path: &str) {
    flag_for(install_path).store(false, Ordering::SeqCst);
    let key = install_path.trim().to_string();
    CURRENT_TASK.with(|cell| *cell.borrow_mut() = Some(key));
}

/// 暂停 / 取消某个安装目录的任务。
pub fn cancel(install_path: &str) {
    flag_for(install_path).store(true, Ordering::SeqCst);
}

/// 没有指定任务时的回退：老调用方（开发页脚本、旧前端）仍然按进程级标志暂停。
pub fn cancel_global() {
    GLOBAL_CANCELLED.store(true, Ordering::SeqCst);
}

pub fn reset_global() {
    GLOBAL_CANCELLED.store(false, Ordering::SeqCst);
}

/// 当前线程是否已被要求取消。
pub fn is_cancelled() -> bool {
    let key = CURRENT_TASK.with(|cell| cell.borrow().clone());
    match key {
        Some(install_path) => flag_for(&install_path).load(Ordering::SeqCst),
        None => GLOBAL_CANCELLED.load(Ordering::SeqCst),
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;

    #[test]
    fn pausing_one_task_does_not_touch_another() {
        begin("D:\\TFAC-hz64\\CrossingVoid");
        begin("D:\\TFAC-hz64\\NarutoBP");

        // 当前线程属于 NarutoBP：暂停零境的任务，不该影响它。
        cancel("D:\\TFAC-hz64\\CrossingVoid");
        assert!(!is_cancelled(), "暂停别的任务不该影响本线程");

        cancel("D:\\TFAC-hz64\\NarutoBP");
        assert!(is_cancelled(), "暂停本任务后必须立刻看到");

        // 重新进入作用域就是"继续下载"：标志要重新是干净的。
        begin("D:\\TFAC-hz64\\NarutoBP");
        assert!(!is_cancelled());
    }

    #[test]
    fn threads_without_scope_fall_back_to_the_global_flag() {
        reset_global();
        assert!(!is_cancelled());
        cancel_global();
        assert!(is_cancelled());
        reset_global();
    }
}
