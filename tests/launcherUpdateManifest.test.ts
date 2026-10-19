import { describe, expect, it } from "vitest";
import {
  compareLauncherVersions,
  isPcLauncherUpdateAvailable,
  parsePcLauncherInstallerManifest,
  PC_LAUNCHER_INSTALLER_MANIFEST_URL,
  PC_LAUNCHER_INSTALLER_PRODUCT_KEY,
} from "../src/launcherUpdateManifest";

const VALID_SHA256 = "59874e904a8aa61968d355e319dd74baa76351bf2c582e00cb5e77ba3ba5de2f";

function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    productKey: PC_LAUNCHER_INSTALLER_PRODUCT_KEY,
    versionName: "1.5.0",
    versionCode: 1,
    notes: "零境启动器 1.5.0",
    publishedAt: "2026-10-19T12:00:00.0000000Z",
    asset: {
      fileName: "零境启动器_1.5.0_x64-setup.exe",
      url: "https://gitee.com/xiaojie578/CrossingVoid-Launcher-PC/releases/download/launcher-v1.5.0/a.exe",
      sizeBytes: 44_477_773,
      sha256: VALID_SHA256,
      signature: "dHJ1c3RlZAo=",
    },
    ...overrides,
  };
}

describe("launcherUpdateManifest", () => {
  it("points at the website mirror instead of gitee raw", () => {
    expect(PC_LAUNCHER_INSTALLER_MANIFEST_URL).toBe(
      "https://www.crossingvoid.top/manifests/launcher/pc-installer-latest.json",
    );
    expect(PC_LAUNCHER_INSTALLER_MANIFEST_URL).not.toContain("gitee.com");
  });

  it("parses a valid manifest, including a BOM-prefixed string payload", () => {
    const parsed = parsePcLauncherInstallerManifest(`\uFEFF${JSON.stringify(sampleManifest())}`);
    expect(parsed.versionName).toBe("1.5.0");
    expect(parsed.asset.fileName).toBe("零境启动器_1.5.0_x64-setup.exe");
    expect(parsed.asset.sizeBytes).toBe(44_477_773);
    expect(parsed.asset.sha256).toBe(VALID_SHA256);
    expect(parsed.asset.signature).toBe("dHJ1c3RlZAo=");
  });

  it("rejects manifests that would let the wrong thing install", () => {
    expect(() => parsePcLauncherInstallerManifest("not json")).toThrow(/无法解析/);
    expect(() =>
      parsePcLauncherInstallerManifest(sampleManifest({ productKey: "crossingvoid-launcher" })),
    ).toThrow(/产品标识/);
    expect(() =>
      parsePcLauncherInstallerManifest(sampleManifest({ schemaVersion: 2 })),
    ).toThrow(/版本不受支持/);
    expect(() =>
      parsePcLauncherInstallerManifest(sampleManifest({ versionName: "1.5" })),
    ).toThrow(/版本号/);
    expect(() =>
      parsePcLauncherInstallerManifest(
        sampleManifest({ asset: { fileName: "a.exe", url: "", sizeBytes: 1, sha256: VALID_SHA256 } }),
      ),
    ).toThrow(/asset.url/);
    expect(() =>
      parsePcLauncherInstallerManifest(
        sampleManifest({ asset: { fileName: "a.exe", url: "https://x/a.exe", sizeBytes: 1, sha256: "abc" } }),
      ),
    ).toThrow(/SHA256/);
    expect(() =>
      parsePcLauncherInstallerManifest(
        sampleManifest({ asset: { fileName: "a.exe", url: "https://x/a.exe", sizeBytes: 0, sha256: VALID_SHA256 } }),
      ),
    ).toThrow(/sizeBytes/);
  });

  it("compares versions the way the build script sorts them", () => {
    expect(compareLauncherVersions("1.5.0", "1.4.0")).toBeGreaterThan(0);
    expect(compareLauncherVersions("1.4.0", "1.5.0")).toBeLessThan(0);
    expect(compareLauncherVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareLauncherVersions("1.4.10", "1.4.9")).toBeGreaterThan(0);
    expect(compareLauncherVersions("1.5", "1.5.0")).toBe(0);
    // 预发布版小于同号正式版。
    expect(compareLauncherVersions("1.5.0-Beta", "1.5.0")).toBeLessThan(0);
    expect(compareLauncherVersions("1.5.0", "1.5.0-Beta")).toBeGreaterThan(0);
  });

  it("only offers updates when the manifest is newer than the running version", () => {
    const manifest = parsePcLauncherInstallerManifest(sampleManifest());
    expect(isPcLauncherUpdateAvailable("1.4.0", manifest)).toBe(true);
    expect(isPcLauncherUpdateAvailable("1.5.0", manifest)).toBe(false);
    expect(isPcLauncherUpdateAvailable("1.6.0", manifest)).toBe(false);
  });
});
