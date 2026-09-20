import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_CHANNELS_URL,
  downloadChannelNotice,
  isDownloadChannelEnabled,
  parseRemoteDownloadChannels,
  pickAvailableDownloadChannel,
  resolveDownloadChannelStates,
} from "../src/downloadChannels";

const CATALOG = ["official", "github"] as const;

describe("remote download channels", () => {
  it("parses the array shape the dev page publishes", () => {
    const parsed = parseRemoteDownloadChannels({
      schemaVersion: 1,
      channels: [
        { key: "official", enabled: false, note: "官方源维护中" },
        { key: "github", enabled: true, note: "" },
      ],
      publishedAt: 1789900000000,
    });
    expect(parsed?.channels).toHaveLength(2);
    expect(parsed?.channels[0]).toEqual({ key: "official", enabled: false, note: "官方源维护中" });
    expect(DOWNLOAD_CHANNELS_URL.endsWith("/launcher-download-channels.json")).toBe(true);
  });

  it("rejects a malformed document instead of guessing", () => {
    expect(parseRemoteDownloadChannels(null)).toBeNull();
    expect(parseRemoteDownloadChannels({ schemaVersion: 2, channels: [] })).toBeNull();
    expect(parseRemoteDownloadChannels({ schemaVersion: 1, channels: [] })).toBeNull();
    expect(
      parseRemoteDownloadChannels({ schemaVersion: 1, channels: [{ key: "official", enabled: "yes" }] }),
    ).toBeNull();
    expect(
      parseRemoteDownloadChannels({
        schemaVersion: 1,
        channels: [
          { key: "official", enabled: true },
          { key: "official", enabled: false },
        ],
      }),
    ).toBeNull();
    expect(
      parseRemoteDownloadChannels({ schemaVersion: 1, channels: [{ key: "Bad Key", enabled: true }] }),
    ).toBeNull();
  });

  it("keeps channels that the remote document does not mention open", () => {
    const states = resolveDownloadChannelStates(CATALOG, {
      schemaVersion: 1,
      channels: [{ key: "github", enabled: false, note: "备用源维护中" }],
      publishedAt: 1,
    });
    expect(isDownloadChannelEnabled(states, "official")).toBe(true);
    expect(isDownloadChannelEnabled(states, "github")).toBe(false);
    expect(downloadChannelNotice(states)).toContain("备用源维护中");
  });

  it("only lists closed channels that actually carry a note", () => {
    const states = resolveDownloadChannelStates(CATALOG, {
      schemaVersion: 1,
      channels: [
        { key: "official", enabled: false, note: "官方源维护" },
        { key: "github", enabled: false, note: "" },
      ],
      publishedAt: 2,
    });
    expect(pickAvailableDownloadChannel(states, "official")).toBeNull();
    // 没写原因的渠道不在这里出现（"被关"本身由右上角提示表达）。
    expect(downloadChannelNotice(states)).toBe("official：官方源维护");
    // 名称可注入，界面上显示的是本地化的渠道名。
    expect(downloadChannelNotice(states, (key) => `【${key}】`)).toBe("【official】：官方源维护");
  });

  it("accepts channels the launcher does not know yet and new local channels", () => {
    // 服务端先上线的新渠道：本地不认识，直接忽略。
    const withUnknown = parseRemoteDownloadChannels({
      schemaVersion: 1,
      channels: [
        { key: "official", enabled: true, note: "" },
        { key: "mirror-cn", enabled: false, note: "还没上线" },
      ],
      publishedAt: 3,
    });
    expect(resolveDownloadChannelStates(CATALOG, withUnknown)).toHaveLength(2);
    expect(isDownloadChannelEnabled(resolveDownloadChannelStates(CATALOG, withUnknown), "official")).toBe(true);

    // 本地新加的渠道、远端文档还没更新 → 默认开放，不会把所有人挡在门外。
    const newCatalog = ["official", "github", "mirror-cn"] as const;
    const states = resolveDownloadChannelStates(newCatalog, withUnknown);
    expect(resolveDownloadChannelStates(newCatalog, withUnknown)).toHaveLength(3);
    expect(isDownloadChannelEnabled(states, "mirror-cn")).toBe(false);
  });

  it("switches to an open channel when the selected one is closed", () => {
    const states = resolveDownloadChannelStates(CATALOG, {
      schemaVersion: 1,
      channels: [
        { key: "official", enabled: false, note: "官方源维护" },
        { key: "github", enabled: true, note: "" },
      ],
      publishedAt: 4,
    });
    expect(pickAvailableDownloadChannel(states, "official")).toBe("github");
    expect(pickAvailableDownloadChannel(states, "github")).toBe("github");
  });

  it("treats a missing document as 'everything open'", () => {
    const states = resolveDownloadChannelStates(CATALOG, null);
    expect(states.every((state) => state.enabled)).toBe(true);
    expect(pickAvailableDownloadChannel(states, "official")).toBe("official");
  });
});
