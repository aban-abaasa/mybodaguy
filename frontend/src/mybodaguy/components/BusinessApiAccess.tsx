import { ExternalLink, KeyRound, BookOpen } from 'lucide-react';

/**
 * Pointer to the Era API for an approved business. Keys are minted by the owner in ICAN (Business, Administration,
 * Developer API) and only ever reach that one business's own data — see ERA_API.md. This panel does not mint keys itself.
 */
export default function BusinessApiAccess({ businessProfileId }: { businessProfileId: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-slate-800">Developer API</h4>
        <p className="text-xs text-slate-500 mt-1">
          Connect your own booking, billing or dispatch software. Keys are scoped to this business only: they can request payments
          and rides on your behalf, and read your own bookings. They can never pay, withdraw, or see another business.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a
          href={`https://icanera.space/?business_profile_id=${businessProfileId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 bg-white border border-slate-100 rounded-xl p-4 hover:border-orange-200 hover:shadow-sm transition-all"
        >
          <KeyRound size={20} className="text-orange-500 shrink-0 mt-0.5" />
          <span className="text-sm">
            <span className="font-semibold text-slate-800 flex items-center gap-1">
              Create &amp; manage keys <ExternalLink size={12} />
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">Opens ICAN: Business, Administration, Developer API.</span>
          </span>
        </a>
        <a
          href="/developers/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 bg-white border border-slate-100 rounded-xl p-4 hover:border-orange-200 hover:shadow-sm transition-all"
        >
          <BookOpen size={20} className="text-orange-500 shrink-0 mt-0.5" />
          <span className="text-sm">
            <span className="font-semibold text-slate-800 flex items-center gap-1">
              API reference &amp; playground <ExternalLink size={12} />
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">Try every endpoint with a sandbox key first.</span>
          </span>
        </a>
      </div>
    </div>
  );
}
