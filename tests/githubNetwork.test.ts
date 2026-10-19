import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GITHUB_HIGH_LATENCY_MS,
  githubNetworkWarning,
  type GithubNetworkStatus,
} from "../src/githubNetwork";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

function status(overrides: Partial<GithubNetworkStatus> = {}): GithubNetworkStatus {
  return { proxyDetected: true, reachable: true, latencyMs: 320, ...overrides };
}

describe("Github network guidance", () => {
  it("does not equate 'no proxy' with 'slow network'", () => {
    // 2026-10-19 现场：没配系统代理、直连 github 正常（下载十几 MB/s），却报"未开启网络代理，下载会很慢"。
    expect(githubNetworkWarning(status({ proxyDetected: false }))).toBe("");
    // 真的连不上时才提示，并且说清楚是"直连不稳定"，而不是断言下载一定慢。
    expect(
      githubNetworkWarning(status({ proxyDetected: false, reachable: false, latencyMs: null })),
    ).toBe("未检测到网络代理，GitHub 连接不稳定，可在设置里开启代理");
    // 直连能通但首字节很慢，同样值得提示。
    expect(
      githubNetworkWarning(
        status({ proxyDetected: false, latencyMs: GITHUB_HIGH_LATENCY_MS + 1 }),
      ),
    ).toContain("未检测到网络代理");
  });

  it("warns when a configured proxy cannot reach Github or is too slow", () => {
    expect(githubNetworkWarning(status({ reachable: false, latencyMs: null }))).toBe(
      "当前网络不佳，请更换代理",
    );
    expect(
      githubNetworkWarning(status({ latencyMs: GITHUB_HIGH_LATENCY_MS + 1 })),
    ).toBe("当前网络不佳，请更换代理");
    // 代理正常、延迟低：什么都不说。
    expect(githubNetworkWarning(status())).toBe("");
  });

  it("does not nag about the proxy when the player turned it off on purpose", () => {
    // 玩家把「GitHub 走系统代理」关掉就是选了直连 —— 直连快就一个字都别说。
    expect(
      githubNetworkWarning(status({ proxyDetected: false }), { proxyDisabledByUser: true }),
    ).toBe("");
    // 直连也不行的时候，仍然要给"换回代理"的建议。
    expect(
      githubNetworkWarning(status({ proxyDetected: false, reachable: false, latencyMs: null }), {
        proxyDisabledByUser: true,
      }),
    ).toBe("直连 GitHub 较慢，可换回系统代理");
  });

  it("yields to the measured download speed", () => {
    // 探测只是开机快照；正在下载且估算速度 >= 1 MB/s 时，提示必须闭嘴。
    expect(appSource).toContain("GITHUB_WARNING_HEALTHY_SPEED_BYTES");
    expect(appSource).toContain("estimate.status === \"ready\" && estimate.bytesPerSecond >=");
    expect(appSource).toContain("downloadEstimate.value");
  });
});
