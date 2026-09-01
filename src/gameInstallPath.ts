export const GAME_CONTAINER_DIRECTORY_NAME = "TFAC-hz64";
export const GAME_DIRECTORY_NAME = "CrossingVoid";
export const DEFAULT_GAME_STORAGE_ROOT = "D:\\";
export const DEFAULT_GAME_INSTALL_PATH =
  `${DEFAULT_GAME_STORAGE_ROOT}${GAME_CONTAINER_DIRECTORY_NAME}\\${GAME_DIRECTORY_NAME}`;

function trimPath(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.replace(/[\\/]+$/, "");
}

function appendPath(base: string, child: string) {
  return `${base}${base.endsWith("\\") ? "" : "\\"}${child}`;
}

export function buildGameInstallPath(storagePath: string) {
  const normalized = trimPath(storagePath);
  if (!normalized) return DEFAULT_GAME_INSTALL_PATH;
  if (new RegExp(`${GAME_DIRECTORY_NAME}$`, "i").test(normalized)) return normalized;
  if (new RegExp(`${GAME_CONTAINER_DIRECTORY_NAME}$`, "i").test(normalized)) {
    return appendPath(normalized, GAME_DIRECTORY_NAME);
  }
  return appendPath(
    appendPath(normalized, GAME_CONTAINER_DIRECTORY_NAME),
    GAME_DIRECTORY_NAME,
  );
}

export function inferGameStorageRoot(gamePath: string) {
  const normalized = trimPath(gamePath);
  if (!normalized) return DEFAULT_GAME_STORAGE_ROOT;
  if (!new RegExp(`${GAME_DIRECTORY_NAME}$`, "i").test(normalized)) return normalized;

  const containerPath = normalized.replace(
    new RegExp(`[\\\\/]${GAME_DIRECTORY_NAME}$`, "i"),
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
