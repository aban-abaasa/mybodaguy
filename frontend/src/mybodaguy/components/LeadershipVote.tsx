import { useCallback, useEffect, useMemo, useState } from 'react';
import { Vote, ChevronDown, Search, Check, Clock, Lock, ShieldCheck, Info, UserPlus, MessageSquare, Loader2, Crown } from 'lucide-react';
import { toast } from 'sonner';
import {
  leadershipVoteService,
  summariseAttention,
  type LeadershipSeat,
  type LeadershipState,
  type LeadershipNominee,
  type LeadershipMotion,
  type SeatRegionType,
} from '../services/leadershipVoteService';

// Riders and chairpersons hold a chairperson to account: more than half of ALL
// eligible voters can remove them, and the successor with the highest share of
// the votes takes the seat. All rules live in the database
// (ADD_LEADERSHIP_VOTE_REVOKE_AND_TAKEOVER.sql); this screen only shows them.

const roleLabel = (role: string | null) =>
  (role || 'chairperson').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closing now';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${mins % 60}m left`;
  return `${Math.max(mins, 1)}m left`;
}

const REASON_IDEAS = ['Not reporting stage money', 'Often absent from the stage', 'Unfair to riders', 'Abuse of power'];

// ── Badge/banner data for the dashboards ─────────────────────────────────────
export function useLeadershipAttention(userId?: string) {
  const [attention, setAttention] = useState({ needsMyVote: 0, againstMe: 0 });
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    leadershipVoteService.mySeats()
      .then(seats => { if (!cancelled) setAttention(summariseAttention(seats)); })
      .catch(() => { /* the Vote tab shows the real error */ });
    return () => { cancelled = true; };
  }, [userId]);
  return attention;
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function LeadershipVote({ userId }: { userId: string }) {
  const [seats, setSeats] = useState<LeadershipSeat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  const keyOf = (s: { region_type: string; region_id: string }) => `${s.region_type}:${s.region_id}`;

  const loadSeats = useCallback(async () => {
    try {
      const list = await leadershipVoteService.mySeats();
      list.sort((a, b) => {
        const needA = a.motion?.is_voter && !a.motion.has_voted ? 1 : 0;
        const needB = b.motion?.is_voter && !b.motion.has_voted ? 1 : 0;
        if (needA !== needB) return needB - needA;
        if (!!a.motion !== !!b.motion) return a.motion ? -1 : 1;
        return b.level - a.level || a.region_name.localeCompare(b.region_name);
      });
      setSeats(list);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your leaders');
    }
  }, []);

  useEffect(() => { loadSeats(); }, [loadSeats, userId]);

  // Land on the vote that needs you, if there is one.
  useEffect(() => {
    if (seats && openKey === null) {
      const first = seats.find(s => s.motion && ((s.motion.is_voter && !s.motion.has_voted) || s.is_mine));
      if (first) setOpenKey(keyOf(first));
    }
  }, [seats, openKey]);

  return (
    <div className="space-y-5">
      <div>
        <p className="classic-eyebrow">Your voice</p>
        <h2 className="mt-1 font-classic-display text-[28px] font-bold leading-tight tracking-tight text-slate-900">Leadership vote</h2>
        <p className="mt-1 text-sm text-slate-500">
          Riders and chairpersons can remove a chairperson with more than half of all votes, and choose who takes over.
        </p>
        <div className="landing-classic-divider mt-4" />
      </div>

      <div className="classic-card overflow-hidden">
        <button
          type="button"
          onClick={() => setShowHow(v => !v)}
          aria-expanded={showHow}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="flex items-center gap-2.5">
            <Info size={17} className="text-orange-500" />
            <span className="font-classic-display text-[16px] font-semibold text-slate-800">How it works</span>
          </span>
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${showHow ? 'rotate-180' : ''}`} />
        </button>
        {showHow && (
          <ul className="space-y-2 px-4 pb-4 text-[13px] leading-relaxed text-slate-600">
            <li><b>Anyone eligible can start it</b> - every active rider in the area, every chairperson in the area, and the chairperson directly above the seat. No signatures needed.</li>
            <li><b>Chairpersons vote on their leaders:</b> a stage chairperson votes on the parish, subcounty, division and district chairpersons above them, and each chairperson also votes on the chairpersons who report to them.</li>
            <li><b>One ballot:</b> remove or keep. To remove, you also pick who takes over, so the seat is never left empty. You can recommend any active rider in the area.</li>
            <li><b>More than 50% of everyone eligible</b> must vote to remove, not just those who turn up. The voter list is fixed the moment the vote opens.</li>
            <li><b>The recommended rider with the highest share of the votes takes over.</b> A tie goes to whoever reached that score first.</li>
            <li><b>It ends as soon as the result cannot change.</b> Otherwise it runs 7 days, and once a majority wants a change only 24 hours remain to pick who.</li>
            <li><b>Secret and final.</b> Nobody can see how you voted, and a ballot cannot be changed. The chairperson gets one reply everyone can read. A seat that just had a vote is locked for 30 days.</li>
          </ul>
        )}
      </div>

      {error && (
        <div className="classic-card p-4 text-sm text-red-600">
          {error}
          <button type="button" onClick={loadSeats} className="classic-btn classic-btn-outline mt-3 !min-h-[40px]">Try again</button>
        </div>
      )}

      {!error && seats === null && (
        <div className="classic-card flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin text-orange-500" /> Loading your leaders...
        </div>
      )}

      {seats && seats.length === 0 && (
        <div className="classic-card px-6 py-9 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#faf8f3] ring-1 ring-[#c4a052]/50 dark:bg-slate-700">
            <Vote className="text-[#c4a052]" size={28} strokeWidth={1.6} />
          </span>
          <h3 className="mt-4 font-classic-display text-xl font-semibold text-slate-800">No leaders to vote on yet</h3>
          <div className="landing-classic-divider mx-auto my-3 max-w-[140px]" />
          <p className="text-sm text-slate-500">Once you are an active rider at a stage, its chairperson and the levels above appear here.</p>
        </div>
      )}

      {seats && seats.length > 0 && (
        <div className="space-y-3">
          {seats.map(seat => {
            const k = keyOf(seat);
            const open = openKey === k;
            const m = seat.motion;
            const needsVote = !!m && m.is_voter && !m.has_voted;
            return (
              <div key={k} className="classic-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : k)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 p-3.5 text-left"
                >
                  <span className="relative flex-shrink-0">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-xl font-bold text-white ring-2 ring-[#e6c980] ring-offset-2 ring-offset-white dark:ring-offset-slate-800">
                      {seat.holder_name.charAt(0).toUpperCase()}
                    </span>
                    {m && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-red-500 dark:border-slate-800" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-classic-display text-[17px] font-semibold leading-tight text-slate-800">
                      {seat.holder_name}{seat.is_mine ? ' (you)' : ''}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{roleLabel(seat.role)} · {seat.region_name}</span>
                    {m ? (
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        needsVote ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {needsVote ? 'Vote open - needs yours' : seat.is_mine ? 'Vote open on your seat' : 'Vote open'} · {m.yes}/{m.revoke_needed}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="border-t border-[#c4a052]/25 px-4 pb-4 pt-4 dark:border-slate-700">
                    <SeatPanel seat={seat} onChanged={loadSeats} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── One seat ─────────────────────────────────────────────────────────────────
function SeatPanel({ seat, onChanged }: { seat: LeadershipSeat; onChanged: () => void }) {
  const [state, setState] = useState<LeadershipState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'remove' | 'keep' | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [reason, setReason] = useState('');
  const [successor, setSuccessor] = useState<LeadershipNominee | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [replyText, setReplyText] = useState('');

  const refresh = useCallback(async () => {
    try {
      setState(await leadershipVoteService.seatState(seat.region_type, seat.region_id));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not load this vote');
    }
  }, [seat.region_type, seat.region_id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live tallies while a vote is running.
  const isOpen = state?.motion?.status === 'open';
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
    return () => clearInterval(t);
  }, [isOpen, refresh]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.success) { toast.error(r.error || 'Something went wrong'); return false; }
      toast.success(ok);
      await refresh();
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  if (err) {
    return (
      <div className="text-sm text-red-600">
        {err}
        <button type="button" onClick={refresh} className="classic-btn classic-btn-outline mt-3 !min-h-[40px]">Try again</button>
      </div>
    );
  }
  if (!state) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin text-orange-500" /> Loading...</div>;
  }

  const m: LeadershipMotion | null = state.motion;
  const holder = state.seat.holder_name || seat.holder_name;
  const leader = state.candidates.find(c => c.votes > 0);

  // ── a vote is running ──
  if (m && m.status === 'open') {
    const canVote = m.is_voter && !m.has_voted;
    const picked = state.candidates.find(c => c.user_id === selected);

    const startNominate = async (n: LeadershipNominee) => {
      const ok = await run(() => leadershipVoteService.nominate(m.id, n.user_id), `${n.name} is now a candidate`);
      if (ok) { setSelected(n.user_id); setShowPicker(false); }
    };

    return (
      <div className="space-y-5">
        <div>
          <p className="classic-label">Why this vote was started</p>
          <p className="text-sm leading-relaxed text-slate-700">{m.reason}</p>
          <p className="mt-1 text-xs text-slate-400">Opened by {m.opened_by_name} on {shortDate(m.opened_at)}</p>
        </div>

        {m.chair_reply && (
          <div className="rounded-2xl bg-[#faf8f3] p-3.5 dark:bg-slate-700/50">
            <p className="classic-label flex items-center gap-1.5"><MessageSquare size={12} /> {holder} replies</p>
            <p className="text-sm leading-relaxed text-slate-700">{m.chair_reply}</p>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="classic-label !mb-0">Votes to remove</p>
            <p className="text-xs text-slate-500">{m.yes} of {m.revoke_needed} needed</p>
          </div>
          <div className="relative mt-2 h-3 rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500" style={{ width: `${Math.min(100, m.yes_pct)}%` }} />
            <div className="absolute -bottom-1 -top-1 w-0.5 bg-slate-800 dark:bg-slate-200" style={{ left: `${m.needed_pct}%` }} title="Majority" />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
            {m.yes_pct}% so far. The line marks the majority: more than half of all {m.electorate_size} eligible voters ({m.needed_pct}%).
            {' '}{m.cast} have voted · {m.no} to keep.
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Clock size={12} className="text-orange-500" /> {timeLeft(m.closes_at)}
            {m.majority_reached ? ' - a majority wants a change, so only the choice of successor is left' : ''}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="classic-label !mb-0">Who should take over</p>
            {canVote && !state.i_nominated && state.candidate_count < state.rules.max_candidates && (
              <button type="button" onClick={() => setShowPicker(v => !v)} className="classic-btn classic-btn-ghost !text-[#7a5a12]">
                <UserPlus size={14} /> Recommend someone
              </button>
            )}
          </div>

          {showPicker && (
            <div className="mt-2">
              <NomineePicker
                regionType={seat.region_type}
                regionId={seat.region_id}
                exclude={state.candidates.map(c => c.user_id)}
                disabled={busy}
                onPick={startNominate}
              />
            </div>
          )}

          <div className="mt-2 space-y-2">
            {state.candidates.map(c => {
              const active = selected === c.user_id || (!canVote && c.is_mine_pick);
              return (
                <button
                  key={c.user_id}
                  type="button"
                  tabIndex={canVote ? 0 : -1}
                  onClick={() => { if (canVote) { setSelected(c.user_id); setConfirm(null); } }}
                  className={`classic-tile block p-3 ${active ? 'is-active' : ''} ${canVote ? '' : 'pointer-events-none'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border ${active ? 'border-[#c4a052] bg-[#c4a052] text-white' : 'border-slate-300'}`}>
                        {active && <Check size={12} />}
                      </span>
                      <span className="truncate text-[15px] font-semibold text-slate-800">{c.name}{c.is_me ? ' (you)' : ''}</span>
                      {leader && leader.user_id === c.user_id && <Crown size={14} className="flex-shrink-0 text-[#c4a052]" aria-label="Leading" />}
                    </span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block font-classic-display text-lg font-bold leading-none text-slate-900">{c.share_pct}%</span>
                      <span className="block text-[10px] text-slate-400">{c.votes} vote{c.votes === 1 ? '' : 's'}</span>
                    </span>
                  </span>
                  <span className="mt-2 block h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
                    <span className="block h-full rounded-full bg-[#c4a052]" style={{ width: `${Math.min(100, c.share_pct)}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
          {leader && (
            <p className="mt-2 text-[11px] text-slate-500">
              {leader.name} leads with {leader.share_pct}% of the successor votes ({leader.pct_of_voters}% of all voters) and takes over if the vote passes.
            </p>
          )}
        </div>

        {/* Voting */}
        {canVote && (
          <div className="space-y-3">
            {confirm === null ? (
              <>
                <button
                  type="button"
                  disabled={busy || !selected}
                  onClick={() => setConfirm('remove')}
                  className="classic-btn classic-btn-primary"
                >
                  <Vote size={18} /> {selected ? `Remove ${holder} - ${picked?.name} takes over` : 'Pick who takes over first'}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm('keep')} className="classic-btn classic-btn-outline">
                  Keep {holder}
                </button>
              </>
            ) : (
              <div className="rounded-2xl border border-[#c4a052]/50 bg-[#fdf8ea] p-4 dark:bg-slate-700/50">
                <p className="flex items-center gap-2 font-classic-display text-[16px] font-semibold text-slate-800">
                  <Lock size={16} className="text-[#c4a052]" /> Your vote is secret and final
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {confirm === 'remove'
                    ? `You are voting to remove ${holder} and put ${picked?.name} in the seat.`
                    : `You are voting to keep ${holder}.`}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="classic-btn classic-btn-outline !min-h-[44px]">Back</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const revoke = confirm === 'remove';
                      setBusy(true);
                      try {
                        const r = await leadershipVoteService.cast(m.id, revoke, selected);
                        if (!r.success) { toast.error(r.error || 'Could not cast your vote'); return; }
                        toast.success(r.status === 'passed' ? 'The vote is decided - the seat has a new chairperson' : r.status === 'failed' ? 'The vote is decided - the chairperson stays' : 'Your vote is in');
                        setConfirm(null);
                        await refresh();
                        onChanged();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="classic-btn classic-btn-primary !min-h-[44px]"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {m.has_voted && (
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
            <ShieldCheck size={16} />
            You voted{m.my_ballot?.revoke ? ' to remove' : ' to keep'}
            {m.my_ballot?.revoke && m.my_ballot.candidate_user_id
              ? ` - picking ${state.candidates.find(c => c.user_id === m.my_ballot?.candidate_user_id)?.name || 'your candidate'}`
              : ''}. Your ballot is secret.
          </p>
        )}

        {!m.is_voter && !m.is_accused && (
          <p className="text-sm text-slate-500">You are not on the voter list for this vote (it was fixed when the vote opened).</p>
        )}

        {m.is_accused && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              You cannot vote on your own seat, but you can reply once. Everyone voting can read it.
            </p>
            {m.chair_reply ? (
              <p className="text-xs text-slate-400">You have already replied.</p>
            ) : (
              <>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Your reply to the riders"
                  className="classic-input"
                />
                <button
                  type="button"
                  disabled={busy || replyText.trim().length < 3}
                  onClick={() => run(() => leadershipVoteService.reply(m.id, replyText), 'Reply posted')}
                  className="classic-btn classic-btn-ink !min-h-[44px]"
                >
                  Post reply
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── no vote running ──
  const lr = state.last_result;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {roleLabel(state.seat.role)} of {state.seat.region_name}
        {state.seat.since ? ` since ${shortDate(state.seat.since)}` : ''}.
      </p>

      {lr && (
        <div className="rounded-2xl bg-[#faf8f3] p-3.5 dark:bg-slate-700/50">
          <p className="classic-label">Last vote · {shortDate(lr.closed_at)}</p>
          <p className="text-sm font-semibold text-slate-800">
            {lr.status === 'passed' ? `${lr.winner_name} was voted in as chairperson` : 'The chairperson kept the seat'}
          </p>
          {lr.close_reason && <p className="mt-0.5 text-xs text-slate-500">{lr.close_reason}.</p>}
          {lr.result && (
            <p className="mt-1 text-xs text-slate-500">
              {lr.result.yes} voted to remove, {lr.result.no} to keep, out of {lr.result.electorate_size} eligible
              (more than {lr.result.revoke_needed - 1} was needed).
            </p>
          )}
        </div>
      )}

      {state.seat.is_mine && (
        <p className="text-sm text-slate-600">
          This is your seat. If riders open a vote on it you will see it here and can post a reply.
        </p>
      )}

      {!showStart && state.can_open && (
        <button type="button" onClick={() => setShowStart(true)} className="classic-btn classic-btn-ink">
          <Vote size={18} /> Start a vote on {holder}
        </button>
      )}
      {!state.can_open && !state.seat.is_mine && state.why_not && (
        <p className="flex items-start gap-2 text-sm text-slate-500">
          <Lock size={15} className="mt-0.5 flex-shrink-0 text-slate-400" /> {state.why_not}.
        </p>
      )}

      {showStart && state.can_open && (
        <div className="space-y-4 rounded-2xl border border-[#c4a052]/40 p-4">
          <div>
            <label className="classic-label" htmlFor={`reason-${seat.region_id}`}>Why? (everyone voting will read this)</label>
            <textarea
              id={`reason-${seat.region_id}`}
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Say clearly what the problem is"
              className="classic-input"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {REASON_IDEAS.map(idea => (
                <button
                  key={idea}
                  type="button"
                  className="classic-chip"
                  onClick={() => setReason(r => (r.trim() ? `${r.trim()}; ${idea.toLowerCase()}` : idea))}
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="classic-label">Who should take over?</p>
            {successor ? (
              <div className="classic-tile is-active flex items-center justify-between gap-2 p-3">
                <span className="truncate text-[15px] font-semibold text-slate-800">{successor.name}</span>
                <button type="button" onClick={() => setSuccessor(null)} className="classic-btn classic-btn-ghost">Change</button>
              </div>
            ) : (
              <NomineePicker
                regionType={seat.region_type}
                regionId={seat.region_id}
                exclude={[]}
                disabled={busy}
                onPick={setSuccessor}
              />
            )}
          </div>

          <p className="text-xs text-slate-500">
            Starting the vote is also your own ballot: remove {holder}, and {successor ? successor.name : 'your pick'} takes over.
            Other voters can recommend more people. It needs more than half of all {state.rules.min_voters}+ eligible voters.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => setShowStart(false)} className="classic-btn classic-btn-outline !min-h-[44px]">Cancel</button>
            <button
              type="button"
              disabled={busy || reason.trim().length < 10 || !successor}
              onClick={async () => {
                if (!successor) return;
                const ok = await run(
                  () => leadershipVoteService.open(seat.region_type as SeatRegionType, seat.region_id, reason.trim(), successor.user_id),
                  'Vote started - voters have been alerted'
                );
                if (ok) { setShowStart(false); setReason(''); setSuccessor(null); }
              }}
              className="classic-btn classic-btn-primary !min-h-[44px]"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Vote size={16} />} Start vote
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pick a rider from the area ───────────────────────────────────────────────
function NomineePicker({ regionType, regionId, exclude, disabled, onPick }: {
  regionType: SeatRegionType;
  regionId: string;
  exclude: string[];
  disabled?: boolean;
  onPick: (n: LeadershipNominee) => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LeadershipNominee[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const list = await leadershipVoteService.nominees(regionType, regionId, q);
      if (!cancelled) setRows(list);
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [regionType, regionId, q]);

  const visible = useMemo(() => (rows || []).filter(r => !exclude.includes(r.user_id)), [rows, exclude]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search riders by name"
          className="classic-input !pl-10"
        />
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {rows === null && <p className="p-2 text-xs text-slate-400">Loading riders...</p>}
        {rows !== null && visible.length === 0 && <p className="p-2 text-xs text-slate-400">No riders found.</p>}
        {visible.map(n => (
          <button
            key={n.user_id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(n)}
            className="classic-tile flex items-center justify-between gap-2 p-2.5"
          >
            <span className="truncate text-sm font-semibold text-slate-800">{n.name}</span>
            <span className="flex-shrink-0 text-[11px] text-slate-400">
              {n.stage_name ? `${n.stage_name} · ` : ''}{n.completed_rides} ride{n.completed_rides === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
