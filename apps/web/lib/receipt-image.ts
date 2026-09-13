import { formatNaira, tokens } from '@fundxtra/shared';

/**
 * Renders a receipt to a PNG.
 *
 * Painted onto a canvas from the receipt's data rather than scraped from the
 * DOM. Screenshotting the DOM needs a library that walks every node and
 * re-implements CSS — heavy, and it fails quietly on anything it does not
 * support, which for this receipt would be the masked torn edge and the
 * gradient. Painting from the data is deterministic: what the numbers say is
 * what the image shows, at whatever pixel density we ask for.
 *
 * The output is deliberately plain: a bank receipt is a document, and a
 * document that renders identically everywhere is worth more than one that
 * matches the app's flourishes.
 */

export interface ReceiptLine {
  label: string;
  value: string;
  /** Monospaced, for references and account numbers. */
  mono?: boolean;
}

export interface ReceiptSection {
  title: string;
  lines: ReceiptLine[];
}

export interface ReceiptImageInput {
  kind: string;
  statusLabel: string;
  statusTone: 'pending' | 'good' | 'bad';
  amountKobo: number;
  amountPrefix?: string;
  amountInWords: string;
  sections: ReceiptSection[];
  footer: string;
  issuedAt: string;
}

const WIDTH = 720;
const PAD = 44;
const SCALE = 2;

/** Wraps text to a width, returning the lines. */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderReceiptPng(input: ReceiptImageInput): Promise<Blob> {
  /*
    Height is measured before drawing rather than guessed, so a receipt with
    a failure reason or a long bank name is not clipped.
  */
  const rowHeight = 34;
  const sectionChrome = 56;
  let height = 268; // header block
  for (const section of input.sections) {
    height += sectionChrome + section.lines.length * rowHeight;
  }
  height += 130; // footer

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device');
  context.scale(SCALE, SCALE);

  const sans = tokens.typography.fontSans.replace('var(--font-sans), ', '');
  const mono = tokens.typography.fontMono;

  // Ground.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, WIDTH, height);

  // Header wash, matching the on-screen receipt.
  const wash = context.createLinearGradient(0, 0, 0, 250);
  wash.addColorStop(0, tokens.colors.cocoa[50]);
  wash.addColorStop(1, '#ffffff');
  context.fillStyle = wash;
  context.fillRect(0, 0, WIDTH, 250);

  let y = 56;

  // Wordmark.
  context.fillStyle = tokens.semantic.brand;
  context.beginPath();
  context.roundRect(WIDTH / 2 - 84, y - 22, 30, 30, 9);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = `700 16px ${sans}`;
  context.textAlign = 'center';
  context.fillText('F', WIDTH / 2 - 69, y - 1);

  context.fillStyle = tokens.semantic.brandInk;
  context.font = `700 21px ${sans}`;
  context.textAlign = 'left';
  context.fillText('Fundxtra', WIDTH / 2 - 46, y);

  y += 30;
  context.textAlign = 'center';
  context.fillStyle = tokens.semantic.inkSubtle;
  context.font = `700 11px ${sans}`;
  context.fillText(input.kind.toUpperCase(), WIDTH / 2, y);

  // Status pill.
  y += 30;
  const tone =
    input.statusTone === 'good'
      ? { fill: tokens.colors.success.soft, text: tokens.colors.success.strong }
      : input.statusTone === 'bad'
        ? { fill: tokens.colors.danger.soft, text: tokens.colors.danger.strong }
        : { fill: tokens.colors.warning.soft, text: tokens.colors.warning.strong };

  context.font = `700 12px ${sans}`;
  const pillText = input.statusLabel.toUpperCase();
  const pillWidth = context.measureText(pillText).width + 32;
  context.fillStyle = tone.fill;
  context.beginPath();
  context.roundRect(WIDTH / 2 - pillWidth / 2, y - 15, pillWidth, 26, 13);
  context.fill();
  context.fillStyle = tone.text;
  context.fillText(pillText, WIDTH / 2, y + 3);

  // Amount.
  y += 62;
  context.fillStyle = tokens.semantic.ink;
  context.font = `700 46px ${sans}`;
  const amount = `${input.amountPrefix ?? ''}${formatNaira(Math.abs(input.amountKobo))}`;
  context.fillText(amount, WIDTH / 2, y);

  y += 26;
  context.fillStyle = tokens.semantic.inkSubtle;
  context.font = `400 14px ${sans}`;
  context.fillText(input.amountInWords, WIDTH / 2, y);

  // Sections.
  y += 46;
  context.textAlign = 'left';
  for (const section of input.sections) {
    context.fillStyle = tokens.semantic.inkFaint;
    context.font = `700 11px ${sans}`;
    context.fillText(section.title.toUpperCase(), PAD, y);
    y += 22;

    for (const line of section.lines) {
      context.fillStyle = tokens.semantic.inkSubtle;
      context.font = `400 14px ${sans}`;
      context.textAlign = 'left';
      context.fillText(line.label, PAD, y);

      context.fillStyle = tokens.semantic.ink;
      context.font = line.mono ? `600 13px ${mono}` : `600 14px ${sans}`;
      context.textAlign = 'right';
      context.fillText(line.value, WIDTH - PAD, y);
      y += rowHeight;
    }

    // Dashed rule between sections.
    context.strokeStyle = tokens.semantic.border;
    context.setLineDash([4, 4]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(PAD, y - 12);
    context.lineTo(WIDTH - PAD, y - 12);
    context.stroke();
    context.setLineDash([]);
    y += 22;
  }

  // Footer.
  y += 6;
  context.textAlign = 'center';
  context.fillStyle = tokens.semantic.inkSubtle;
  context.font = `400 12px ${sans}`;
  for (const line of wrap(context, input.footer, WIDTH - PAD * 3)) {
    context.fillText(line, WIDTH / 2, y);
    y += 18;
  }

  y += 8;
  context.fillStyle = tokens.semantic.inkFaint;
  context.font = `400 10px ${sans}`;
  context.fillText(`Issued ${input.issuedAt}`, WIDTH / 2, y);

  // The torn lower edge, so the image reads as a slip rather than a card.
  context.fillStyle = '#ffffff';
  const notch = 18;
  for (let x = 0; x < WIDTH; x += notch) {
    context.beginPath();
    context.arc(x + notch / 2, height, notch / 2, 0, Math.PI * 2);
    context.fill();
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not produce the image'));
    }, 'image/png');
  });
}

/**
 * Hands the PNG to the user by whatever route the platform allows.
 *
 * Inside Telegram's WebView an `<a download>` is frequently inert, so the
 * share sheet is tried first and opening the image in a tab is the fallback —
 * from there "save image" is a long press. Returning which route was taken
 * lets the caller say something true rather than claiming a download started.
 */
export async function deliverReceipt(
  blob: Blob,
  filename: string,
): Promise<'shared' | 'downloaded' | 'opened'> {
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Fundxtra receipt' });
      return 'shared';
    } catch (error) {
      // A cancelled share is not a failure; fall through to the file routes.
      if (error instanceof Error && error.name === 'AbortError') return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    if ('download' in anchor) {
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return 'downloaded';
    }
    window.open(url, '_blank');
    return 'opened';
  } finally {
    // Revoked late: revoking immediately can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
