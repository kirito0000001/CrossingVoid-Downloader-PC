export const GITHUB_HIGH_LATENCY_MS = 2_000;

export type GithubNetworkStatus = {
  proxyDetected: boolean;
  reachable: boolean;
  latencyMs: number | null;
};

export function githubNetworkWarning(status: GithubNetworkStatus) {
  if (!status.proxyDetected) return "当前未开启网络代理，下载会很慢（已经下载游戏分片，进入设置安装）";
  if (!status.reachable || status.latencyMs === null || status.latencyMs >= GITHUB_HIGH_LATENCY_MS) {
    return "当前网络不佳，请更换代理";
  }
  return "";
}
