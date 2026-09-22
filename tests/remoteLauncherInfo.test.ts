import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_CHANNELS_URL,
  LAUNCHER_NOTICE_URL,
  REMOTE_LAUNCHER_INFO_CORE_VERSION,
  downloadChannelNotice,
  isDownloadChannelEnabled,
  parseRemoteDownloadChannels,
  parseRemoteLauncherNotice,
  pickAvailableDownloadChannel,
  resolveDownloadChannelStates,
} from "../src/remoteLauncherInfo";

const CATALOG = ["official", "github"] as const;

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

/**
 * 共用内核守卫：`src/remoteLauncherInfo.ts` 与安卓仓库里的
 * `src/services/remoteLauncherInfo.ts` **逐字相同**（换行按 LF 计算）。
 * 安卓端只接收 PC 开发页发布的信息，靠的就是这一份解析逻辑。
 */
describe("shared remote launcher info core", () => {
  it("keeps the core file identical across repos (hash check)", () => {
    const source = readFileSync(resolve(process.cwd(), "src/remoteLauncherInfo.ts"), "utf8")
      .split("\r\n")
      .join("\n");
    // 2026-09-22：公告与渠道开关改成按档位（`notices/<id>.json` / `channels/<id>.json`），
    // 契约版本抬到 2。这一版只改了 PC；安卓端不做平台，保持读老文件。
    expect(REMOTE_LAUNCHER_INFO_CORE_VERSION).toBe("2");
    expect(createHash("sha256").update(source, "utf8").digest("hex")).toBe(
      "b0fae3fb4d76c0af485ae9013d2bbf1eca0e5a80feeefbff5f9decd626eb74c9",
    );
  });

  it("keeps the published URLs in one place for both platforms", () => {
    expect(LAUNCHER_NOTICE_URL).toBe("https://www.crossingvoid.top/launcher-notice.json");
    expect(DOWNLOAD_CHANNELS_URL).toBe("https://www.crossingvoid.top/launcher-download-channels.json");
    // App.vue 不许再自己写一份解析；公告地址也只从共用内核取。
    expect(appSource).not.toContain("function parseRemoteLauncherNotice");
    expect(appSource).not.toContain("crossingvoid.top/launcher-notice.json");
    expect(appSource).toContain("parseRemoteLauncherNotice");
  });
});

describe("remote launcher notice", () => {
  it("parses the notice the dev page publishes", () => {
    const notice = parseRemoteLauncherNotice({
      schemaVersion: 1,
      id: "notice-1789902223135",
      enabled: true,
      level: "info",
      title: " 维护公告 ",
      content: " 暂不开放下载 ",
      publishedAt: 1789902223135,
    });
    expect(notice).toEqual({
      schemaVersion: 1,
      id: "notice-1789902223135",
      enabled: true,
      level: "info",
      title: "维护公告",
      content: "暂不开放下载",
      publishedAt: 1789902223135,
    });
  });

  it("rejects a notice that would render as an empty popup", () => {
    const base = {
      schemaVersion: 1,
      id: "notice-1",
      enabled: true,
      level: "info",
      title: "标题",
      content: "正文",
      publishedAt: 1,
    };
    expect(parseRemoteLauncherNotice(null)).toBeNull();
    expect(parseRemoteLauncherNotice({ ...base, schemaVersion: 2 })).toBeNull();
    expect(parseRemoteLauncherNotice({ ...base, id: "   " })).toBeNull();
    expect(parseRemoteLauncherNotice({ ...base, level: "debug" })).toBeNull();
    expect(parseRemoteLauncherNotice({ ...base, title: "  " })).toBeNull();
    expect(parseRemoteLauncherNotice({ ...base, publishedAt: "now" })).toBeNull();
    // 关掉的公告允许空标题/空正文（"没有公告"就是这种形态）。
    expect(parseRemoteLauncherNotice({ ...base, enabled: false, title: "", content: "" })?.enabled).toBe(false);
  });
});

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
    // 没写原因的渠道不在这里出现（"被关"本身由当前渠道的提示表达）。
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
