import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("right-click navigation", () => {
  it("suppresses the native window menu without removing left-button dragging", () => {
    expect(appSource).toContain('@contextmenu="handleContextMenu"');
    expect(appSource).toContain("event.button !== 0");
    expect(appSource).not.toContain("data-tauri-drag-region");
    expect(appSource).not.toContain("app-region: drag");
    expect(appSource).not.toContain("-webkit-app-region: drag");
  });

  it("closes the topmost dialog before leaving a secondary page", () => {
    const handler = appSource.match(/function handleContextMenu\(event: MouseEvent\) \{[\s\S]*?\n\}/)?.[0];

    expect(handler).toBeTruthy();
    expect(handler).toContain("event.preventDefault()");
    expect(handler).toContain("showRemoteLauncherNotice.value = false");
    expect(handler).toContain("showDeleteGameConfirm.value = false");
    expect(handler).toContain("showInstallConfirm.value = false");
    expect(handler).toContain("showDevPackageConfirm.value = false");
    expect(handler).toContain("showSettings.value = false");
  });
});
