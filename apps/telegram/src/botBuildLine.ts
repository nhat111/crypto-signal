import type { BuildInfo } from '@crypto-signal/shared';

/**
 * The bot's own commit, appended to /status.
 *
 * The web status page lists api and worker but not this bot: those two
 * either serve HTTP or hold a database handle, and the bot does neither —
 * it only ever talks to the API (rule 8), so it has nowhere to record a
 * build row without opening an unauthenticated write route for the
 * privilege.
 *
 * That left the one service whose OUTPUT people question invisible on the
 * page that answers "did it deploy yet?". Somebody reading an old reply
 * had no way to tell a stale bot from a stale API, which is exactly the
 * question a changed message raises. So the bot answers it about itself,
 * where the doubt actually appears.
 */
export function botBuildLine(build: BuildInfo, now = Date.now()): string {
  if (build.commit === null) {
    // No platform variable set is a different fact from "not deployed",
    // and claiming a version we cannot read would be worse than saying so.
    return 'bot — commit unknown (no build variable set)';
  }
  return `bot — commit ${build.commit} · khởi động ${formatAge(now - build.startedAt)}`;
}

function formatAge(ms: number): string {
  if (ms < 0) return 'vừa xong';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
