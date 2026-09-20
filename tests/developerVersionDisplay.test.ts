import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appSource, launcherStyleSource, readSource } from "./helpers/launcherSources";

const developerConsoleSource = readSource("src/dev/useDeveloperConsole.ts");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("developer version display", () => {
  it("reads the platform version from the developer file and the release manifest", () => {
    // 只读 Saved/Launcher/developer-version.json 会被一份停更的数字骗到，
    // 开发页显示的“当前版本”必须同时参考最近一次发布清单。
    expect(developerConsoleSource).toContain('invoke<string | null>("dev_get_launcher_version")');
    expect(developerConsoleSource).toContain(
      'invoke<string | null>("dev_get_published_launcher_version")',
    );
    expect(nativeSource).toContain("dev_get_published_launcher_version,");
    expect(nativeSource).toContain('"dist-launcher-update"');
  });

  it("refreshes the displayed version every time the developer tab opens", () => {
    expect(appSource).toContain("void refreshDeveloperLauncherVersion();");
  });

  it("gives the remote notice close button a hover state", () => {
    expect(launcherStyleSource).toContain(".remote-notice-panel > button:hover");
  });
});
