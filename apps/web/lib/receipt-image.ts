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

export interface ReceiptImageInput {
  statusLabel: string;
  statusTone: 'pending' | 'good' | 'bad';
  amountKobo: number;
  amountPrefix?: string;
  /** Under the amount, where a bank app puts it. */
  when: string;
  /**
   * One flat list, not grouped sections.
   *
   * Grouping cost a heading and two gaps per group — about a third of the
   * height of the whole document — to organise eleven rows that read fine in
   * a single column. The receipt was taller than a phone screen, which is the
   * one place it is ever looked at.
   */
  lines: ReceiptLine[];
  /** Where the receipt came from, for whoever it gets forwarded to. */
  source: string;
}

const WIDTH = 720;
const PAD = 44;
const SCALE = 2;

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
/**
 * Wraps a value to the available width, returning the lines.
 *
 * A bank account name or a rejection reason is as long as it happens to be,
 * and at this type size two of them run off the edge.
 */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

function paintReceipt(context: CanvasRenderingContext2D, input: ReceiptImageInput): number {
  const sans = tokens.typography.fontSans.replace('var(--font-sans), ', '');
  const mono = tokens.typography.fontMono;
  const inner = WIDTH - PAD * 2;

  context.fillStyle = tokens.semantic.brand;
  context.fillRect(0, 0, WIDTH, 10);

  let y = 84;

  /*
    Type size is the whole design here.
    
    This document is read as an image on a phone, where it is scaled to the
    screen width — so what decides whether it can be read is not how tall it
    is, it is how big the text is *relative to the canvas*. At 14px on a
    720px canvas, a label renders at about 8px on a 400px phone, which is
    why the first version was unreadable and why making it shorter did not
    help. Everything below is roughly double that, and the label sits above
    its value rather than beside it, so neither has to be squeezed.
  */
  const badge = 40;
  context.fillStyle = tokens.semantic.brand;
  context.beginPath();
  context.roundRect(PAD, y - 30, badge, badge, 11);
  context.fill();
  drawMark(context, PAD + 8, y - 22, badge - 16, '#ffffff');

  context.fillStyle = tokens.semantic.brandInk;
  context.font = `700 28px ${sans}`;
  context.textAlign = 'left';
  context.fillText('Fundxtra', PAD + badge + 14, y);

  const tone =
    input.statusTone === 'good'
      ? { fill: tokens.colors.success.soft, text: tokens.colors.success.strong }
      : input.statusTone === 'bad'
        ? { fill: tokens.colors.danger.soft, text: tokens.colors.danger.strong }
        : { fill: tokens.colors.warning.soft, text: tokens.colors.warning.strong };

  context.font = `700 16px ${sans}`;
  const pillText = input.statusLabel.toUpperCase();
  const pillWidth = context.measureText(pillText).width + 34;
  context.fillStyle = tone.fill;
  context.beginPath();
  context.roundRect(WIDTH - PAD - pillWidth, y - 26, pillWidth, 34, 17);
  context.fill();
  context.fillStyle = tone.text;
  context.textAlign = 'center';
  context.fillText(pillText, WIDTH - PAD - pillWidth / 2, y - 3);

  // The amount, as big as the document can carry.
  y += 110;
  context.textAlign = 'center';
  context.fillStyle = tokens.semantic.ink;
  context.font = `700 76px ${sans}`;
  context.fillText(
    `${input.amountPrefix ?? ''}${formatNaira(Math.abs(input.amountKobo))}`,
    WIDTH / 2,
    y,
  );

  y += 44;
  context.fillStyle = tokens.semantic.inkSubtle;
  context.font = `400 22px ${sans}`;
  context.fillText(input.when, WIDTH / 2, y);

  // The rows: label above value, a dashed rule between.
  y += 76;
  context.textAlign = 'left';
  for (const line of input.lines) {
    context.fillStyle = tokens.semantic.inkSubtle;
    context.font = `400 20px ${sans}`;
    context.fillText(line.label, PAD, y);

    y += 38;
    context.fillStyle = tokens.semantic.ink;
    context.font = line.mono ? `600 24px ${mono}` : `600 27px ${sans}`;
    for (const part of wrap(context, line.value, inner)) {
      context.fillText(part, PAD, y);
      y += 36;
    }

    y += 6;
    context.strokeStyle = tokens.semantic.border;
    context.setLineDash([5, 7]);
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(PAD, y);
    context.lineTo(WIDTH - PAD, y);
    context.stroke();
    context.setLineDash([]);
    y += 48;
  }

  /*
    Where it came from. A receipt gets forwarded, and on its own it is an
    image of some numbers — the bot handle is the one thing that lets whoever
    received it find out what Fundxtra is.
  */
  y += 4;
  context.textAlign = 'center';
  context.fillStyle = tokens.semantic.brandInk;
  context.font = `600 20px ${sans}`;
  context.fillText(input.source, WIDTH / 2, y);

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
