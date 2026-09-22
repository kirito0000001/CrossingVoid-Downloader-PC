export const GAME_CONTAINER_DIRECTORY_NAME = "TFAC-hz64";
export const GAME_DIRECTORY_NAME = "CrossingVoid";
export const DEFAULT_GAME_STORAGE_ROOT = "D:\\";
export const DEFAULT_GAME_INSTALL_PATH =
  `${DEFAULT_GAME_STORAGE_ROOT}${GAME_CONTAINER_DIRECTORY_NAME}\\${GAME_DIRECTORY_NAME}`;

/**
 * 某一档游戏的默认安装目录。
 *
 * 每档游戏在下载站/清单里都有各自的 `installDirectoryName`（见 `platform/gameCatalog.ts`），
 * 这里只是把它拼成 `<存储根>\TFAC-hz64\<目录名>` —— 容器目录共用，游戏目录各一份。
 */
export function defaultGameInstallPath(directoryName: string = GAME_DIRECTORY_NAME) {
  return `${DEFAULT_GAME_STORAGE_ROOT}${GAME_CONTAINER_DIRECTORY_NAME}\\${directoryName.trim() || GAME_DIRECTORY_NAME}`;
}

function trimPath(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.replace(/[\\/]+$/, "");
}

function appendPath(base: string, child: string) {
  return `${base}${base.endsWith("\\") ? "" : "\\"}${child}`;
}

export function buildGameInstallPath(
  storagePath: string,
  directoryName: string = GAME_DIRECTORY_NAME,
) {
  const gameDirectoryName = directoryName.trim() || GAME_DIRECTORY_NAME;
  const normalized = trimPath(storagePath);
  if (!normalized) return defaultGameInstallPath(gameDirectoryName);
  if (new RegExp(`${gameDirectoryName}$`, "i").test(normalized)) return normalized;
  if (new RegExp(`${GAME_CONTAINER_DIRECTORY_NAME}$`, "i").test(normalized)) {
    return appendPath(normalized, gameDirectoryName);
  }
  return appendPath(
    appendPath(normalized, GAME_CONTAINER_DIRECTORY_NAME),
    gameDirectoryName,
  );
}

export function inferGameStorageRoot(
  gamePath: string,
  directoryName: string = GAME_DIRECTORY_NAME,
) {
  const gameDirectoryName = directoryName.trim() || GAME_DIRECTORY_NAME;
  const normalized = trimPath(gamePath);
  if (!normalized) return DEFAULT_GAME_STORAGE_ROOT;
  if (!new RegExp(`${gameDirectoryName}$`, "i").test(normalized)) return normalized;

  const containerPath = normalized.replace(
    new RegExp(`[\\\\/]${gameDirectoryName}$`, "i"),
    "",
  );
  if (!new RegExp(`${GAME_CONTAINER_DIRECTORY_NAME}$`, "i").test(containerPath)) {
    return containerPath || normalized;
  }
  const storageRoot = containerPath.replace(
    new RegExp(`[\\\\/]${GAME_CONTAINER_DIRECTORY_NAME}$`, "i"),
    "",
  );
  return trimPath(storageRoot) || DEFAULT_GAME_STORAGE_ROOT;
}

export function isSameWindowsVolume(left: string, right: string) {
  const leftDrive = /^([A-Za-z]):/.exec(left.trim())?.[1]?.toLowerCase();
  const rightDrive = /^([A-Za-z]):/.exec(right.trim())?.[1]?.toLowerCase();
  return Boolean(leftDrive && rightDrive && leftDrive === rightDrive);
}
