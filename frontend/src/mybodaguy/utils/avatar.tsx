import React, { useState } from 'react';

const HUES = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500'];

const hueForId = (id?: string | null) => {
  const str = String(id || '?');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length];
};

const initialsFor = (name?: string | null) => {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
};

/**
 * A message sender's avatar — the real photo when `url` is a usable public
 * URL, colored initials otherwise (no url at all, e.g. a guest; or a
 * cross-app id ChatAttachmentService/sender rows sometimes carry that this
 * app has no resolver for, like ICAN's r2:// avatar keys — detected and
 * skipped rather than left broken). onError also falls back to initials, so
 * a deleted/expired image never leaves a blank hole in the message list.
 */
export function ChatAvatar({ id, name, url, size = 'h-7 w-7 text-[10px]' }: { id?: string | null; name?: string | null; url?: string | null; size?: string }) {
  const [failed, setFailed] = useState(false);
  const usable = url && !url.startsWith('r2://') && !failed;
  if (usable) {
    return <img src={url!} alt="" onError={() => setFailed(true)} className={`${size} flex-shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`${size} ${hueForId(id || name)} flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white`}>
      {initialsFor(name)}
    </div>
  );
}
