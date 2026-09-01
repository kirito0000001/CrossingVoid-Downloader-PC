export type LauncherUpdateGate =
  | "checking"
  | "ready"
  | "updateRequired"
  | "verificationFailed";

export function canUseLauncherNetwork(gate: LauncherUpdateGate) {
  return gate === "ready";
}

export function canLaunchLocalGame(gate: LauncherUpdateGate, installed: boolean) {
  return installed && !canUseLauncherNetwork(gate);
}
