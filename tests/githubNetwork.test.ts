import { describe, expect, it } from "vitest";
import { githubNetworkWarning, type GithubNetworkStatus } from "../src/githubNetwork";

function status(overrides: Partial<GithubNetworkStatus> = {}): GithubNetworkStatus {
  return { proxyDetected: true, reachable: true, latencyMs: 320, ...overrides };
}

describe("Github network guidance", () => {
  it("prioritizes the missing-proxy warning", () => {
    expect(githubNetworkWarning(status({ proxyDetected: false, reachable: false, latencyMs: null })))
      .toBe("当前未开启网络代理，下载会很慢");
  });

  it("warns when a configured proxy cannot reach Github", () => {
    expect(githubNetworkWarning(status({ reachable: false, latencyMs: null })))
      .toBe("当前网络不佳，请更换代理");
  });

  it("does not nag about the proxy when the player turned it off on purpose", () => {
    // 玩家把「GitHub 走系统代理」关掉就是选了直连 —— 这时候说"未开启网络代理，下载会很慢"是废话，
    // 只要直连通得快就一个字都别说（用户 2026-09-21）。
    expect(githubNetworkWarning(status({ proxyDetected: false }), { proxyDisabledByUser: true })).toBe("");
    // 直连也不行的时候，仍然要给"换代理"的建议。
    expect(
      githubNetworkWarning(status({ proxyDetected: false, reachable: false, latencyMs: null }), {
        proxyDisabledByUser: true,
      }),
    ).toBe("当前网络不佳，请更换代理");
    // 没传这个选项时保持老行为（后端/老调用方不受影响）。
    expect(githubNetworkWarning(status({ proxyDetected: false }))).toContain("未开启网络代理");
  });
});
