export const GITHUB_HIGH_LATENCY_MS = 2_000;

export type GithubNetworkStatus = {
  proxyDetected: boolean;
  reachable: boolean;
  latencyMs: number | null;
};

/**
 * 右上角那条 GitHub 提示的文案；空串表示不用提示。
 *
 * `proxyDisabledByUser`：玩家自己在设置里关掉了「GitHub 走系统代理」。
 * 那时候"未开启网络代理，下载会很慢"就是废话（他就是要走直连），
 * 所以跳过这条，只在真的连不上/太慢时说"请更换代理"。
 */
export function githubNetworkWarning(
  status: GithubNetworkStatus,
  options: { proxyDisabledByUser?: boolean } = {},
) {
  if (!status.proxyDetected && !options.proxyDisabledByUser) {
    // 早先这句后面还拖着一个"（已经下载游戏分片，进入设置安装）"——语义绕，
    // 而且下载完会自动进安装之后它已经过时了（2026-09-21 去掉）。
    return "当前未开启网络代理，下载会很慢";
  }
  if (!status.reachable || status.latencyMs === null || status.latencyMs >= GITHUB_HIGH_LATENCY_MS) {
    return "当前网络不佳，请更换代理";
  }
  return "";
}
