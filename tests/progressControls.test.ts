import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("long-running progress controls", () => {
  it("pauses repair downloads and cancels non-resumable game operations", () => {
    expect(appSource).toContain("repairOperationStage");
    expect(appSource).toContain("pauseRepairDownload");
    expect(appSource).toContain("cancelCurrentGameOperation");
    expect(appSource).toContain('invoke("cancel_game_operation")');
    expect(rustSource).toContain("fn cancel_game_operation()");
  });

  it("pauses and resumes developer game uploads with their original context", () => {
    expect(appSource).toContain("developerGamePublishContext");
    expect(appSource).toContain("pauseDeveloperUpload");
    expect(appSource).toContain("resumeDeveloperUpload");
    expect(appSource).toContain('invoke("dev_pause_script")');
    expect(rustSource).toContain("DEV_SCRIPT_PAUSED");
    expect(rustSource).toContain("fn dev_pause_script()");
  });

  it("keeps pause and cancel icons still while showing detailed repair stages", () => {
    expect(appSource).toContain("primaryActionSpinning");
    expect(appSource).toContain("spinning: primaryActionSpinning");
    expect(appSource).toContain('t("status.repairPreparing")');
    expect(appSource).toContain('t("status.repairDownloading")');
    expect(appSource).toContain('t("status.repairWriting")');
    expect(appSource).toContain('t("status.repairVerifying")');
    expect(appSource).toContain("formatBytes(downloadedBytes.value)");
  });

  it("shows byte-level manifest verification progress and the current file", () => {
    expect(appSource).toContain("currentFile?: string");
    expect(appSource).toContain("processedBytes?: number");
    expect(appSource).toContain("currentFileTotalBytes?: number");
    expect(appSource).toContain("verificationCurrentFile");
    expect(appSource).toContain("verificationByteProgress");
    expect(rustSource).toContain("current_file: Option<String>");
    expect(rustSource).toContain("processed_bytes: u64");
    expect(rustSource).toContain("calculate_file_sha256_with_progress");
  });
});
