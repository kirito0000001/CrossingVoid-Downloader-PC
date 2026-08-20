import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("launcher error logging", () => {
  it("records handled and unhandled errors through one native command", () => {
    expect(appSource).toContain('invoke<string>("write_launcher_error_log"');
    expect(appSource).toContain('window.addEventListener("error", handleUnhandledWindowError)');
    expect(appSource).toContain('window.addEventListener("unhandledrejection", handleUnhandledRejection)');
    expect(appSource).toContain("console.error = launcherConsoleError");
    expect(appSource).toContain("isLauncherErrorMessage(message)");
  });

  it("uses readable Chinese file names and keeps the error log directory bounded", () => {
    expect(nativeSource).toContain("write_launcher_error_log");
    expect(nativeSource).toContain('format!("错误-{}-{}.log"');
    expect(nativeSource).toContain("MAX_ERROR_LOG_TOTAL_BYTES");
    expect(nativeSource).toContain("prune_launcher_error_logs");
  });

  it("keeps release log timestamp types available and debug-only atomics gated", () => {
    expect(nativeSource).toContain(
      "use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};",
    );
    expect(nativeSource).toContain(
      "#[cfg(debug_assertions)]\nuse std::sync::atomic::AtomicU32;",
    );
  });
});
