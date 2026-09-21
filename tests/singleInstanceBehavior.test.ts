import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const libSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const singleInstanceSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/single_instance.rs"),
  "utf8",
);
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

describe("launcher single instance", () => {
  it("uses our own implementation instead of the plugin that silently starts a second copy", () => {
    // tauri-plugin-single-instance 只看互斥量：互斥量命中但隐藏窗口没找到时它会继续启动，
    // 于是多出一个谁也看不见的启动器，下一次点击又再开一个。
    expect(libSource).toContain("single_instance::plugin()");
    expect(libSource).not.toContain("tauri_plugin_single_instance");
    expect(cargoToml).not.toContain("tauri-plugin-single-instance");
  });

  it("finds the running launcher and shows its window instead of closing and reopening", () => {
    // 两条查找路径：登记过的隐藏消息窗口；以及没登记过时按进程名 + `Tauri Window` 类名找。
    expect(singleInstanceSource).toContain("FindWindowW");
    expect(singleInstanceSource).toContain("other_launcher_process_ids");
    expect(singleInstanceSource).toContain('MAIN_WINDOW_CLASS: &str = "Tauri Window"');
    expect(singleInstanceSource).toContain("ShowWindowAsync");
    expect(singleInstanceSource).toContain("SetForegroundWindow");
    // 只显示窗口，绝不结束别人的进程 —— 那才是"关闭后重开"。
    expect(singleInstanceSource).not.toContain("TerminateProcess");
  });

  it("checks a window still answers before showing it, and reports a frozen one", () => {
    // 卡死的实例窗口显示不出来（ShowWindow 不生效），这时候要留日志而不是静默什么都不做。
    expect(singleInstanceSource).toContain("window_responds");
    expect(singleInstanceSource).toContain("SMTO_ABORTIFHUNG");
    expect(singleInstanceSource).toContain("log_frozen_instance");
    expect(singleInstanceSource).toContain("已卡死");
  });
});
