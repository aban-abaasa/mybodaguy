import { useEffect, useRef, useState } from 'react';
import { Truck, Car, Bike, CheckCircle, Clock, XCircle, Send } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { fetchMessages, sendMessage, subscribeToMessages, markConversationRead } from '../services/chatService';

// Kept as a standalone literal (not imported from UnifiedDashboard.tsx) to
// avoid a circular import: UnifiedDashboard -> CustomerDashboard ->
// BecomeOperatorForm -> UnifiedDashboard. Must match PREFERRED_ROLE_KEY in
// pages/UnifiedDashboard.tsx exactly.
const PREFERRED_ROLE_KEY = 'mbg_preferred_active_role';

interface BecomeOperatorFormProps {
  userId: string;
}

type VehicleType = 'motorcycle' | 'bicycle' | 'tuktuk' | 'car' | 'van' | 'truck';

interface Application {
  id: string;
  vehicle_type: VehicleType;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
}

const VEHICLE_OPTIONS: Array<{ value: VehicleType; label: string; icon: typeof Car }> = [
  { value: 'motorcycle', label: 'Motorcycle', icon: Bike },
  { value: 'bicycle', label: 'Bicycle', icon: Bike },
  { value: 'tuktuk', label: 'Tuktuk', icon: Car },
  { value: 'car', label: 'Car', icon: Car },
  { value: 'van', label: 'Van', icon: Truck },
  { value: 'truck', label: 'Truck', icon: Truck },
];

export default function BecomeOperatorForm({ userId }: BecomeOperatorFormProps) {
  // mbg_riders now allows multiple rows per person, one per vehicle_type
  // (ADD_MULTI_VEHICLE_SUPPORT.sql) — so a person can hold several
  // registrations at once. Only re-applying for a type already held is
  // blocked; approval inserts a new row alongside any existing ones rather
  // than upgrading in place.
  const [existingVehicleTypes, setExistingVehicleTypes] = useState<VehicleType[]>([]);
  const [existingApplication, setExistingApplication] = useState<Application | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [vehicleType, setVehicleType] = useState<VehicleType>('motorcycle');
  const [plateNumber, setPlateNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [phone, setPhone] = useState('');
  const [operatorCity, setOperatorCity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoadingStatus(true);
    const [{ data: riders }, { data: apps }] = await Promise.all([
      supabase.from('mbg_riders').select('vehicle_type').eq('user_id', userId),
      supabase
        .from('mbg_operator_applications')
        .select('id, vehicle_type, status, rejection_reason, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    const existing = ((riders || []).map((r: any) => r.vehicle_type)) as VehicleType[];
    setExistingVehicleTypes(existing);
    // Default the picker to something they don't already have.
    const firstUnheld = VEHICLE_OPTIONS.find((o) => !existing.includes(o.value))?.value;
    if (firstUnheld) setVehicleType(firstUnheld);
    setExistingApplication((apps && apps[0]) || null);
    setLoadingStatus(false);
  };

  useEffect(() => {
    if (userId) loadStatus();
  }, [userId]);

  // Role-based routing (App.tsx) only re-checks mbg_users.role_type on
  // login/session-init, not continuously — so approval alone doesn't move
  // this browser tab to RiderDashboard. Watch for the status flip live
  // (instead of only picking it up on next visit to this tab) so the CTA
  // to actually go there shows up right away.
  useEffect(() => {
    if (!existingApplication || existingApplication.status !== 'pending') return;
    const channel = supabase
      .channel(`mbg_operator_application_${existingApplication.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mbg_operator_applications', filter: `id=eq.${existingApplication.id}` },
        () => loadStatus()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingApplication?.id, existingApplication?.status]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('mbg_apply_as_operator', {
        p_vehicle_type: vehicleType,
        p_plate_number: plateNumber,
        p_license_number: licenseNumber,
        p_vehicle_model: vehicleModel || null,
        p_vehicle_color: vehicleColor || null,
        p_phone: phone || null,
        p_operator_home_city: operatorCity || null,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || 'Application failed');
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  if (existingApplication && existingApplication.status === 'pending') {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <div className="text-center space-y-2">
          <Clock className="mx-auto text-orange-500" size={40} />
          <h3 className="font-semibold text-slate-800">Application under review</h3>
          <p className="text-sm text-slate-500">
            Your {existingApplication.vehicle_type} application was submitted on{' '}
            {new Date(existingApplication.created_at).toLocaleDateString()}.
          </p>
        </div>
        <ApplicationChatThread applicationId={existingApplication.id} />
      </div>
    );
  }

  // Freshly approved (this session hasn't reloaded since) — role-based
  // routing needs a fresh session read to move this account to
  // RiderDashboard, so this is a real, necessary step, not busywork.
  if (existingApplication?.status === 'approved') {
    return (
      <div className="max-w-xl mx-auto p-6 text-center space-y-3">
        <CheckCircle className="mx-auto text-green-500" size={40} />
        <h3 className="font-semibold text-slate-800">You're approved as a {existingApplication.vehicle_type} operator! 🎉</h3>
        <p className="text-sm text-slate-500">Reload to switch into your Driver Dashboard and go online.</p>
        <button
          onClick={() => {
            // Without this, a reload lets UnifiedDashboard's hardcoded
            // developer>chairperson>rider>customer priority pick the
            // landing role — which silently sends anyone who also holds a
            // higher-priority role (e.g. chairperson, from unrelated
            // earlier testing) back to THAT dashboard instead of Rider.
            sessionStorage.setItem(PREFERRED_ROLE_KEY, 'rider');
            window.location.reload();
          }}
          className="px-6 py-3 bg-orange-500 text-white rounded-lg font-semibold"
        >
          Open Driver Dashboard
        </button>
      </div>
    );
  }

  const alreadyHasSelectedType = existingVehicleTypes.includes(vehicleType);

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center justify-center gap-2">
          <Truck className="text-orange-500" /> Become a rider or driver
        </h2>
        <p className="text-slate-500 text-sm mt-1">Pick a role and apply. A developer reviews every application before it goes live.</p>
      </div>

      {existingVehicleTypes.length > 0 && (
        <div className="bg-blue-50 text-blue-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            You're currently registered as a {existingVehicleTypes.join(' and ')} operator. Pick a different role below to add another.
          </span>
        </div>
      )}
      {existingApplication?.status === 'rejected' && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <span>Your last application was rejected{existingApplication.rejection_reason ? `: ${existingApplication.rejection_reason}` : '.'} You can apply again below.</span>
        </div>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Role</label>
          <div className="grid grid-cols-3 gap-3">
            {VEHICLE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isCurrent = existingVehicleTypes.includes(opt.value);
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setVehicleType(opt.value)}
                  className={`border rounded-lg p-3 text-left relative ${vehicleType === opt.value ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}
                >
                  {isCurrent && <span className="absolute top-1.5 right-1.5 text-[10px] font-semibold text-blue-600 bg-blue-100 rounded px-1.5 py-0.5">Current</span>}
                  <Icon className="text-orange-500 mb-1" size={18} />
                  <div className="font-medium text-sm text-slate-800">{opt.label}</div>
                </button>
              );
            })}
          </div>
          {alreadyHasSelectedType && (
            <p className="text-xs text-red-600 mt-2">You're already registered as a {vehicleType} operator — pick a different role to apply.</p>
          )}
        </div>

        <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Plate number" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} required />
        <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Driving license number" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <input className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Vehicle model (optional)" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
          <input className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Vehicle color (optional)" value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
        </div>
        <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />

        <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="City (optional)" value={operatorCity} onChange={(e) => setOperatorCity(e.target.value)} />

        <button
          type="submit"
          disabled={submitting || !plateNumber || !licenseNumber || alreadyHasSelectedType}
          className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold"
        >
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </div>
  );
}

// Reuses the same chat_conversations/chat_messages tables and chatService.ts
// functions as the support widget and the dev panel's Messages tab —
// mbg_apply_as_operator already opened this thread (kind='operator_application')
// and posted the automated "under review" notice into it.
function ApplicationChatThread({ applicationId }: { applicationId: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      let { data } = await supabase.from('chat_conversations').select('id').eq('application_id', applicationId).maybeSingle();
      if (!data) {
        // Applications submitted before chat integration existed have no
        // thread yet — back-fill one instead of showing nothing.
        const { data: ensured } = await supabase.rpc('mbg_ensure_operator_application_conversation', { p_application_id: applicationId });
        if (!ensured?.success) return;
        data = { id: ensured.conversation_id };
      }
      setConversationId(data.id);
      setMessages(await fetchMessages(data.id));
      await markConversationRead(data.id, 'user');
      unsub = subscribeToMessages(data.id, (msg) => setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])));
    })();
    return () => unsub?.();
  }, [applicationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    if (!reply.trim() || !conversationId) return;
    setSending(true);
    try {
      await sendMessage(conversationId, { senderRole: 'customer', body: reply.trim() });
      setReply('');
    } finally {
      setSending(false);
    }
  };

  if (!conversationId) return null;

  return (
    <div className="border rounded-lg bg-white flex flex-col" style={{ maxHeight: 320 }}>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${m.sender_role === 'dev' ? 'bg-slate-100 text-slate-800' : 'bg-orange-500 text-white ml-auto'}`}
          >
            <div className="text-[10px] font-semibold uppercase opacity-70 mb-0.5">{m.sender_role === 'dev' ? (m.sender_name || 'BodaGo Team') : 'You'}</div>
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-2 flex gap-2">
        <input
          className="flex-1 border rounded-lg p-2 text-sm bg-white text-slate-900 placeholder-slate-400"
          placeholder="Ask a question…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button onClick={send} disabled={sending || !reply.trim()} className="bg-orange-500 disabled:bg-slate-300 text-white rounded-lg px-3 flex items-center justify-center">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
