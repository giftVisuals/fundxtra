/**
 * SVG filters for the Fluid Lucid Glass system.
 *
 * Rendered once per surface, near the root, and referenced by `backdrop-filter:
 * url(#fx-refraction)`.
 *
 * This is what separates the effect from ordinary glassmorphism. A plain
 * `backdrop-filter: blur()` averages the pixels behind an element — it looks
 * frosted, but it does not look like *glass*, because real glass bends light
 * rather than smearing it. `feDisplacementMap` driven by a low-frequency
 * `feTurbulence` field offsets each backdrop pixel slightly, so a straight edge
 * passing behind the bar visibly kinks as it crosses, the way it would behind a
 * lens.
 *
 * The turbulence is deliberately coarse (baseFrequency 0.008) and the scale
 * small (6px). Higher values read as a watery filter effect — a gimmick — and
 * the goal here is a material that happens to be slightly imperfect.
 *
 * Support: Chrome and Edge apply SVG filters in backdrop-filter; Safari and
 * Firefox ignore the url() but still honour the blur and saturate in the same
 * declaration, so those browsers get the layered highlight glass without
 * refraction. The effect degrades, it does not break, which is why the
 * refraction is additive rather than load-bearing.
 */
export function GlassFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      // Removed from layout and from the accessibility tree; it exists only
      // as a filter definition.
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <filter
          id="fx-refraction"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.014"
            numOctaves={2}
            seed={7}
            result="noise"
          />
          {/* Soften the noise field so the displacement is smooth rather than
              grainy — grain reads as a texture, smoothness reads as glass. */}
          <feGaussianBlur in="noise" stdDeviation="1.2" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale={6}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/*
          A stronger variant for the active tab's lens, where a little more
          bend sells the idea that the selected item is a thicker piece of the
          same material.
        */}
        <filter
          id="fx-refraction-lens"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.02"
            numOctaves={2}
            seed={3}
            result="lensNoise"
          />
          <feGaussianBlur in="lensNoise" stdDeviation="0.9" result="softLensNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softLensNoise"
            scale={10}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
