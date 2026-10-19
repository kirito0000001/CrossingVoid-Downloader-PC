import { invoke } from "@tauri-apps/api/core";

/**
 * 扁平启动器更新清单（与零境 Android 启动器同款形态）。
 *
 * 历史：PC 端原本只读 Tauri updater 的 `latest.json` 端点，那是编译期写死的地址，
 * 换成静态清单以后，清单本身可以在服务端换内容、换仓库，不用再发版。
 */
export const PC_LAUNCHER_INSTALLER_PRODUCT_KEY = "crossingvoid-launcher-pc-installer";

/**
 * 扁平清单地址：站点静态文件。发布脚本会同时写 Gitee 仓库与 www 镜像，
 * 客户端只读 www —— Gitee raw 有缓存、且仓库被判定 RAW 外链滥用后会直接 403。
 */
export const PC_LAUNCHER_INSTALLER_MANIFEST_URL =
  "https://www.crossingvoid.top/manifests/launcher/pc-installer-latest.json";

export type PcLauncherInstallAsset = {
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
  /** 预留：发布脚本会把 minisign 签名一起写进来，方便以后前端自行校验。 */
  signature?: string;
};

export type PcLauncherInstallerManifest = {
  schemaVersion: 1;
  productKey: typeof PC_LAUNCHER_INSTALLER_PRODUCT_KEY;
  versionName: string;
  versionCode: number;
  notes: string;
  publishedAt: string;
  asset: PcLauncherInstallAsset;
};

/** 与构建脚本一致：三段数字，允许 `-Beta` 这类预发布后缀。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function decodeManifestPayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  const text = payload.replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("启动器更新清单 JSON 无法解析");
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`启动器更新清单缺少 ${label}`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`启动器更新清单的 ${label} 无效`);
  }
  return parsed;
}

export function parsePcLauncherInstallerManifest(
  payload: unknown,
): PcLauncherInstallerManifest {
  const source = asRecord(decodeManifestPayload(payload));
  const asset = asRecord(source?.asset);
  if (!source || !asset) throw new Error("启动器更新清单格式无效");
  if (Number(source.schemaVersion) !== 1) throw new Error("启动器更新清单版本不受支持");
  if (source.productKey !== PC_LAUNCHER_INSTALLER_PRODUCT_KEY) {
    throw new Error("启动器更新产品标识不正确");
  }

  const versionName = requireString(source.versionName, "versionName");
  if (!VERSION_PATTERN.test(versionName)) throw new Error("启动器版本号格式无效");
  const sizeBytes = requirePositiveInteger(asset.sizeBytes, "asset.sizeBytes");
  const sha256 = requireString(asset.sha256, "asset.sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("启动器安装包 SHA256 无效");

  return {
    schemaVersion: 1,
    productKey: PC_LAUNCHER_INSTALLER_PRODUCT_KEY,
    versionName,
    versionCode: Number.isSafeInteger(Number(source.versionCode))
      ? Number(source.versionCode)
      : 1,
    notes: typeof source.notes === "string" ? source.notes : "",
    publishedAt: typeof source.publishedAt === "string" ? source.publishedAt : "",
    asset: {
      fileName: requireString(asset.fileName, "asset.fileName"),
      url: requireString(asset.url, "asset.url"),
      sizeBytes,
      sha256,
      ...(typeof asset.signature === "string" && asset.signature.trim()
        ? { signature: asset.signature.trim() }
        : {}),
    },
  };
}

function splitVersion(value: string): { parts: number[]; prerelease: string } {
  const trimmed = value.trim();
  const dashIndex = trimmed.indexOf("-");
  const core = dashIndex >= 0 ? trimmed.slice(0, dashIndex) : trimmed;
  const prerelease = dashIndex >= 0 ? trimmed.slice(dashIndex + 1) : "";
  const parts = core.split(".").map((item) => {
    const parsed = Number.parseInt(item, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { parts, prerelease };
}

/** 大于 0 表示 left 更新；与 Tauri/构建脚本的 SemVer 口径一致（预发布版小于正式版）。 */
export function compareLauncherVersions(left: string, right: string): number {
  const a = splitVersion(left);
  const b = splitVersion(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.parts[index] ?? 0;
    const rightPart = b.parts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease > b.prerelease ? 1 : -1;
}

export function isPcLauncherUpdateAvailable(
  currentVersion: string,
  manifest: PcLauncherInstallerManifest,
): boolean {
  return compareLauncherVersions(manifest.versionName, currentVersion) > 0;
}

/**
 * 拉取扁平清单。Rust 侧 `fetch_remote_text` 负责 HTTPS（WebView 直连站点会撞 CORS），
 * 这里补 `?t=` 破掉 IIS/中间层缓存。
 */
export async function fetchPcLauncherInstallerManifest(): Promise<PcLauncherInstallerManifest> {
  const separator = PC_LAUNCHER_INSTALLER_MANIFEST_URL.includes("?") ? "&" : "?";
  const text = await invoke<string>("fetch_remote_text", {
    url: `${PC_LAUNCHER_INSTALLER_MANIFEST_URL}${separator}t=${Date.now()}`,
  });
  return parsePcLauncherInstallerManifest(text);
}
