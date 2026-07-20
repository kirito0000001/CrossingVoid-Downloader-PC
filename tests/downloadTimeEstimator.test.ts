import { describe, expect, it } from "vitest";
import {
  DownloadTimeEstimator,
  formatDownloadSpeed,
  formatEtaClock,
} from "../src/downloadTimeEstimator";

const MiB = 1024 * 1024;

describe("DownloadTimeEstimator", () => {
  it("reports an estimate as soon as the first byte delta is available", () => {
    const estimator = new DownloadTimeEstimator();

    expect(estimator.record(0, 100 * MiB, 0)).toEqual({ status: "calculating" });
    expect(estimator.record(4 * MiB, 100 * MiB, 2_000)).toEqual({
      status: "ready",
      bytesPerSecond: 2 * MiB,
      remainingSeconds: 48,
    });
  });

  it("waits for a measurable time delta instead of dividing by zero", () => {
    const estimator = new DownloadTimeEstimator();
    estimator.record(0, 100 * MiB, 1_000);
    expect(estimator.record(1 * MiB, 100 * MiB, 1_000)).toEqual({ status: "calculating" });
  });

  it("uses the recent smoothing window instead of the latest event", () => {
    const estimator = new DownloadTimeEstimator({ windowMs: 10_000 });

    estimator.record(0, 100 * MiB, 0);
    estimator.record(8 * MiB, 100 * MiB, 4_000);
    estimator.record(10 * MiB, 100 * MiB, 8_000);
    const estimate = estimator.record(30 * MiB, 100 * MiB, 12_000);

    expect(estimate.status).toBe("ready");
    if (estimate.status !== "ready") return;
    expect(estimate.bytesPerSecond).toBeCloseTo(2.75 * MiB, 0);
  });

  it("reports a stalled download after no bytes move", () => {
    const estimator = new DownloadTimeEstimator();

    estimator.record(0, 100 * MiB, 0);
    estimator.record(8 * MiB, 100 * MiB, 4_000);

    expect(estimator.getEstimate(9_100)).toEqual({ status: "stalled" });
  });

  it("resets stale speed when the total changes or progress moves backward", () => {
    const estimator = new DownloadTimeEstimator();

    estimator.record(0, 100 * MiB, 0);
    expect(estimator.record(8 * MiB, 100 * MiB, 4_000).status).toBe("ready");
    expect(estimator.record(2 * MiB, 120 * MiB, 5_000)).toEqual({ status: "calculating" });
    expect(estimator.record(1 * MiB, 120 * MiB, 6_000)).toEqual({ status: "calculating" });
  });

  it("resets after a long gap so paused time does not lower the speed", () => {
    const estimator = new DownloadTimeEstimator({ resetGapMs: 15_000 });

    estimator.record(0, 100 * MiB, 0);
    expect(estimator.record(8 * MiB, 100 * MiB, 4_000).status).toBe("ready");
    expect(estimator.record(12 * MiB, 100 * MiB, 20_000)).toEqual({ status: "calculating" });
  });
});

describe("download estimate formatting", () => {
  it("formats speeds at a readable scale", () => {
    expect(formatDownloadSpeed(768 * 1024)).toBe("768 KB/s");
    expect(formatDownloadSpeed(5.25 * MiB)).toBe("5.3 MB/s");
  });

  it("formats remaining time as minutes and seconds", () => {
    expect(formatEtaClock(35)).toBe("00:35");
    expect(formatEtaClock(12 * 60 + 5)).toBe("12:05");
    expect(formatEtaClock(72 * 60)).toBe("72:00");
    expect(formatEtaClock(24 * 60 * 60)).toBe("1440:00");
    expect(formatEtaClock(24 * 60 * 60 + 1)).toBeNull();
  });
});
