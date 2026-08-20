import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("PC Github network detection", () => {
  it("checks native proxy and Github latency when the source changes", () => {
    expect(nativeSource).toContain("get_github_network_status");
    expect(nativeSource).toContain("ProxyEnable");
    expect(appSource).toContain("refreshGithubNetworkStatus");
    expect(appSource).toContain('if (source === "github") void refreshGithubNetworkStatus()');
  });

  it("reuses one proxy lookup and hides Windows registry child processes", () => {
    expect(nativeSource).toContain("build_http_agent_with_proxy");
    expect(nativeSource).toContain("CREATE_NO_WINDOW");
    expect(nativeSource).toContain("hidden_windows_command(\"reg.exe\")");
  });

  it("shows the Github warning in the home banner and download settings", () => {
    expect(appSource).toContain("showGithubNetworkWarning");
    expect(appSource).toContain("github-network-status");
    expect(appSource).toContain("githubNetworkWarningText");
  });
});
