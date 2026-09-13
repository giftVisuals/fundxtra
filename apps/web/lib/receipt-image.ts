import { formatNaira, tokens } from '@fundxtra/shared';
import { LOGO_PATH, LOGO_VIEWBOX } from './logo';

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
  /** Where the receipt came from, for whoever it gets forwarded to. */
  source: string;
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

/**
 * Paints the Fundxtra mark into a square box on the canvas.
 *
 * The same path the `<Logo>` component renders, scaled by Path2D rather than
 * redrawn — a second copy of the artwork is a second thing to keep in step.
 * `evenodd` keeps the arrow's highlight a hole rather than a white shape, so
 * the mark reads correctly knocked out on the brown badge.
 */
function drawMark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
): void {
  context.save();
  context.translate(x, y);
  context.scale(size / LOGO_VIEWBOX, size / LOGO_VIEWBOX);
  context.fillStyle = colour;
  context.fill(new Path2D(LOGO_PATH), 'evenodd');
  context.restore();
}

/**
 * Lays the receipt out, painting as it goes, and reports where it ended.
 *
 * The height cannot be known before the layout runs — the disclaimer wraps to
 * a different number of lines on different devices, and a failure reason or a
 * long bank name adds rows. It used to be estimated from per-section constants
 * instead, and those constants drifted from what the drawing code actually
 * consumed, which showed up as a band of empty white at the bottom of every
 * receipt.
 *
 * So the layout runs twice: once against a throwaway canvas purely to find out
 * how tall it is, then again for real at exactly that height. Painting into a
 * 1×1 canvas costs nothing and it cannot disagree with itself, which an
 * estimate always eventually does.
 */
function paintReceipt(context: CanvasRenderingContext2D, input: ReceiptImageInput): number {
  const sans = tokens.typography.fontSans.replace('var(--font-sans), ', '');
  const mono = tokens.typography.fontMono;
  const rowHeight = 34;

  // Header wash, matching the on-screen receipt.
  const wash = context.createLinearGradient(0, 0, 0, 250);
  wash.addColorStop(0, tokens.colors.cocoa[50]);
  wash.addColorStop(1, '#ffffff');
  context.fillStyle = wash;
  context.fillRect(0, 0, WIDTH, 250);

  let y = 56;

  // Wordmark: the real mark knocked out in white on the brown badge, drawn
  // from the same path the app renders, so the document and the screen agree.
  const badge = 30;
  const badgeX = WIDTH / 2 - 84;
  context.fillStyle = tokens.semantic.brand;
  context.beginPath();
  context.roundRect(badgeX, y - 22, badge, badge, 9);
  context.fill();
  drawMark(context, badgeX + 6, y - 16, badge - 12, '#ffffff');

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
  context.fillText(
    `${input.amountPrefix ?? ''}${formatNaira(Math.abs(input.amountKobo))}`,
    WIDTH / 2,
    y,
  );

  y += 26;
  context.fillStyle = tokens.semantic.inkSubtle;
  context.font = `400 14px ${sans}`;
  context.fillText(input.amountInWords, WIDTH / 2, y);

  // Sections.
  y += 46;
  for (const section of input.sections) {
    // Reset explicitly: the previous section's values left this as 'right',
    // which pushed every title after the first one off the left edge.
    context.textAlign = 'left';
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

  // Where the receipt came from. A shared receipt outlives the app it was made
  // in, and without this it is an image of some numbers.
  y += 10;
  context.fillStyle = tokens.semantic.brandInk;
  context.font = `600 12px ${sans}`;
  context.fillText(input.source, WIDTH / 2, y);

  y += 18;
  context.fillStyle = tokens.semantic.inkFaint;
  context.font = `400 10px ${sans}`;
  context.fillText(`Issued ${input.issuedAt}`, WIDTH / 2, y);

  return y;
}

/** Clear white under the last line, for the torn edge to bite into. */
const BOTTOM_MARGIN = 26;

export async function renderReceiptPng(input: ReceiptImageInput): Promise<Blob> {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas is unavailable on this device');
  const height = Math.ceil(paintReceipt(measure, input)) + BOTTOM_MARGIN;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device');
  context.scale(SCALE, SCALE);

  // Ground.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, WIDTH, height);

  paintReceipt(context, input);

  /*
    The torn lower edge, so the image reads as a slip rather than a card.

    Punched out rather than painted white: the receipt is white, so white
    circles on it were invisible and the edge did nothing at all. Erasing
    leaves the notches transparent, which is what makes them read as notches
    against whatever the image is shared onto.
  */
  context.globalCompositeOperation = 'destination-out';
  const notch = 18;
  for (let x = 0; x < WIDTH; x += notch) {
    context.beginPath();
    context.arc(x + notch / 2, height, notch / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = 'source-over';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not produce the image'));
    }, 'image/png');
  });
}

/**
 * Hands the PNG to the user by whatever route the platform actually allows.
 *
 * The previous version tried `<a download>` and reported "saved to your
 * downloads" whenever `'download' in anchor` was true — which it always is,
 * because `download` is a property of every anchor element whether or not the
 * browser honours it. Telegram's WebView ignores the attribute, so the click
 * did nothing and the app said it had saved the file. A check that cannot fail
 * is not a check.
 *
 * So sharing is the route now. The native share sheet is the one thing that
 * works the same inside Telegram as outside it, and on both phones it already
 * contains "Save image" / "Save to Photos" — so sharing is also how saving
 * happens, without the app having to claim a download it cannot observe.
 *
 * Opening the image in a tab stays as the fallback, where saving is a long
 * press. Nothing here reports success it did not witness.
 */

export type ShareRoute =
  /** The share sheet accepted the image. */
  | 'shared'
  /** The share sheet opened and the user dismissed it. Not a failure. */
  | 'cancelled'
  /** No share sheet; the image opened in a tab instead. */
  | 'opened'
  /** Neither route was available — usually a blocked pop-up. */
  | 'unavailable';

/**
 * Whether this browser can put an image into a share sheet.
 *
 * Probed with a real File, because `navigator.canShare` answers about the
 * payload, not the API: several browsers expose `share` for text and refuse
 * files. Browser-only, so call it from an effect rather than during render.
 */
let shareSupport: boolean | null = null;

export function canShareImages(): boolean {
  // Cached: the answer cannot change within a session, and it is read on every
  // render through useSyncExternalStore, which wants a cheap stable value.
  if (shareSupport === null) shareSupport = probeShareSupport();
  return shareSupport;
}

function probeShareSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const probe = new File([new Blob([new Uint8Array([0])])], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Takes an already-rendered blob rather than rendering one.
 *
 * iOS only allows `navigator.share` while the tap that triggered it is still
 * "live", and that permission expires across an await. Painting the receipt
 * first and passing the finished blob in keeps the share call the first thing
 * that happens after the tap, so the sheet actually opens.
 */
export async function shareReceipt(
  blob: Blob,
  filename: string,
  text: string,
): Promise<ShareRoute> {
  if (canShareImages()) {
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: 'image/png' })],
        title: 'Fundxtra receipt',
        text,
      });
      return 'shared';
    } catch (error) {
      // Dismissing the sheet is a decision, not an error — and it must not
      // dump the user into the fallback tab they did not ask for.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  // Revoked late: revoking immediately can blank the tab that just opened.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return window.open(url, '_blank') ? 'opened' : 'unavailable';
}
