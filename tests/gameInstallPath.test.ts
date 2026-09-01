import { describe, expect, it } from "vitest";

import {
  buildGameInstallPath,
  inferGameStorageRoot,
  isSameWindowsVolume,
} from "../src/gameInstallPath";

describe("game install path", () => {
  it("keeps the TFAC-hz64 container under a selected storage location", () => {
    expect(buildGameInstallPath("D:\\NewData")).toBe(
      "D:\\NewData\\TFAC-hz64\\CrossingVoid",
    );
  });

  it("does not duplicate an existing container or complete game path", () => {
    expect(buildGameInstallPath("D:\\NewData\\TFAC-hz64")).toBe(
      "D:\\NewData\\TFAC-hz64\\CrossingVoid",
    );
    expect(buildGameInstallPath("D:\\NewData\\TFAC-hz64\\CrossingVoid")).toBe(
      "D:\\NewData\\TFAC-hz64\\CrossingVoid",
    );
  });

  it("recovers the selectable storage location from a complete game path", () => {
    expect(inferGameStorageRoot("D:\\NewData\\TFAC-hz64\\CrossingVoid")).toBe(
      "D:\\NewData",
    );
  });

  it("compares Windows volumes without treating folder changes as cross-volume", () => {
    expect(isSameWindowsVolume("D:\\TFAC-hz64\\CrossingVoid", "D:\\NewData\\TFAC-hz64\\CrossingVoid")).toBe(true);
    expect(isSameWindowsVolume("D:\\TFAC-hz64\\CrossingVoid", "E:\\Games\\TFAC-hz64\\CrossingVoid")).toBe(false);
  });
});
