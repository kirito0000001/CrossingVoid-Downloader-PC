import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const libSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

/**
 * 启动器是 GUI 进程（没有控制台）。从这里起一个控制台程序（powershell / taskkill / where …）
 * 时，Windows 会**给它开一个新的控制台窗口** —— 除非显式带 `CREATE_NO_WINDOW`。
 * 表现就是玩家点一下，屏幕上闪过一个黑框（用户 2026-10-19 报："安装游戏的时候会弹出一次
 * PowerShell 的界面"）。
 *
 * 这些地方必须走 `hidden_windows_command()`。
 */
describe("拉起控制台程序不露窗口", () => {
  it("建桌面快捷方式的 PowerShell 必须隐藏（装游戏收尾时那一下黑框）", () => {
    // 这条命令是在 finalize_game_package_install 里跑的（create_desktop_shortcut 默认开）
    const start = libSource.indexOf("fn create_game_desktop_shortcut_with(");
    const end = libSource.indexOf("#[cfg(not(windows))]", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const shortcutFn = libSource.slice(start, end);

    expect(shortcutFn).toContain('hidden_windows_command("powershell")');
    expect(shortcutFn).not.toContain('Command::new("powershell")');
    // 快捷方式是装完游戏那一刻建的，这个开关默认开着
    expect(libSource).toContain("if create_desktop_shortcut {");
  });

  it("玩家会触发的控制台调用一律不许裸 spawn", () => {
    for (const program of ["powershell", "taskkill"]) {
      expect(libSource).not.toContain(`Command::new("${program}")`);
    }
    // 卸载启动器 / 结束游戏进程 / 开发页暂停上传：三处都要走隐藏通道
    const hiddenCalls = libSource.match(/hidden_windows_command\("taskkill"\)/g) ?? [];
    expect(hiddenCalls.length).toBeGreaterThanOrEqual(2);
    const powershellCalls = libSource.match(/hidden_windows_command\("powershell"\)/g) ?? [];
    expect(powershellCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("hidden_windows_command 真的设了 CREATE_NO_WINDOW，且非 Windows 有直通实现", () => {
    expect(libSource).toContain("command.creation_flags(CREATE_NO_WINDOW)");
    expect(libSource).toContain("const CREATE_NO_WINDOW: u32 = 0x0800_0000;");
    // 非 Windows 直通：调用点不用到处写 cfg，也让 cargo check 在别的平台能过
    expect(libSource).toMatch(
      /#\[cfg\(not\(windows\)\)\]\s*fn hidden_windows_command\(program: &str\) -> Command \{\s*Command::new\(program\)\s*\}/,
    );
  });

  it("启动游戏本身仍然是可见的（只隐藏控制台工具，不要误伤游戏进程）", () => {
    const start = libSource.indexOf("let mut command = Command::new(&exe_path);");
    expect(start).toBeGreaterThan(-1);
    const launch = libSource.slice(start, start + 400);
    expect(launch).not.toContain("creation_flags");
  });

  // 同一个函数里还有第二道坑：临时 .ps1 没带 BOM，PowerShell 5.1 会按 GBK 读，
  // 中文直接乱码（桌面快捷方式叫「骞绘潃」、卸载脚本匹配不到「零境启动器」）。
  it("临时 PowerShell 脚本必须以 UTF-8 + BOM 落盘", () => {
    expect(libSource).toContain("fn write_powershell_script(path: &Path, script: &str)");
    expect(libSource).toContain("bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);");
    // 两处临时脚本（建快捷方式 / 卸载启动器）都必须走这个写入函数
    const bareWrites = libSource.match(/fs::write\(&script_path, script\)/g) ?? [];
    expect(bareWrites).toHaveLength(0);
    const helperWrites = libSource.match(/write_powershell_script\(&script_path, &?script\)/g) ?? [];
    expect(helperWrites.length).toBeGreaterThanOrEqual(2);
  });
});
