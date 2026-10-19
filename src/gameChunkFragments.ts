/**
 * 碎片包清单（`fragments/<version>.json`）：告诉启动器“这一版应该有哪几个包”。
 *
 * 游戏清单只描述安装后的那 179 个文件，不知道它们被打成了几个 zip；
 * 这份清单补的就是这一层信息。它只负责界面上的“齐没齐”，
 * 真正的裁判仍然是导入时逐个文件的 sha256 —— 包名对不上也照样能导。
 */

export type GameChunkFragment = {
  fileName: string;
  sizeBytes: number;
  fileCount: number;
};

export type GameChunkFragments = {
  schemaVersion: number;
  version: string;
  totalBytes: number;
  fragments: GameChunkFragment[];
};

/** `inspect_game_chunk_files` 的返回：只报事实，绿/黄/红由界面算。 */
export type GameChunkFileInspection = {
  path: string;
  fileName: string;
  sizeBytes: number;
  isZip: boolean;
  entryCount: number;
  error?: string;
};

export type ChunkSelectionStatus =
  | "ready"
  | "renamed"
  | "size-mismatch"
  | "invalid"
  | "missing";

export type ChunkSelectionRow = {
  fileName: string;
  expectedBytes: number;
  expectedFiles: number;
  status: ChunkSelectionStatus;
  selectedPath?: string;
  actualBytes?: number;
};

export type ChunkSelection = {
  rows: ChunkSelectionRow[];
  /** 选了、但和这一版清单对不上的文件（旧版本混进来、或者压根不是 zip）。 */
  unexpected: GameChunkFileInspection[];
  readyCount: number;
  /** 真正会交给 Rust 的路径：名字对上且大小对，或者改名但大小唯一对上。 */
  importablePaths: string[];
  allReady: boolean;
};

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * 解析并校验碎片清单。
 *
 * 版本不一致直接判无效：宁可退化成“直接选文件”，也不能把上一版的包名摆给玩家，
 * 那会让他以为下错了。`expectedVersion` 来自版本指针，和清单同一个真相源。
 */
export function parseGameChunkFragments(
  raw: unknown,
  expectedVersion?: string,
): GameChunkFragments | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (Number(record.schemaVersion) !== 1) return null;
  const version = typeof record.version === "string" ? record.version.trim() : "";
  if (!version) return null;
  if (expectedVersion && version.toLowerCase() !== expectedVersion.trim().toLowerCase()) {
    return null;
  }

  const items = Array.isArray(record.fragments) ? record.fragments : [];
  const fragments: GameChunkFragment[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const fileName = typeof row.fileName === "string" ? row.fileName.trim() : "";
    const sizeBytes = asPositiveInt(row.sizeBytes);
    const fileCount = asNonNegativeInt(row.fileCount);
    if (!fileName || sizeBytes === null || fileCount === null) continue;
    fragments.push({ fileName, sizeBytes, fileCount });
  }
  if (fragments.length === 0) return null;

  const declaredTotal = asPositiveInt(record.totalBytes);
  const totalBytes = declaredTotal ?? fragments.reduce((sum, item) => sum + item.sizeBytes, 0);
  return { schemaVersion: 1, version, totalBytes, fragments };
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * 把“选中的文件”对到“这一版应该有的包”。
 *
 * 两步认亲，和导入器保持同一套宽容度：
 *   ① 包名对上 → 再看大小；大小不对就是没下完（黄）。
 *   ② 包名被改过 → 大小能**唯一**对上的照样认（绿），因为导入器只看条目名，
 *      改名不影响结果。大小撞车（两个包一样大）时不敢猜，留给玩家重新选。
 */
export function matchChunkSelection(
  fragments: GameChunkFragment[],
  inspections: GameChunkFileInspection[],
): ChunkSelection {
  const rows: ChunkSelectionRow[] = fragments.map((fragment) => ({
    fileName: fragment.fileName,
    expectedBytes: fragment.sizeBytes,
    expectedFiles: fragment.fileCount,
    status: "missing",
  }));
  const consumed = new Set<string>();

  for (const row of rows) {
    const inspection = inspections.find(
      (item) =>
        !consumed.has(item.path) &&
        normalizeName(item.fileName) === normalizeName(row.fileName),
    );
    if (!inspection) continue;
    consumed.add(inspection.path);
    row.selectedPath = inspection.path;
    row.actualBytes = inspection.sizeBytes;
    if (!inspection.isZip) {
      row.status = "invalid";
    } else if (inspection.sizeBytes === row.expectedBytes) {
      row.status = "ready";
    } else {
      row.status = "size-mismatch";
    }
  }

  for (const row of rows) {
    if (row.selectedPath) continue;
    const sameSizeRows = rows.filter((other) => other.expectedBytes === row.expectedBytes).length;
    if (sameSizeRows !== 1) continue;
    const candidates = inspections.filter(
      (item) => !consumed.has(item.path) && item.isZip && item.sizeBytes === row.expectedBytes,
    );
    if (candidates.length !== 1) continue;
    const inspection = candidates[0];
    consumed.add(inspection.path);
    row.selectedPath = inspection.path;
    row.actualBytes = inspection.sizeBytes;
    row.status = "renamed";
  }

  const unexpected = inspections.filter((item) => !consumed.has(item.path));
  const importablePaths = rows
    .filter((row) => (row.status === "ready" || row.status === "renamed") && row.selectedPath)
    .map((row) => row.selectedPath as string);
  const readyCount = importablePaths.length;

  return {
    rows,
    unexpected,
    readyCount,
    importablePaths,
    allReady: rows.length > 0 && readyCount === rows.length,
  };
}

/** 没有碎片清单时的退路：只要是个能打开的 zip 就先收下，缺什么由导入结果说话。 */
export function importablePathsWithoutManifest(inspections: GameChunkFileInspection[]) {
  return inspections.filter((item) => item.isZip && !item.error).map((item) => item.path);
}
