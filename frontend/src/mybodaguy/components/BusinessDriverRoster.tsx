import { useEffect, useState, useCallback } from 'react';
import { UserPlus, Star, CheckCircle, XCircle, Car } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import type { BusinessCategory } from './BusinessRegistrationModal';

interface Driver {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  vehicle_type: string;
  operator_type: string;
  plate_number: string;
  status: string;
  is_available: boolean;
  rating: number | null;
  total_rides: number | null;
  escort_has_own_transport: boolean;
  created_at: string;
}

const VEHICLE_TYPES = ['motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck'];

export default function BusinessDriverRoster({ businessProfileId, category }: { businessProfileId: string; category: BusinessCategory }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState('');
  const [vehicleType, setVehicleType] = useState('motorcycle');
  const [plateNumber, setPlateNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [hasOwnTransport, setHasOwnTransport] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEscort = category === 'security_escort';
  const label = isEscort ? 'Escort' : 'Driver';

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('mbg_business_list_drivers', { p_business_profile_id: businessProfileId });
    if (!rpcError) setDrivers(data || []);
    setLoading(false);
  }, [businessProfileId]);

  useEffect(() => { load(); }, [load]);

  const addDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('mbg_business_add_driver', {
        p_business_profile_id: businessProfileId,
        p_driver_email: email.trim(),
        p_operator_type: isEscort ? 'escort' : (vehicleType === 'car' ? 'passenger' : (['van', 'truck'].includes(vehicleType) ? 'cargo' : 'passenger')),
        p_vehicle_type: vehicleType,
        p_plate_number: plateNumber.trim() || null,
        p_license_number: licenseNumber.trim() || null,
        p_escort_has_own_transport: isEscort ? hasOwnTransport : false,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || `Could not add ${label.toLowerCase()}`);
      toast.success(`${label} added`);
      setEmail(''); setPlateNumber(''); setLicenseNumber(''); setHasOwnTransport(false); setShowAdd(false);
      await load();
    } catch (err: any) {
      setError(err.message || `Could not add ${label.toLowerCase()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAvailable = async (driver: Driver) => {
    const { error: rpcError } = await supabase.rpc('mbg_business_set_driver_status', {
      p_rider_id: driver.id,
      p_is_available: !driver.is_available,
    });
    if (rpcError) { toast.error(rpcError.message); return; }
    await load();
  };

  const toggleTransport = async (driver: Driver) => {
    const { error: rpcError } = await supabase.rpc('mbg_business_set_escort_transport', {
      p_rider_id: driver.id,
      p_has_own_transport: !driver.escort_has_own_transport,
    });
    if (rpcError) { toast.error(rpcError.message); return; }
    await load();
  };

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-slate-800">{isEscort ? 'Escort Team' : 'Drivers'}</h4>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700"
        >
          <UserPlus size={16} /> Add {label.toLowerCase()}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addDriver} className="bg-slate-50 rounded-xl p-4 space-y-3">
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-2">{error}</div>}
          <input
            className="w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm"
            placeholder={`${label}'s account email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {isEscort && (
            <label className="flex items-start gap-2 text-xs text-slate-600 bg-white border rounded-lg p-2.5">
              <input
                type="checkbox"
                checked={hasOwnTransport}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setHasOwnTransport(checked);
                  if (!checked) { setVehicleType('motorcycle'); setPlateNumber(''); }
                }}
                className="mt-0.5"
              />
              <span>
                Has their own vehicle — can be booked as the whole trip (one fare). Leave unchecked if they
                only escort a ride booked with a separate driver (ride fare + escort fee) — an escort by
                itself has no vehicle to register.
              </span>
            </label>
          )}

          {/* Vehicle details only mean anything for a driver, or an escort
              who brings their own vehicle — an unarmed/on-foot escort has
              nothing to register here. */}
          {(!isEscort || hasOwnTransport) && (
            <div className="grid grid-cols-2 gap-2">
              <select
                className="border rounded-lg p-2.5 bg-white text-slate-900 text-sm"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
              >
                {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <input
                className="border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm"
                placeholder="Plate number"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
              />
            </div>
          )}
          <input
            className="w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm"
            placeholder="License number"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
          />
          <p className="text-xs text-slate-400">They need an existing BodaGoEra account with this email.</p>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            {submitting ? 'Adding…' : `Add ${label.toLowerCase()}`}
          </button>
        </form>
      )}

      {drivers.length === 0 ? (
        <p className="text-slate-400 text-sm text-center py-8">No {label.toLowerCase()}s yet.</p>
      ) : (
        <div className="space-y-2">
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div>
                <p className="text-sm font-medium text-slate-800">{d.full_name}</p>
                <p className="text-xs text-slate-400">
                  {d.email}
                  {(!isEscort || d.escort_has_own_transport) && ` · ${d.vehicle_type}${d.plate_number && d.plate_number !== 'PENDING' ? ` · ${d.plate_number}` : ''}`}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{d.status}</span>
                  {d.rating != null && (
                    <span className="text-xs flex items-center gap-0.5 text-amber-600">
                      <Star size={11} className="fill-amber-500 text-amber-500" /> {Number(d.rating).toFixed(1)}
                    </span>
                  )}
                  {isEscort && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.escort_has_own_transport ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                      {d.escort_has_own_transport ? 'Own vehicle' : 'Escort only'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={() => toggleAvailable(d)}
                  className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg ${
                    d.is_available ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {d.is_available ? <CheckCircle size={13} /> : <XCircle size={13} />}
                  {d.is_available ? 'Online' : 'Offline'}
                </button>
                {isEscort && (
                  <button
                    onClick={() => toggleTransport(d)}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg text-slate-500 hover:text-violet-700"
                  >
                    <Car size={12} /> {d.escort_has_own_transport ? 'Unmark vehicle' : 'Mark has vehicle'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
