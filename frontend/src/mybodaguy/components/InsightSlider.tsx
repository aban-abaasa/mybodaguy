import { useEffect, useRef, useState } from 'react';

export interface InsightSlide {
  key: string;
  emoji: string;
  tint: string;   // tailwind bg/text classes for this slide's pill
  content: React.ReactNode;
}

interface Props {
  slides: InsightSlide[];
  intervalMs?: number;
}

// Horizontal distance (px) a swipe must travel before it changes slides —
// small enough to feel responsive, large enough to ignore a sloppy tap.
const SWIPE_THRESHOLD = 40;

// A small auto-advancing carousel for the Overview greeting's live stats —
// each stat (traffic, peak time, top location, rider/stock hotspots) gets
// its own moment instead of all of them wrapping into a cramped, unreadable
// line. Pauses on hover/touch so a reader isn't fighting the animation, and
// swipes left/right on a phone.
export default function InsightSlider({ slides, intervalMs = 4000 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const count = slides.length;

  // Slides can arrive/disappear as live data loads — keep the index in range
  // rather than pointing at a slide that no longer exists.
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (count <= 1 || paused) return;
    const t = setInterval(() => setIndex(i => (i + 1) % count), intervalMs);
    return () => clearInterval(t);
  }, [count, paused, intervalMs]);

  if (count === 0) return null;

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null || count <= 1) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx <= -SWIPE_THRESHOLD) setIndex(i => (i + 1) % count);
    else if (dx >= SWIPE_THRESHOLD) setIndex(i => (i - 1 + count) % count);
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { setPaused(true); touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={handleTouchEnd}
    >
      <div className="overflow-hidden rounded-2xl">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map(slide => (
            <div key={slide.key} className="w-full flex-shrink-0 px-0.5">
              <div className={`flex h-full items-center gap-3 rounded-2xl px-3.5 py-3 text-[13px] font-medium leading-snug ring-1 ring-inset ring-black/5 ${slide.tint}`}>
                <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-white/70 text-base leading-none shadow-sm ring-1 ring-black/5 dark:bg-white/10">
                  {slide.emoji}
                </span>
                <span className="min-w-0 line-clamp-2">{slide.content}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {count > 1 && (
        <div className="mt-1 flex items-center justify-center">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show insight ${i + 1} of ${count}`}
              className="flex h-6 items-center px-[3px]"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-5 bg-[#c4a052]' : 'w-1.5 bg-slate-300 dark:bg-slate-600'
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
