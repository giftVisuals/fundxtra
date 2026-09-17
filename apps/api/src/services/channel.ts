import { BRAND, type ChannelInvite, type SystemSettings } from '@fundxtra/shared';
import { KeyedCache } from '../lib/cache';
import { checkChatMembership } from '../lib/telegram-bot';
import { logger } from '../lib/logger';

/**
 * Channel membership.
 *
 * Fundxtra can require that a user has joined its Telegram channel before they
 * are allowed to sign in or earn. That is a promotion mechanism, so it is
 * built with one rule above all others: **it may never lock out a real user
 * because of our own configuration.**
 *
 * Telegram only answers `getChatMember` for a chat the bot administers. If the
 * bot is removed, demoted, or the channel is renamed, every check starts
 * failing — and a gate that treats "we could not ask" as "you are not a
 * member" would, in that moment, shut the entire platform out of itself. So
 * there are three answers, not two:
 *
 *   MEMBER   — Telegram says they are in the channel.
 *   MISSING  — Telegram says they are not. The only state that blocks.
 *   UNKNOWN  — we could not find out. Logged loudly, and let through.
 *
 * Positive answers are cached for a few minutes because they are checked on
 * nearly every request. Negative answers are never cached: someone who taps
 * "Join" and comes straight back must get in immediately, not after a TTL.
 */

export type MembershipState = 'MEMBER' | 'MISSING' | 'UNKNOWN';

const MEMBERSHIP_TTL_MS = 10 * 60_000;

/** Telegram ids known to be in the channel. Members only — see above. */
const members = new KeyedCache<true>(MEMBERSHIP_TTL_MS, 20_000, 'channel-members');

/**
 * The channel to point users at, or null when none is configured.
 *
 * Read from settings on every call rather than captured, so an admin changing
 * the channel takes effect within the settings cache window.
 */
export function channelInvite(settings: SystemSettings): ChannelInvite | null {
  const configured = (settings.platform.requiredChannel ?? '').trim();
  if (!configured) return null;

  const handle = /^-?\d+$/.test(configured)
    ? configured
    : `@${configured.replace(/^@/, '')}`;

  return {
    handle,
    url: inviteUrl(handle),
    required: Boolean(settings.platform.requireChannelJoin),
  };
}

/**
 * A joinable link for a handle.
 *
 * A numeric id identifies a private chat, which has no `t.me/<name>` form. The
 * brand's own channel is the only honest fallback: sending someone to a link
 * built from a private chat id would open nothing.
 */
function inviteUrl(handle: string): string {
  if (/^-?\d+$/.test(handle)) return BRAND.channelUrl;
  return `https://t.me/${handle.replace(/^@/, '')}`;
}

/**
 * Is this user in the channel?
 *
 * `fresh` skips the positive cache, for the moment a user says they have just
 * joined and wants to be let in now.
 */
export async function channelMembership(
  telegramId: string,
  channelHandle: string,
  options: { fresh?: boolean } = {},
): Promise<MembershipState> {
  if (!options.fresh && members.get(telegramId)) return 'MEMBER';

  const outcome = await checkChatMembership(channelHandle, telegramId);

  if (outcome.state === 'JOINED') {
    members.set(telegramId, true);
    return 'MEMBER';
  }

  if (outcome.state === 'NOT_JOINED') {
    // Not cached, and any stale positive is dropped: a user who left must stop
    // being treated as a member on the next request, not in ten minutes.
    members.invalidate(telegramId);
    return 'MISSING';
  }

  logger.error(
    {
      channel: channelHandle,
      state: outcome.state,
      detail: 'adminMessage' in outcome ? outcome.adminMessage : undefined,
      hint: 'Users are being let through unchecked. Add the Fundxtra bot to the channel and promote it to administrator, or clear the required channel in Settings.',
    },
    'Channel membership cannot be verified',
  );
  return 'UNKNOWN';
}

/** Forget a cached membership, so the next check asks Telegram again. */
export function forgetChannelMembership(telegramId: string): void {
  members.invalidate(telegramId);
}

/** Test seam. */
export function clearChannelCache(): void {
  members.clear();
}
