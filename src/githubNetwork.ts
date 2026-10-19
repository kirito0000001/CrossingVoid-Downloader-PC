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
 *
 * **"没检测到代理"不等于"网络差"**：直连 GitHub 一样可能很快（2026-10-19 现场：
 * 下载跑得正欢，界面还在报"未开启网络代理，下载会很慢"）。所以现在只有探测**真的**
 * 不通或延迟超阈值时才提示；能直连就一个字都不说。
 *
 * 探测本身是开机/切源时的一次快照（见 `get_github_network_status`：查系统代理 +
 * 请求一次 github.com 量首字节时间），不代表下载时的真实速度 —— 所以调用方还会
 * 用实测下载速度把它压掉（见 App.vue 的 `githubNetworkWarningText`）。
 */
export function githubNetworkWarning(
  status: GithubNetworkStatus,
  options: { proxyDisabledByUser?: boolean } = {},
) {
  const poorNetwork =
    !status.reachable || status.latencyMs === null || status.latencyMs >= GITHUB_HIGH_LATENCY_MS;

  if (!status.proxyDetected) {
    if (!poorNetwork) return "";
    return options.proxyDisabledByUser
      ? "直连 GitHub 较慢，可换回系统代理"
      : "未检测到网络代理，GitHub 连接不稳定，可在设置里开启代理";
  }

  if (poorNetwork) return "当前网络不佳，请更换代理";
  return "";
}
