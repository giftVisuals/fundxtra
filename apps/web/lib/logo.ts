/**
 * The Fundxtra mark, as one path.
 *
 * Traced from the brand artwork rather than kept as a bitmap, for two reasons.
 * The receipt paints the mark onto a canvas at 2× device pixels, and a PNG
 * scaled up there would be visibly soft on a document people send to support
 * or to a bank. And a single path takes `currentColor`, so the same mark works
 * knocked out in white on the brown badge and in brown on white — which a
 * fixed-colour image cannot do without a second file.
 *
 * The even-odd fill rule matters: the arrow's highlight is a hole in the
 * shape, not a white shape painted on top, so it stays transparent over any
 * background.
 *
 * Drawn inside a square 100×100 box with the mark centred, so callers can size
 * it like an icon without doing arithmetic.
 */
export const LOGO_VIEWBOX = 100;

export const LOGO_PATH =
  "M99.38 9.28 L100.0 9.28 L100.0 10.52 L95.88 44.33 L88.66 38.97 L49.28 90.52 L37.32 73.61 L37.53 72.58 L43.92 63.92 L49.48 70.52 L73.61 43.09 L77.53 48.25 L82.47 27.01 L61.65 34.02 L67.22 36.7 L67.22 37.53 L50.1 56.49 L47.84 58.14 L43.3 60.0 L20.82 90.52 L2.68 90.52 L43.09 35.46 L43.92 35.88 L48.66 43.3 L49.69 43.92 L68.25 22.89 L68.25 22.27 L62.06 17.32 L99.38 9.28 Z M74.43 62.06 L93.61 90.52 L75.26 90.52 L69.28 81.86 L64.74 74.64 L74.43 62.06 Z M0.0 51.34 L17.94 51.34 L18.76 52.37 L22.47 58.97 L12.99 71.55 L0.0 51.34 Z";
