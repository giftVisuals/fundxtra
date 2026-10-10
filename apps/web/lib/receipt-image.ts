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
/** Space around the card, so it reads as a card rather than a screenshot. */
const MARGIN = 26;
const PAD = 40;
const RADIUS = 28;
/** The brand-coloured band that carries the amount. */
const BAND_HEIGHT = 256;
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

/**
 * Paints the receipt, and reports how tall it turned out.
 *
 * The design, and why:
 *
 * A receipt is the one thing a user voluntarily shows other people. Somebody
 * who has just been paid screenshots it into a WhatsApp group, and that image
 * is the most persuasive advertising the platform will ever have — so it is
 * worth making it look like something, not like a text file.
 *
 * It is built as a white card on a warm ground, with the amount carried in a
 * brand-coloured header band. White on cocoa gives the number somewhere to
 * live that is unmistakably Fundxtra, and it means the first thing anybody
 * sees in a chat thumbnail is the brand and the figure together.
 *
 * Type size is still the hard constraint: this is scaled down to a phone's
 * width, so a 14px label would land at about 8px. Everything here is sized
 * for that, and each label sits above its value so neither is squeezed.
 */
function paintReceipt(context: CanvasRenderingContext2D, input: ReceiptImageInput): number {
  const sans = tokens.typography.fontSans.replace('var(--font-sans), ', '');
  const mono = tokens.typography.fontMono;
  const cardX = MARGIN;
  const cardW = WIDTH - MARGIN * 2;
  const inner = cardW - PAD * 2;
  const left = cardX + PAD;
  const right = cardX + cardW - PAD;

  // --- the header band -----------------------------------------------------

  const band = context.createLinearGradient(0, 0, WIDTH, BAND_HEIGHT);
  band.addColorStop(0, tokens.colors.cocoa[600]);
  band.addColorStop(1, tokens.colors.cocoa[700]);
  context.fillStyle = band;
  context.beginPath();
  context.roundRect(cardX, MARGIN, cardW, BAND_HEIGHT, [RADIUS, RADIUS, 0, 0]);
  context.fill();

  /*
    A soft highlight across the top of the band.
    
    Flat colour on a large area reads as a placeholder; one light pass makes
    it read as a surface. Clipped to the band so the rounded corners hold.
  */
  context.save();
  context.beginPath();
  context.roundRect(cardX, MARGIN, cardW, BAND_HEIGHT, [RADIUS, RADIUS, 0, 0]);
  context.clip();
  const sheen = context.createRadialGradient(
    cardX + cardW * 0.78, MARGIN - 40, 20,
    cardX + cardW * 0.78, MARGIN - 40, cardW * 0.9,
  );
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = sheen;
  context.fillRect(cardX, MARGIN, cardW, BAND_HEIGHT);
  context.restore();

  let y = MARGIN + 66;

  // Mark and wordmark, in white on the band.
  const badge = 42;
  context.save();
  context.globalAlpha = 0.18;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(left, y - 31, badge, badge, 12);
  context.fill();
  context.restore();
  drawMark(context, left + 9, y - 22, badge - 18, '#ffffff');

  context.fillStyle = '#ffffff';
  context.font = `700 29px ${sans}`;
  context.textAlign = 'left';
  context.fillText('Fundxtra', left + badge + 14, y);

  // Status, as a translucent pill so it belongs to the band.
  context.font = `700 16px ${sans}`;
  const pillText = input.statusLabel.toUpperCase();
  const pillW = context.measureText(pillText).width + 36;
  context.save();
  context.globalAlpha = 0.22;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(right - pillW, y - 27, pillW, 36, 18);
  context.fill();
  context.restore();
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.fillText(pillText, right - pillW / 2, y - 3);

  // The amount. The reason the document exists.
  y += 104;
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  context.font = `700 80px ${sans}`;
  context.fillText(
    `${input.amountPrefix ?? ''}${formatNaira(Math.abs(input.amountKobo))}`,
    WIDTH / 2,
    y,
  );

  y += 42;
  context.save();
  context.globalAlpha = 0.78;
  context.fillStyle = '#ffffff';
  context.font = `400 21px ${sans}`;
  context.fillText(input.when, WIDTH / 2, y);
  context.restore();

  // --- the rows ------------------------------------------------------------

  y = MARGIN + BAND_HEIGHT + 62;
  context.textAlign = 'left';

  for (const [index, line] of input.lines.entries()) {
    context.fillStyle = tokens.semantic.inkSubtle;
    context.font = `400 20px ${sans}`;
    context.fillText(line.label, left, y);

    y += 38;
    context.fillStyle = tokens.semantic.ink;
    context.font = line.mono ? `600 24px ${mono}` : `600 27px ${sans}`;
    for (const part of wrap(context, line.value, inner)) {
      context.fillText(part, left, y);
      y += 36;
    }

    // No rule under the last row: the footer divides it already.
    if (index < input.lines.length - 1) {
      y += 8;
      context.strokeStyle = tokens.semantic.border;
      context.setLineDash([5, 8]);
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.setLineDash([]);
      y += 46;
    }
  }

  /*
    Where it came from, on a tinted strip.
    
    A receipt gets forwarded, and on its own it is an image of some numbers —
    the handle is the one thing that lets whoever received it find the way in.
  */
  y += 22;
  const footerTop = y - 34;
  context.fillStyle = tokens.colors.cocoa[50];
  context.fillRect(cardX, footerTop, cardW, 76);

  context.textAlign = 'center';
  context.fillStyle = tokens.semantic.brandInk;
  context.font = `700 21px ${sans}`;
  context.fillText(input.source, WIDTH / 2, y + 8);

  return footerTop + 76;
}

export async function renderReceiptPng(input: ReceiptImageInput): Promise<Blob> {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas is unavailable on this device');
  const cardBottom = Math.ceil(paintReceipt(measure, input));
  const height = cardBottom + MARGIN;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device');
  context.scale(SCALE, SCALE);

  // The warm ground the card sits on.
  context.fillStyle = tokens.colors.sand[50];
  context.fillRect(0, 0, WIDTH, height);

  /*
    The card, with a soft shadow.

    Painted before the content and then used as a clip, so the header band's
    square bottom corners and the footer strip both stop at the card's
    rounded edge instead of running past it.
  */
  const cardTop = MARGIN;
  const cardHeight = cardBottom - MARGIN;

  context.save();
  context.shadowColor = 'rgba(80, 52, 32, 0.13)';
  context.shadowBlur = 26;
  context.shadowOffsetY = 10;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(MARGIN, cardTop, WIDTH - MARGIN * 2, cardHeight, RADIUS);
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.roundRect(MARGIN, cardTop, WIDTH - MARGIN * 2, cardHeight, RADIUS);
  context.clip();
  paintReceipt(context, input);
  context.restore();

  /*
    A notched lower edge, so the card reads as a slip torn from a roll.

    Painted in the ground colour rather than punched out. Erasing them left
    transparent holes, which look like whatever the receipt is shared onto —
    invisible on a white chat, black blobs on a dark one. The image stays
    fully opaque and the notches read the same everywhere.
  */
  context.fillStyle = tokens.colors.sand[50];
  const notch = 19;
  for (let x = MARGIN; x < WIDTH - MARGIN; x += notch) {
    context.beginPath();
    context.arc(Math.min(x + notch / 2, WIDTH - MARGIN), cardBottom, notch / 2, 0, Math.PI * 2);
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
