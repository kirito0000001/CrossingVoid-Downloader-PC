import { describe, expect, it } from "vitest";
import { githubNetworkWarning, type GithubNetworkStatus } from "../src/githubNetwork";

function status(overrides: Partial<GithubNetworkStatus> = {}): GithubNetworkStatus {
  return { proxyDetected: true, reachable: true, latencyMs: 320, ...overrides };
}

describe("Github network guidance", () => {
  it("prioritizes the missing-proxy warning", () => {
    expect(githubNetworkWarning(status({ proxyDetected: false, reachable: false, latencyMs: null })))
      .toBe("当前未开启网络代理，下载会很慢（已经下载游戏分片，进入设置安装）");
  });

  it("warns when a configured proxy cannot reach Github", () => {
    expect(githubNetworkWarning(status({ reachable: false, latencyMs: null })))
      .toBe("当前网络不佳，请更换代理");
  });
});
