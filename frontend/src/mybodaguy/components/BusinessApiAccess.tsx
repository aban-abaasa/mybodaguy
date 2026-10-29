import { ExternalLink, KeyRound, BookOpen } from 'lucide-react';

/**
 * Pointer to the Era API for an approved business. Keys are minted by the owner in ICAN (Business, Administration,
 * Developer API) and only ever reach that one business's own data — see ERA_API.md. This panel does not mint keys itself.
 */
export default function BusinessApiAccess({ businessProfileId }: { businessProfileId: string }) {
  const links = [
    { href: `https://icanera.space/?business_profile_id=${businessProfileId}`, icon: KeyRound, title: 'API keys', note: 'Create and revoke keys' },
    { href: '/developers/', icon: BookOpen, title: 'Reference', note: 'Endpoints and sandbox' },
  ];
  return (
    <div className="space-y-4">
      <p className="classic-eyebrow">Developer API</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {links.map(({ href, icon: Icon, title, note }) => (
          <a key={title} href={href} target="_blank" rel="noopener noreferrer" className="classic-tile flex items-center gap-3 p-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28]"><Icon size={18} /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 font-classic-display text-[15px] font-semibold text-slate-800">{title} <ExternalLink size={12} /></span>
              <span className="block text-xs text-slate-500">{note}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
