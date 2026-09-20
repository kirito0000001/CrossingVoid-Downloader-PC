/**
 * 远程下载渠道开关（开发页发布 → 全量玩家生效）。
 *
 * 契约是**数组**：每个渠道各自独立开关、各自带说明；以后新增渠道只要在启动器自己的
 * 渠道表（`src/launcherData.ts` 的 `downloadSources`）里加一行，服务端文档跟着多一项即可。
 * 服务端没提到的渠道按"默认开放"处理，保证旧文档与旧启动器都能正常跑。
 */

import type { DownloadSourceKey } from "./launcherTypes";

export const DOWNLOAD_CHANNELS_URL = "https://www.crossingvoid.top/launcher-download-channels.json";

export type RemoteDownloadChannel = {
  key: string;
  enabled: boolean;
  note: string;
};

export type RemoteDownloadChannels = {
  schemaVersion: 1;
  channels: RemoteDownloadChannel[];
  publishedAt: number;
};

export type DownloadChannelState = {
  key: DownloadSourceKey;
  enabled: boolean;
  /** 该渠道自己的关闭说明（整站级别的说明走远程公告，不在这里重复）。 */
  note: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/** 解析远端文档；任何一项不合法就整份判为无效（返回 null，按"全部开放"处理）。 */
export function parseRemoteDownloadChannels(payload: unknown): RemoteDownloadChannels | null {
  const record = asRecord(payload);
  if (!record || record.schemaVersion !== 1) return null;
  const rawChannels = Array.isArray(record.channels) ? record.channels : null;
  if (!rawChannels || rawChannels.length === 0) return null;

  const channels: RemoteDownloadChannel[] = [];
  const seen = new Set<string>();
  for (const item of rawChannels) {
    const entry = asRecord(item);
    if (!entry) return null;
    const key = asTrimmedString(entry.key, 32).toLowerCase();
    if (!key || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(key)) return null;
    if (seen.has(key)) return null;
    if (typeof entry.enabled !== "boolean") return null;
    seen.add(key);
    channels.push({
      key,
      enabled: entry.enabled,
      note: asTrimmedString(entry.note, 200),
    });
  }

  const publishedAt = typeof record.publishedAt === "number" && Number.isFinite(record.publishedAt)
    ? record.publishedAt
    : 0;

  return {
    schemaVersion: 1,
    channels,
    publishedAt,
  };
}

/**
 * 把远端开关套到本地渠道表上。
 * 本地有、远端没提到的渠道 → 默认开放（新渠道上线时不会因为文档没更新而全员禁下载）。
 */
export function resolveDownloadChannelStates(
  catalogKeys: readonly DownloadSourceKey[],
  remote: RemoteDownloadChannels | null,
): DownloadChannelState[] {
  const remoteByKey = new Map<string, RemoteDownloadChannel>();
  for (const channel of remote?.channels ?? []) {
    remoteByKey.set(channel.key, channel);
  }

  return catalogKeys.map((key) => {
    const matched = remoteByKey.get(key);
    return {
      key,
      enabled: matched ? matched.enabled : true,
      note: matched?.note ?? "",
    };
  });
}

export function downloadChannelState(
  states: readonly DownloadChannelState[],
  key: DownloadSourceKey,
): DownloadChannelState {
  return states.find((state) => state.key === key) ?? {
    key,
    enabled: true,
    note: "",
  };
}

export function isDownloadChannelEnabled(
  states: readonly DownloadChannelState[],
  key: DownloadSourceKey,
) {
  return downloadChannelState(states, key).enabled;
}

/** 当前渠道被关掉时，找一个还能用的；都关了返回 null。 */
export function pickAvailableDownloadChannel(
  states: readonly DownloadChannelState[],
  preferred: DownloadSourceKey,
): DownloadSourceKey | null {
  if (downloadChannelState(states, preferred).enabled) return preferred;
  const fallback = states.find((state) => state.enabled);
  return fallback ? fallback.key : null;
}

/**
 * 给玩家看的补充说明：只列**写明了关闭原因**的渠道。
 * "某个渠道被关"本身由右上角那条提示负责（当前渠道已关闭，请更换），这里不重复。
 * 整站维护信息走远程公告。
 */
export function downloadChannelNotice(
  states: readonly DownloadChannelState[],
  resolveName: (key: DownloadSourceKey) => string = (key) => key,
) {
  return states
    .filter((state) => !state.enabled && state.note)
    .map((state) => `${resolveName(state.key)}：${state.note}`)
    .join(" ");
}
