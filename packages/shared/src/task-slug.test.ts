import { describe, expect, it } from 'vitest';
import {
  TASK_SLUG_MAX_LENGTH,
  isTaskSlug,
  normaliseTargetUrl,
  taskLink,
  toTaskSlug,
} from './format';

/**
 * Task link ids.
 *
 * A link id is the short word that names a campaign in its own link —
 * `crediplex` rather than a generated string. It is also the task's document
 * id, so anything that can produce two different ids from what an admin
 * reasonably considers "the same word" would let two campaigns claim the same
 * name, and anything that lets an unsafe character through would break a URL
 * or the `userId__taskId` keys the completion records use.
 */

describe('deriving a link id', () => {
  it('leaves an already-clean id alone', () => {
    expect(toTaskSlug('crediplex')).toBe('crediplex');
  });

  it('turns a title into something typeable', () => {
    expect(toTaskSlug('Join Crediplex Channel!')).toBe('join-crediplex-channel');
    expect(toTaskSlug('Follow us on X (Twitter)')).toBe('follow-us-on-x-twitter');
  });

  it('folds accents, so one word cannot become two ids', () => {
    expect(toTaskSlug('Créditplex')).toBe(toTaskSlug('Creditplex'));
  });

  it('collapses runs of separators and trims the edges', () => {
    expect(toTaskSlug('  --crediplex___promo--  ')).toBe('crediplex-promo');
  });

  it('never emits an underscore, which would break completion keys', () => {
    // Completions are stored as `userId__taskId`; an underscore in the id
    // would make that key ambiguous.
    expect(toTaskSlug('credi_plex_promo')).not.toContain('_');
  });

  it('caps the length', () => {
    expect(toTaskSlug('a'.repeat(80))).toHaveLength(TASK_SLUG_MAX_LENGTH);
  });
});

describe('validating a link id', () => {
  it('accepts lowercase words with single hyphens', () => {
    for (const slug of ['crediplex', 'join-crediplex', 'promo2026', 'a1-b2-c3']) {
      expect(isTaskSlug(slug)).toBe(true);
    }
  });

  it('rejects anything that would not survive a URL or a key', () => {
    for (const slug of [
      'ab',
      '',
      'Crediplex',
      'credi plex',
      'credi_plex',
      '-crediplex',
      'crediplex-',
      'credi--plex',
      'credi/plex',
      'credi.plex',
      'a'.repeat(TASK_SLUG_MAX_LENGTH + 1),
    ]) {
      expect(isTaskSlug(slug)).toBe(false);
    }
  });
});

describe('the share link', () => {
  it('opens the task through the bot', () => {
    expect(taskLink('fundxtrabot', 'crediplex')).toBe(
      'https://t.me/fundxtrabot?start=task_crediplex',
    );
  });

  it('tolerates a bot handle written with an @', () => {
    expect(taskLink('@fundxtrabot', 'crediplex')).toBe(
      'https://t.me/fundxtrabot?start=task_crediplex',
    );
  });
});

describe('the task destination', () => {
  it('accepts a Telegram handle the four ways an admin might type it', () => {
    const expected = 'https://t.me/crediplex';
    expect(normaliseTargetUrl('crediplex')).toBe(expected);
    expect(normaliseTargetUrl('@crediplex')).toBe(expected);
    expect(normaliseTargetUrl('t.me/crediplex')).toBe(expected);
    expect(normaliseTargetUrl('https://t.me/crediplex')).toBe(expected);
  });

  it('leaves a destination outside Telegram untouched', () => {
    expect(normaliseTargetUrl('https://example.com/sign-up?a=1')).toBe(
      'https://example.com/sign-up?a=1',
    );
    expect(normaliseTargetUrl('http://example.com')).toBe('http://example.com');
  });

  it('does not invent a link from something that is not a handle', () => {
    // Too short for a Telegram username, so it stays as typed and fails
    // validation rather than silently pointing at t.me/abc.
    expect(normaliseTargetUrl('abc')).toBe('abc');
    expect(normaliseTargetUrl('join our channel')).toBe('join our channel');
  });
});
