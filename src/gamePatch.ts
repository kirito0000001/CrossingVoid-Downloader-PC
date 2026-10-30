/**
 * Windows 增量补丁（`patch-latest.json` / `patch.json`）。
 *
 * 发布侧（AxTools 的「发布 Windows 补丁」）生成的补丁包是**相对某个基础版本**的累积差分：
 * 包里平铺着游戏根目录相对路径的文件，外加 `patch.json` 与 `Version.json`。
 * 启动器只认 `patch.json` 里的 `path/sizeBytes/sha256`，包内多出来的文件一律不碰。
 *
 * 这份文件只管**纯逻辑**（解析、适用性、合并本地状态），下载与落盘在 Rust 的
 * `game_patch.rs` 里 —— 和碎片导入一样，状态归界面，字节归后端。
 */

import {
  compareGamePackageVersions,
  type GamePackageFile,
} from "./gamePackage";

export type GamePatchFile = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

/** `PC-Patch-Latest/patch-latest.json`：固定指针，只描述“当前最新补丁”。 */
export type GamePatchPointer = {
  schemaVersion: number;
  kind: "patch";
  productSegment: string;
  platform: string;
  version: string;
  /** 补丁适用的基础版本（发布侧写的是 `0.6` 这种两段式，本地一般是 `0.6.0`）。 */
  baseVersion: string;
  channel: string;
  manifestUrl: string;
  packageUrl: string;
  packageSizeBytes: number;
  packageSha256: string;
  generatedAt?: string;
};

export type GamePatchManifest = {
  schemaVersion: number;
  kind: "patch";
  productSegment: string;
  platform: string;
  version: string;
  baseVersion: string;
  channel: string;
  files: GamePatchFile[];
  generatedAt?: string;
};

/** `install_game_patch` 的返回：只报事实，界面自己组织文案。 */
export type GamePatchSummary = {
  appliedFiles: number;
  appliedBytes: number;
  skippedFiles: number;
  totalFiles: number;
  totalBytes: number;
  version: string;
  packagePath: string;
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asHttpUrl(value: unknown): string {
  const text = asTrimmedString(value);
  return /^https?:\/\//i.test(text) ? text : "";
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function asSha256(value: unknown): string {
  const text = asTrimmedString(value).toLowerCase();
  return SHA256_PATTERN.test(text) ? text : "";
}

function numericVersionParts(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

/**
 * 本地版本是否落在补丁的基础版本上。
 *
 * 发布侧写的基础版本是 `0.6`（Version.json 的 releaseVersion），本地标记是 `0.6.0`，
 * 所以按**数字段前缀**比：`0.6` 能匹配 `0.6.0`/`0.6.1`，但 `0.6` 不匹配 `0.60`。
 * 真正的兼容性还由导入前的本地就绪状态和每个文件的 sha256 兜底。
 */
export function versionMatchesBase(localVersion: string, baseVersion: string): boolean {
  const base = numericVersionParts(baseVersion);
  const local = numericVersionParts(localVersion);
  if (base.length === 0 || !baseVersion.trim() || !localVersion.trim()) return false;
  if (local.length < base.length) return false;
  return base.every((value, index) => local[index] === value);
}

/** 解析固定指针；字段不合格就整份作废（宁可当“没有补丁”，也不拿半份数据去下载）。 */
export function parseGamePatchPointer(raw: unknown): GamePatchPointer | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (Number(record.schemaVersion) !== 1) return null;
  if (asTrimmedString(record.kind) !== "patch") return null;

  const productSegment = asTrimmedString(record.productSegment);
  const platform = asTrimmedString(record.platform);
  const version = asTrimmedString(record.version);
  const baseVersion = asTrimmedString(record.baseVersion);
  const channel = asTrimmedString(record.channel);
  const manifestUrl = asHttpUrl(record.manifestUrl);
  const packageUrl = asHttpUrl(record.packageUrl);
  const packageSizeBytes = asPositiveInt(record.packageSizeBytes);
  const packageSha256 = asSha256(record.packageSha256);
  if (
    !productSegment ||
    !platform ||
    !version ||
    !baseVersion ||
    !channel ||
    !manifestUrl ||
    !packageUrl ||
    packageSizeBytes === null ||
    !packageSha256
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    kind: "patch",
    productSegment,
    platform,
    version,
    baseVersion,
    channel,
    manifestUrl,
    packageUrl,
    packageSizeBytes,
    packageSha256,
    ...(asTrimmedString(record.generatedAt)
      ? { generatedAt: asTrimmedString(record.generatedAt) }
      : {}),
  };
}

/** 解析补丁清单；版本必须和指针一致，否则就是发到一半的现场。 */
export function parseGamePatchManifest(
  raw: unknown,
  expectedVersion?: string,
): GamePatchManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (Number(record.schemaVersion) !== 1) return null;
  if (asTrimmedString(record.kind) !== "patch") return null;

  const version = asTrimmedString(record.version);
  const productSegment = asTrimmedString(record.productSegment);
  const platform = asTrimmedString(record.platform);
  const baseVersion = asTrimmedString(record.baseVersion);
  const channel = asTrimmedString(record.channel);
  if (!version || !productSegment || !platform || !baseVersion || !channel) return null;
  if (expectedVersion && version.toLowerCase() !== expectedVersion.trim().toLowerCase()) {
    return null;
  }

  const items = Array.isArray(record.files) ? record.files : [];
  const files: GamePatchFile[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const path = asTrimmedString(row.path).replace(/\\/g, "/");
    const sizeBytes = asPositiveInt(row.sizeBytes);
    const sha256 = asSha256(row.sha256);
    if (!path || sizeBytes === null || !sha256) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({ path, sizeBytes, sha256 });
  }
  if (files.length === 0) return null;

  return {
    schemaVersion: 1,
    kind: "patch",
    productSegment,
    platform,
    version,
    baseVersion,
    channel,
    files,
    ...(asTrimmedString(record.generatedAt)
      ? { generatedAt: asTrimmedString(record.generatedAt) }
      : {}),
  };
}

export type GamePatchPlan = {
  applies: boolean;
  /** 给日志/测试看的判定依据；界面不直接显示。 */
  reason:
    | "no-pointer"
    | "no-local-version"
    | "product-mismatch"
    | "platform-mismatch"
    | "channel-mismatch"
    | "base-mismatch"
    | "not-newer"
    | "ok";
};

/**
 * 这个补丁能不能应用到当前安装上。
 *
 * 门槛刻意保守：产品段/平台/通道都要对得上，本地版本必须落在基础版本上，
 * 而且补丁版本要比本地新。任何一条不满足都退回完整更新，而不是硬套补丁。
 */
export function resolveGamePatchPlan(options: {
  pointer: GamePatchPointer | null;
  localVersion: string;
  productSegment: string;
  platform?: string;
  channel?: string;
}): GamePatchPlan {
  const { pointer } = options;
  if (!pointer) return { applies: false, reason: "no-pointer" };
  const localVersion = options.localVersion.trim();
  if (!localVersion) return { applies: false, reason: "no-local-version" };
  if (pointer.productSegment.toLowerCase() !== options.productSegment.trim().toLowerCase()) {
    return { applies: false, reason: "product-mismatch" };
  }
  const platform = (options.platform ?? "Windows").trim();
  if (pointer.platform.toLowerCase() !== platform.toLowerCase()) {
    return { applies: false, reason: "platform-mismatch" };
  }
  const channel = (options.channel ?? "stable").trim();
  if (pointer.channel.toLowerCase() !== channel.toLowerCase()) {
    return { applies: false, reason: "channel-mismatch" };
  }
  if (!versionMatchesBase(localVersion, pointer.baseVersion)) {
    return { applies: false, reason: "base-mismatch" };
  }
  if (compareGamePackageVersions(pointer.version, localVersion) <= 0) {
    return { applies: false, reason: "not-newer" };
  }
  return { applies: true, reason: "ok" };
}

function normalizePatchPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
}

/**
 * 把补丁文件并进本地状态清单：同路径替换，新路径追加。
 *
 * 补丁是累积差分：应用后本地状态 = 基础清单 + 本次补丁覆盖过的文件。这份合并结果要写回
 * `launcher.game.json`，否则下一次“核对本地文件”会拿旧哈希把刚打上的文件判成损坏。
 */
export function mergeGamePatchFiles(
  baseFiles: GamePackageFile[],
  patchFiles: GamePatchFile[],
): GamePackageFile[] {
  const order: string[] = [];
  const byKey = new Map<string, GamePackageFile>();
  for (const file of baseFiles) {
    const key = normalizePatchPath(file.path);
    if (!key) continue;
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, file);
  }
  for (const file of patchFiles) {
    const key = normalizePatchPath(file.path);
    if (!key) continue;
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, { path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 });
  }
  return order.map((key) => byKey.get(key) as GamePackageFile);
}

/** 补丁里新加的文件（基础清单里没有），用于日志/诊断。 */
export function gamePatchAddedPaths(
  baseFiles: GamePackageFile[],
  patchFiles: GamePatchFile[],
): string[] {
  const known = new Set(baseFiles.map((file) => normalizePatchPath(file.path)));
  return patchFiles
    .filter((file) => !known.has(normalizePatchPath(file.path)))
    .map((file) => file.path);
}
