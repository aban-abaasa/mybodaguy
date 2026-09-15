import { useEffect, useState } from 'react';

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

// A small auto-advancing carousel for the Overview greeting's live stats —
// each stat (traffic, peak time, top location, rider/stock hotspots) gets
// its own moment instead of all of them wrapping into a cramped, unreadable
// line. Pauses on hover/touch so a reader isn't fighting the animation.
export default function InsightSlider({ slides, intervalMs = 4000 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
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

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div className="overflow-hidden rounded-lg">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map(slide => (
            <div key={slide.key} className="w-full flex-shrink-0 px-0.5">
              <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${slide.tint}`}>
                <span className="text-sm leading-none">{slide.emoji}</span>
                <span className="min-w-0 truncate">{slide.content}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-1 mt-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show insight ${i + 1} of ${count}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-4 bg-orange-500' : 'w-1.5 bg-slate-200 hover:bg-slate-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
