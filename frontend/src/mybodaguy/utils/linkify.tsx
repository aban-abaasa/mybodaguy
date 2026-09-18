import React from 'react';

// Matches http(s) URLs, bare www. domains, and email addresses inside a chat message.
const LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"')\]]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function trimTrailingPunctuation(match: string): { text: string; trail: string } {
  const trail = /[.,!?;:)\]"']+$/.exec(match)?.[0] ?? '';
  return trail ? { text: match.slice(0, -trail.length), trail } : { text: match, trail: '' };
}

/**
 * Renders plain chat text with any URLs/emails turned into clickable links.
 * Everything else is passed through untouched, so callers can keep wrapping
 * this in whitespace-pre-wrap/break-words containers as before.
 */
export function linkify(text: string): React.ReactNode[] {
  // split() with a capturing group alternates [text, match, text, match, ...],
  // so odd indices are always the links LINK_PATTERN captured.
  const parts = text.split(LINK_PATTERN);
  return parts.map((part, i) => {
    if (!part || i % 2 === 0) return part;

    const { text: cleaned, trail } = trimTrailingPunctuation(part);
    const isEmail = !cleaned.includes('://') && !cleaned.startsWith('www.') && cleaned.includes('@');
    const href = isEmail ? `mailto:${cleaned}` : cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;

    return (
      <React.Fragment key={i}>
        <a
          href={href}
          target={isEmail ? undefined : '_blank'}
          rel={isEmail ? undefined : 'noopener noreferrer'}
          className="underline underline-offset-2 text-current hover:opacity-80 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {cleaned}
        </a>
        {trail}
      </React.Fragment>
    );
  });
}

/** Convenience wrapper: <Linkify text={m.message} /> */
export function Linkify({ text }: { text: string }): React.ReactElement {
  return <>{linkify(text ?? '')}</>;
}
