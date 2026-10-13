import { readFileSync } from 'node:fs';

/**
 * How close the container is to its memory ceiling.
 *
 * The all-in-one container runs api, worker and the bot on a 512 MB free
 * plan, and the worker's own footprint had never been measured — while the
 * coin scan now parses ~15 MB of DefiLlama JSON once a day. A host that
 * kills the container for memory restarts it with no trace beyond a fresh
 * boot time, so the only way to see it coming is to report the number.
 *
 * The container's usage comes from its cgroup (v2, then v1) because that
 * is what the host's limit is enforced against — it counts the api and
 * the bot too. The worker's own RSS is reported beside it, with the
 * highest value seen since boot, so a daily spike is visible even between
 * minute-apart heartbeats.
 */

export interface MemoryReport {
  /** The worker process's resident memory now, MB. */
  workerRssMb: number;
  /** Highest worker RSS sampled since boot, MB. */
  workerPeakRssMb: number;
  /** Whole container (cgroup) usage, MB; null when no cgroup file is readable. */
  containerUsedMb: number | null;
  /** The cgroup limit, else MEMORY_LIMIT_MB; null when neither is known. */
  containerLimitMb: number | null;
  /** cgroup v2's own high-water mark when the kernel provides it, MB. */
  containerPeakMb: number | null;
}

type ReadFile = (path: string) => string | null;

const MB = 1024 * 1024;
/** cgroup v1 reports "no limit" as a number near 2^63. */
const NO_LIMIT_BYTES = 2 ** 60;

const safeRead: ReadFile = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** A cgroup file's value in MB, or null for "max", absent, unparseable or effectively unlimited. */
export function parseCgroupBytes(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'max') return null;
  const bytes = Number(trimmed);
  if (!Number.isFinite(bytes) || bytes < 0 || bytes >= NO_LIMIT_BYTES) return null;
  return Math.round(bytes / MB);
}

let peakRssMb = 0;

export function readMemory(read: ReadFile = safeRead, rssBytes: number = process.memoryUsage().rss, envLimitMb: string | undefined = process.env.MEMORY_LIMIT_MB): MemoryReport {
  const rss = Math.round(rssBytes / MB);
  peakRssMb = Math.max(peakRssMb, rss);

  let used = parseCgroupBytes(read('/sys/fs/cgroup/memory.current'));
  let limit = parseCgroupBytes(read('/sys/fs/cgroup/memory.max'));
  const peak = parseCgroupBytes(read('/sys/fs/cgroup/memory.peak'));
  if (used === null) {
    used = parseCgroupBytes(read('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
    limit = parseCgroupBytes(read('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  }
  const env = Number(envLimitMb);
  if (limit === null && Number.isFinite(env) && env > 0) limit = env;

  return { workerRssMb: rss, workerPeakRssMb: peakRssMb, containerUsedMb: used, containerLimitMb: limit, containerPeakMb: peak };
}

/** Test seam: the peak is process state. */
export function __resetPeakForTests(): void {
  peakRssMb = 0;
}
