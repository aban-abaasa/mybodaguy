import { useEffect, useRef } from 'react';

// The paint for the active icon of the phone bottom bar. mobileBottomTabs.css strokes it onto the icon's OWN shape
// (no ring, no box), so the colour runs along the real outline of the glyph.
//
// It is a gradient in the icon's 24x24 coordinate space whose angle keeps turning, so the colours travel around
// the glyph. The turning is done here, one attribute write per frame, rather than with SVG's own <animate>:
// browsers don't repaint icons that reference a gradient when it is animated that way. The loop idles while the bar
// isn't displayed (it is hidden from `sm`/`md` up) and never starts under prefers-reduced-motion, which gets the
// same colours standing still.
//
// Colours come from the bar's --mn-c1..3, so this must be rendered INSIDE the bar (or pass a fixed `colors`
// list, and a distinct `id`, to paint something that isn't a bar -- e.g. the floating chat button). In-between stops are mixed in
// OKLCH so the blend between two hues passes through vivid colours instead of grey. The svg is zero-sized rather
// than display:none, because browsers don't paint gradients that live in a display:none svg.
const TURN_MS = 3000;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const mix = (a: string, b: string) => `color-mix(in oklch, var(${a}), var(${b}))`;

export default function NavGlowDefs({ id = 'mbg-line', colors }: { id?: string; colors?: string[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const bar = svgRef.current?.parentElement;
      if (bar && bar.getClientRects().length && gradientRef.current) {
        const angle = (((now - start) % TURN_MS) / TURN_MS) * 360;
        gradientRef.current.setAttribute('gradientTransform', `rotate(${angle.toFixed(1)} 12 12)`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg ref={svgRef} aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient ref={gradientRef} id={id} gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="24" y2="12" spreadMethod="repeat">
          {colors
            ? [...colors, colors[0]].map((color, k, all) => <stop key={k} offset={k / (all.length - 1)} style={{ stopColor: color }} />)
            : (
              <>
                <stop offset="0" style={{ stopColor: 'var(--mn-c1)' }} />
                <stop offset="0.17" style={{ stopColor: mix('--mn-c1', '--mn-c2') }} />
                <stop offset="0.33" style={{ stopColor: 'var(--mn-c2)' }} />
                <stop offset="0.5" style={{ stopColor: mix('--mn-c2', '--mn-c3') }} />
                <stop offset="0.66" style={{ stopColor: 'var(--mn-c3)' }} />
                <stop offset="0.83" style={{ stopColor: mix('--mn-c3', '--mn-c1') }} />
                <stop offset="1" style={{ stopColor: 'var(--mn-c1)' }} />
              </>
            )}
        </linearGradient>
      </defs>
    </svg>
  );
}
