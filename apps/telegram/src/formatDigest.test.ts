import { describe, expect, it } from 'vitest';
import type { StoredDigestDTO } from './apiClient.js';
import { formatStoredDigest } from './formatting.js';

const NOW = Date.UTC(2026, 9, 20, 6);
const digest = (overrides: Partial<StoredDigestDTO> = {}): StoredDigestDTO => ({
  day: '2026-10-20', sentAt: Date.UTC(2026, 9, 20, 1), text: '☀️ <b>Tóm tắt</b>', personal: true, ...overrides,
});

describe('formatStoredDigest', () => {
  it('shows this morning’s own message exactly as sent', () => {
    expect(formatStoredDigest(digest(), NOW)).toBe('☀️ <b>Tóm tắt</b>');
  });

  it('says when the message is not this chat’s own, or not this morning’s', () => {
    expect(formatStoredDigest(digest({ personal: false }), NOW)).toContain('/alerts on');
    expect(formatStoredDigest(digest({ day: '2026-10-18', sentAt: Date.UTC(2026, 9, 18, 1) }), NOW)).toContain('gần nhất đã lưu (18/10)');
  });

  it('answers when nothing is stored yet', () => {
    expect(formatStoredDigest(null, NOW)).toContain('Chưa có báo cáo');
  });
});
