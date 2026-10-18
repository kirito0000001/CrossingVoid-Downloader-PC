import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { launcherSource } from "./helpers/launcherSources";

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
    expect(launcherSource).toContain("github-network-status");
    expect(appSource).toContain("githubNetworkWarningText");
  });

  it("only shows download hints when there is really something to download", () => {
    // 用户 2026-09-21 的截图：游戏装好了、版本 0.5.14 是最新的，右上角还在报"下载会很慢"。
    // 渠道被关 / 流量不足 / 被限速 / 没挂代理这几条下载提示，只在"还没装好"或"有更新"时出现。
    const gate = appSource.match(/const showDownloadWarning = computed\(\(\) => \{[\s\S]*?\n\}\);/)?.[0];
    expect(gate).toBeTruthy();
    expect(gate).toContain('if (launcherState.value === "ready" && !updateAvailable.value) return false;');
    expect(gate).toContain("return Boolean(downloadWarningText.value);");

    // 具体写哪一句收在 downloadWarningText 里：渠道 → 流量（不足 / 被限速）→ Github。
    const text = appSource.match(/const downloadWarningText = computed\(\(\) => \{[\s\S]*?\n\}\);/)?.[0];
    expect(text).toBeTruthy();
    expect(text).toContain("if (downloadChannelWarningText.value) return downloadChannelWarningText.value;");
    expect(text).toContain('if (showOfficialTrafficWarning.value) return t("traffic.low");');
    // 2026-10-18 新增：月流量超了之后服务商限速，横幅要能说出"为什么现在这么慢"
    expect(text).toContain('if (showOfficialTrafficThrottled.value) return t("traffic.throttled");');
    expect(text).toContain("if (showGithubNetworkWarning.value) return githubNetworkWarningText.value;");

    // 主界面那条横幅要用这个判定，而不是把几个条件直接摊在模板里。
    expect(appSource).toContain("!gameOverviewVisible && showDownloadWarning");
    expect(appSource).not.toContain(
      "downloadChannelWarningText || showOfficialTrafficWarning || showGithubNetworkWarning",
    );
    // 玩家自己关掉「GitHub 走系统代理」之后，别再唠叨"未开启网络代理"。
    expect(appSource).toContain("proxyDisabledByUser: !githubUseSystemProxy.value");
  });
});
