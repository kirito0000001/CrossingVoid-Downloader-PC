import { describe, expect, it } from "vitest";

import {
  canLaunchLocalGame,
  canUseLauncherNetwork,
} from "../src/launcherNetworkPolicy";

describe("launcher network policy", () => {
  it("allows network operations only after the launcher is verified current", () => {
    expect(canUseLauncherNetwork("ready")).toBe(true);
    expect(canUseLauncherNetwork("checking")).toBe(false);
    expect(canUseLauncherNetwork("verificationFailed")).toBe(false);
    expect(canUseLauncherNetwork("updateRequired")).toBe(false);
  });

  it("keeps an installed game locally playable while network access is locked", () => {
    expect(canLaunchLocalGame("updateRequired", true)).toBe(true);
    expect(canLaunchLocalGame("verificationFailed", true)).toBe(true);
    expect(canLaunchLocalGame("checking", true)).toBe(true);
    expect(canLaunchLocalGame("updateRequired", false)).toBe(false);
  });
});
