// Small pieces of the BodaGoEra "classic" look shared by the Customer and
// Rider Overview screens, so neither repeats them.

export const greetingForHour = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

// Serif section title with a gold hairline trailing off to the right.
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="font-classic-display text-lg font-semibold text-slate-800">{children}</h3>
      <div className="landing-classic-divider flex-1" />
    </div>
  );
}
