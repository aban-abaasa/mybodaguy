import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Send } from 'lucide-react';
import { insuranceService, type PolicyMessage } from '../../services/insuranceService';
import { Notice } from './coverCommon';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// A private thread between the holder and the insurer, kept with the policy.
export default function CoverMessages({ policyId, insurerName, onRead }: { policyId: string; insurerName: string; onRead?: () => void }) {
  const [messages, setMessages] = useState<PolicyMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await insuranceService.messages(policyId);
    if (err) { setError(err); return; }
    setError(null);
    setMessages(data ?? []);
    onRead?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const res = await insuranceService.postMessage(policyId, body);
    setBusy(false);
    if (res.success) { setText(''); await load(); } else toast.error(res.error || 'Could not send');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Private between you and {insurerName}.</p>
        <button type="button" onClick={load} className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
        {messages === null ? (
          <p className="text-center text-xs text-slate-400" role="status">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No messages yet. Ask {insurerName} anything about your cover.</p>
        ) : (
          messages.map((m) =>
            m.side === 'system' ? (
              <p key={m.id} className="text-center text-[11px] italic text-slate-400">{m.body}</p>
            ) : (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-orange-500 text-white' : 'bg-white text-slate-800 ring-1 ring-black/5'}`}>
                  {!m.mine && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.sender_name}</p>}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${m.mine ? 'text-white/70' : 'text-slate-400'}`}>{when(m.created_at)}</p>
                </div>
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Write a message"
          aria-label="Message"
          className="classic-input flex-1 resize-none"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-orange-500 text-white disabled:opacity-40">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
