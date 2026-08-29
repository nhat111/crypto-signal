import { describe, expect, it } from 'vitest';
import { resolveBuildInfo } from './version.js';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('resolveBuildInfo', () => {
  it('reports null rather than inventing a version when nothing is set', () => {
    const info = resolveBuildInfo(env({}), 1000);
    expect(info.commit).toBeNull();
    expect(info.commitSource).toBeNull();
    expect(info.startedAt).toBe(1000);
  });

  it('reads the platform variable', () => {
    const info = resolveBuildInfo(env({ RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567890' }), 0);
    expect(info.commit).toBe('abcdef1');
    expect(info.commitSource).toBe('RAILWAY_GIT_COMMIT_SHA');
  });

  it('lets a hand-set GIT_COMMIT win, so an unlisted platform is never a dead end', () => {
    const info = resolveBuildInfo(env({ GIT_COMMIT: 'manual99', RAILWAY_GIT_COMMIT_SHA: 'platform1' }), 0);
    expect(info.commit).toBe('manual9');
    expect(info.commitSource).toBe('GIT_COMMIT');
  });

  it('ignores a variable that is set but blank', () => {
    // Some platforms export the name with an empty value on non-git deploys;
    // treating that as a version would report a commit of "".
    const info = resolveBuildInfo(env({ GIT_COMMIT: '   ', VERCEL_GIT_COMMIT_SHA: 'fedcba9876' }), 0);
    expect(info.commit).toBe('fedcba9');
    expect(info.commitSource).toBe('VERCEL_GIT_COMMIT_SHA');
  });
});
