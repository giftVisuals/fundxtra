import { BRAND } from '@fundxtra/shared';
import { apiOrigin, env, hasTelegram, isProduction, miniAppUrl, telegramWebhookSecret } from '../config/env';
import { logger } from './logger';
import {
  getBotIdentity,
  getWebhookInfo,
  setChatMenuButton,
  setMyCommands,
  setWebhook,
} from './telegram-bot';

/**
 * Configure the bot with Telegram at boot.
 *
 * Done over the Bot API rather than by hand in @BotFather for two reasons:
 * a fresh deployment configures itself, and the menu button can never drift
 * from the URL this deployment actually serves. It is also the difference
 * between a working setup and a phone-only operator hunting through BotFather
 * menus.
 *
 * Every step is best-effort and non-fatal. A bot that cannot register its
 * webhook must still serve the Mini App, which authenticates through signed
 * `initData` and does not depend on any of this.
 */

const COMMANDS = [
  { command: 'start', description: `Open ${BRAND.name}` },
  { command: 'help', description: 'How Fundxtra works' },
  { command: 'support', description: 'Contact Fundxtra Support' },
];

export interface BotSetupResult {
  identity: { id: number; username: string } | null;
  commandsSet: boolean;
  menuButtonSet: boolean;
  webhookUrl: string | null;
  webhookRegistered: boolean;
  skipped: string[];
}

export async function configureBot(): Promise<BotSetupResult> {
  const skipped: string[] = [];
  const result: BotSetupResult = {
    identity: null,
    commandsSet: false,
    menuButtonSet: false,
    webhookUrl: null,
    webhookRegistered: false,
    skipped,
  };

  if (!hasTelegram) {
    skipped.push('TELEGRAM_BOT_TOKEN is not set');
    return result;
  }

  result.identity = await getBotIdentity();
  if (!result.identity) {
    skipped.push('the bot token was rejected by Telegram');
    return result;
  }

  result.commandsSet = await setMyCommands(COMMANDS);
  result.menuButtonSet = await setChatMenuButton(miniAppUrl(), `Open ${BRAND.name}`);

  const origin = apiOrigin();
  const secret = telegramWebhookSecret();

  if (!origin) {
    skipped.push('neither PUBLIC_API_URL nor RAILWAY_PUBLIC_DOMAIN is set, so no webhook URL is known');
  } else if (!secret) {
    skipped.push('SESSION_SECRET is not set, so the webhook could not be authenticated');
  } else if (!origin.startsWith('https://')) {
    // Telegram refuses a plaintext webhook. Saying so beats a cryptic API error.
    skipped.push('the API origin is not https, which Telegram requires for a webhook');
  } else {
    const url = `${origin}/telegram/webhook`;
    result.webhookUrl = url;

    // Re-registering an identical webhook is harmless, but skipping it avoids
    // resetting Telegram's delivery state on every restart.
    const existing = await getWebhookInfo();
    if (existing?.url === url && !env.TELEGRAM_WEBHOOK_SECRET) {
      result.webhookRegistered = true;
      logger.info({ url }, 'Telegram webhook already registered');
    } else {
      result.webhookRegistered = await setWebhook(url, secret);
    }

    if (existing?.last_error_message) {
      logger.warn(
        { lastError: existing.last_error_message },
        'Telegram reported a previous webhook delivery failure',
      );
    }
  }

  logger.info(
    {
      bot: result.identity.username,
      miniApp: miniAppUrl(),
      webhook: result.webhookUrl,
      webhookRegistered: result.webhookRegistered,
      commandsSet: result.commandsSet,
      menuButtonSet: result.menuButtonSet,
      skipped,
    },
    'Telegram bot configured',
  );

  if (isProduction && !result.webhookRegistered) {
    logger.error(
      { skipped },
      'The bot will not answer /start: no webhook is registered. Referral links open a silent chat until this is fixed.',
    );
  }

  return result;
}
