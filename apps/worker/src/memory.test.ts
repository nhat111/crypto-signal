import { beforeEach, describe, expect, it } from 'vitest';
import { __resetPeakForTests, parseCgroupBytes, readMemory } from './memory.js';

const MB = 1024 * 1024;
const files = (map: Record<string, string>) => (path: string) => map[path] ?? null;

beforeEach(() => __resetPeakForTests());

describe('parseCgroupBytes', () => {
  it('reads bytes as MB and treats "max", blanks and v1’s near-2^63 as no value', () => {
    expect(parseCgroupBytes(`${512 * MB}\n`)).toBe(512);
    expect(parseCgroupBytes('max\n')).toBeNull();
    expect(parseCgroupBytes('9223372036854771712')).toBeNull();
    expect(parseCgroupBytes('')).toBeNull();
    expect(parseCgroupBytes(null)).toBeNull();
  });
});

describe('readMemory', () => {
  it('prefers cgroup v2, including its peak', () => {
    const m = readMemory(
      files({ '/sys/fs/cgroup/memory.current': String(300 * MB), '/sys/fs/cgroup/memory.max': String(512 * MB), '/sys/fs/cgroup/memory.peak': String(470 * MB) }),
      120 * MB,
      undefined,
    );
    expect(m).toEqual({ workerRssMb: 120, workerPeakRssMb: 120, containerUsedMb: 300, containerLimitMb: 512, containerPeakMb: 470 });
  });

  it('falls back to cgroup v1, then to MEMORY_LIMIT_MB for the limit', () => {
    const v1 = readMemory(files({ '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(200 * MB), '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712' }), 100 * MB, '512');
    expect(v1).toMatchObject({ containerUsedMb: 200, containerLimitMb: 512, containerPeakMb: null });
    expect(readMemory(files({}), 100 * MB, undefined)).toMatchObject({ containerUsedMb: null, containerLimitMb: null });
  });

  it('remembers the highest worker RSS seen, so a spike between heartbeats is not lost', () => {
    readMemory(files({}), 300 * MB, undefined);
    expect(readMemory(files({}), 150 * MB, undefined)).toMatchObject({ workerRssMb: 150, workerPeakRssMb: 300 });
  });
});
