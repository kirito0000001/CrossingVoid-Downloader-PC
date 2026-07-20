export type DownloadEstimate =
  | { status: "calculating" }
  | { status: "ready"; bytesPerSecond: number; remainingSeconds: number }
  | { status: "stalled" }
  | { status: "complete" };

type DownloadSample = {
  downloadedBytes: number;
  timeMs: number;
};

type DownloadTimeEstimatorOptions = {
  windowMs?: number;
  minimumSampleMs?: number;
  stallMs?: number;
  resetGapMs?: number;
};

export class DownloadTimeEstimator {
  private readonly windowMs: number;
  private readonly minimumSampleMs: number;
  private readonly stallMs: number;
  private readonly resetGapMs: number;
  private samples: DownloadSample[] = [];
  private totalBytes = 0;
  private lastDownloadedBytes = 0;
  private lastObservationMs: number | null = null;
  private lastProgressMs: number | null = null;

  constructor(options: DownloadTimeEstimatorOptions = {}) {
    this.windowMs = options.windowMs ?? 10_000;
    this.minimumSampleMs = options.minimumSampleMs ?? 0;
    this.stallMs = options.stallMs ?? 5_000;
    this.resetGapMs = options.resetGapMs ?? 15_000;
  }

  reset() {
    this.samples = [];
    this.totalBytes = 0;
    this.lastDownloadedBytes = 0;
    this.lastObservationMs = null;
    this.lastProgressMs = null;
  }

  record(downloadedBytes: number, totalBytes: number, timeMs = Date.now()): DownloadEstimate {
    const downloaded = Math.max(0, downloadedBytes);
    const total = Math.max(0, totalBytes);
    const taskChanged = this.totalBytes > 0 && total !== this.totalBytes;
    const progressMovedBackward = this.lastObservationMs !== null && downloaded < this.lastDownloadedBytes;
    const observationGap = this.lastObservationMs === null ? 0 : timeMs - this.lastObservationMs;

    if (taskChanged || progressMovedBackward || observationGap >= this.resetGapMs) {
      this.reset();
    }

    this.totalBytes = total;
    this.lastObservationMs = timeMs;

    if (this.samples.length === 0) {
      this.samples.push({ downloadedBytes: downloaded, timeMs });
      this.lastDownloadedBytes = downloaded;
      this.lastProgressMs = timeMs;
      return this.getEstimate(timeMs);
    }

    if (downloaded > this.lastDownloadedBytes) {
      this.samples.push({ downloadedBytes: downloaded, timeMs });
      this.lastProgressMs = timeMs;
      const cutoff = timeMs - this.windowMs;
      this.samples = this.samples.filter((sample) => sample.timeMs >= cutoff);
    }

    this.lastDownloadedBytes = downloaded;
    return this.getEstimate(timeMs);
  }

  getEstimate(timeMs = Date.now()): DownloadEstimate {
    if (this.totalBytes > 0 && this.lastDownloadedBytes >= this.totalBytes) {
      return { status: "complete" };
    }

    if (this.lastProgressMs !== null && timeMs - this.lastProgressMs >= this.stallMs) {
      return { status: "stalled" };
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return { status: "calculating" };

    const elapsedMs = last.timeMs - first.timeMs;
    const downloadedDelta = last.downloadedBytes - first.downloadedBytes;
    if (elapsedMs <= 0 || elapsedMs < this.minimumSampleMs || downloadedDelta <= 0) {
      return { status: "calculating" };
    }

    const bytesPerSecond = (downloadedDelta * 1_000) / elapsedMs;
    const remainingBytes = Math.max(0, this.totalBytes - this.lastDownloadedBytes);
    return {
      status: "ready",
      bytesPerSecond,
      remainingSeconds: Math.ceil(remainingBytes / bytesPerSecond),
    };
  }
}

export function formatDownloadSpeed(bytesPerSecond: number) {
  const speed = Math.max(0, bytesPerSecond);
  const kibibytes = speed / 1024;
  if (kibibytes < 1024) return `${Math.round(kibibytes)} KB/s`;
  return `${(kibibytes / 1024).toFixed(1)} MB/s`;
}

export function formatEtaClock(seconds: number) {
  const roundedSeconds = Math.max(0, Math.ceil(seconds));
  if (roundedSeconds > 24 * 60 * 60) return null;
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
