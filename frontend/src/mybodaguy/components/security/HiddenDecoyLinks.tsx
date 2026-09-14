/**
 * Not real links. No visible label, no tab stop, hidden from screen
 * readers — a human never finds these. A scanner that crawls every
 * <a href> on the page will. Rendered next to <ChatWidget /> in App.tsx so
 * it shows up on every screen (landing, sign-in, dashboard) without having
 * to touch each page individually. Paths must match public/robots.txt's
 * Disallow entries and the decoy handlers in frontend/api/** exactly.
 */
export default function HiddenDecoyLinks() {
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', left: '-9999px' }}
    >
      <a href="/api/admin/debug-keys" tabIndex={-1}>debug keys</a>
      <a href="/api/v1/internal/export-riders" tabIndex={-1}>export riders</a>
    </div>
  );
}
