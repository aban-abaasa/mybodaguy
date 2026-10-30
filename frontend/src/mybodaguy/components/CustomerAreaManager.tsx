import { useState, useEffect } from 'react';
import { ChevronDown, MapPin, Plus, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import LocationPickerMap from './LocationPickerMap';
import { coveringArea, formatKm } from '../utils/riderAreas';
import type { Location } from '../data/mockLocations';

interface Area {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

interface Draft {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  // Once the customer types or taps a name, moving the pin no longer overwrites it.
  nameTouched: boolean;
}

const EMPTY_DRAFT: Draft = { name: '', address: '', latitude: null, longitude: null, is_default: false, nameTouched: false };

// Two saved spots closer than this are almost certainly the same place.
const SAME_SPOT_KM = 0.2;
const QUICK_NAMES = ['Home', 'Work'];

const underlineInput =
  'input-bare w-full border-0 border-b border-[#c4a052]/60 bg-transparent py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-orange-500 dark:text-slate-100';

interface CustomerAreaManagerProps {
  customerId: string;
}

// My Areas — the customer's saved spots (home, work…) as a plain classic list on the page
// itself. The default one pre-fills the drop-off when booking, so setting it is one tap.
export default function CustomerAreaManager({ customerId }: CustomerAreaManagerProps) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadAreas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const loadAreas = async () => {
    try {
      const { data, error } = await supabase
        .from('mbg_customer_areas')
        .select('id, name, address, latitude, longitude, is_default')
        .eq('customer_user_id', customerId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setAreas(data || []);
    } catch (error) {
      console.error('[CustomerAreaManager] Failed to load areas:', error);
      toast.error("Couldn't load your areas");
    } finally {
      setLoaded(true);
    }
  };

  // The first place a customer saves is the one they'll book from most.
  const openForm = () => {
    setDraft({ ...EMPTY_DRAFT, is_default: areas.length === 0 });
    setShowAddForm(true);
  };
  const closeForm = () => { setShowAddForm(false); setDraft(EMPTY_DRAFT); };

  // Fill the name from the map unless the customer has chosen one.
  const applyPoint = (lat: number, lng: number, address: string, label?: string) =>
    setDraft(prev => ({
      ...prev,
      address,
      latitude: lat,
      longitude: lng,
      name: prev.nameTouched ? prev.name : (label || address.split(',')[0] || '').trim(),
    }));

  const samespot = draft.latitude != null && draft.longitude != null
    ? coveringArea(draft.latitude, draft.longitude, areas, undefined, SAME_SPOT_KM)
    : null;
  const canSave = draft.latitude != null && draft.longitude != null && draft.name.trim() !== '' && !saving;
  const quickNames = QUICK_NAMES.filter(n => !areas.some(a => a.name.trim().toLowerCase() === n.toLowerCase()));

  const handleAddArea = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const name = draft.name.trim();
      const { data: created, error } = await supabase
        .from('mbg_customer_areas')
        .insert({
          customer_user_id: customerId,
          name,
          address: draft.address.trim() || name,
          latitude: draft.latitude,
          longitude: draft.longitude,
          is_default: draft.is_default,
        })
        .select('id')
        .single();
      if (error) throw error;

      // Only one default: clear it on every other row.
      if (draft.is_default && created?.id) {
        await supabase.from('mbg_customer_areas').update({ is_default: false }).eq('customer_user_id', customerId).neq('id', created.id);
      }

      closeForm();
      toast.success('Area saved');
      await loadAreas();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't save the area");
    } finally {
      setSaving(false);
    }
  };

  const restoreArea = async (area: Area) => {
    const { error } = await supabase.from('mbg_customer_areas').insert({
      customer_user_id: customerId, name: area.name, address: area.address,
      latitude: area.latitude, longitude: area.longitude, is_default: area.is_default,
    });
    if (error) { toast.error("Couldn't bring it back"); return; }
    await loadAreas();
  };

  // No confirm dialog: removing is instant and undoable from the toast.
  const handleRemoveArea = async (area: Area) => {
    try {
      const { error } = await supabase.from('mbg_customer_areas').delete().eq('id', area.id);
      if (error) throw error;
      setAreas(prev => prev.filter(a => a.id !== area.id));
      setExpandedId(null);
      toast(`${area.name} removed`, { duration: 8000, action: { label: 'Undo', onClick: () => restoreArea(area) } });
    } catch (error: any) {
      toast.error(error?.message || "Couldn't remove it");
    }
  };

  const handleSetDefault = async (areaId: string) => {
    try {
      const { error: clearError } = await supabase.from('mbg_customer_areas').update({ is_default: false }).eq('customer_user_id', customerId).neq('id', areaId);
      if (clearError) throw clearError;
      const { error } = await supabase.from('mbg_customer_areas').update({ is_default: true }).eq('id', areaId);
      if (error) throw error;
      // The default goes to the top, like the server's ordering.
      setAreas(prev => prev.map(a => ({ ...a, is_default: a.id === areaId })).sort((a, b) => Number(b.is_default) - Number(a.is_default)));
      toast.success('Default set');
    } catch (error: any) {
      toast.error(error?.message || "Couldn't set the default");
    }
  };

  return (
    <section className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <h2 className="font-classic-display text-xl font-semibold text-slate-800 dark:text-slate-100">My Areas</h2>
        <div className="landing-classic-divider flex-1" />
        <button
          type="button"
          onClick={() => (showAddForm ? closeForm() : openForm())}
          aria-expanded={showAddForm}
          className="flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          {showAddForm ? <><X size={15} /> Close</> : <><Plus size={15} /> Add</>}
        </button>
      </div>

      {/* Add — pin first, then the name is already filled in. */}
      {showAddForm && (
        <div className="mt-4 space-y-4 border-b border-[#c4a052]/25 pb-5">
          <LocationPickerMap
            pickup={draft.latitude != null && draft.longitude != null ? {
              id: 'new_area', name: draft.name || 'Selected area', area: draft.name || 'Selected area',
              fullAddress: draft.address || 'Selected map location',
              coordinates: { lat: draft.latitude, lng: draft.longitude },
            } as Location : null}
            dropoff={null}
            selectionMode="pickup"
            onPickupChange={(location: Location) =>
              applyPoint(location.coordinates.lat, location.coordinates.lng, location.fullAddress, location.name)}
            onDropoffChange={() => {}}
          />

          {draft.latitude != null && (
            <>
              <div>
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value, nameTouched: true })}
                  placeholder="Name"
                  aria-label="Area name"
                  className={`${underlineInput} font-classic-display text-base font-semibold`}
                />
                {quickNames.length > 0 && (
                  <div className="mt-2 flex gap-4 text-xs">
                    {quickNames.map(n => (
                      <button key={n} type="button" onClick={() => setDraft({ ...draft, name: n, nameTouched: true })} className="font-semibold text-orange-600 hover:text-orange-700">{n}</button>
                    ))}
                  </div>
                )}
                <p className="mt-2 break-words text-xs text-slate-500">{draft.address}</p>
              </div>

              {samespot && (
                <p className="text-xs text-amber-700">
                  You saved <strong>{samespot.area.name}</strong> {samespot.km < 0.05 ? 'right here' : `${formatKm(samespot.km)} away`}.
                </p>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={draft.is_default}
                onClick={() => setDraft({ ...draft, is_default: !draft.is_default })}
                className="flex w-full items-center justify-between py-1 text-sm text-slate-700 dark:text-slate-200"
              >
                <span className="flex items-center gap-2"><Star size={15} className="text-orange-500" /> Make it my default</span>
                <span className={`relative h-5 w-9 rounded-full transition-colors ${draft.is_default ? 'bg-orange-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${draft.is_default ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>

              <button
                type="button"
                onClick={handleAddArea}
                disabled={!canSave}
                className="w-full rounded-full bg-orange-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 active:scale-[0.99] disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save area'}
              </button>
            </>
          )}
        </div>
      )}

      {!loaded ? (
        <ul className="mt-2" aria-hidden>
          {[0, 1, 2].map(i => (
            <li key={i} className="flex animate-pulse items-center gap-3 border-b border-[#c4a052]/15 py-3.5">
              <div className="h-5 w-7 rounded bg-slate-200/70" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-2/5 rounded bg-slate-200/70" />
                <div className="h-3 w-3/5 rounded bg-slate-200/50" />
              </div>
            </li>
          ))}
        </ul>
      ) : areas.length === 0 ? (
        !showAddForm && (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500">Save home and work — book a ride in one tap.</p>
            <button type="button" onClick={openForm} className="mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700">Add your first area</button>
          </div>
        )
      ) : (
        <ul className="mt-1">
          {areas.map(area => {
            const open = expandedId === area.id;
            return (
              <li key={area.id} className="border-b border-[#c4a052]/20 last:border-0">
                <button
                  type="button"
                  onClick={() => setExpandedId(cur => (cur === area.id ? null : area.id))}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  {area.is_default
                    ? <Star size={18} className="w-7 flex-shrink-0 fill-orange-500 text-orange-500" aria-hidden />
                    : <MapPin size={18} className="w-7 flex-shrink-0 text-slate-400" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className={`block font-classic-display text-[15px] font-semibold text-slate-800 dark:text-slate-100 ${open ? 'break-words' : 'truncate'}`}>{area.name}</span>
                    {area.address && area.address !== area.name && (
                      <span className={`block text-xs text-slate-500 ${open ? 'break-words' : 'truncate'}`}>{area.address}</span>
                    )}
                  </span>
                  {area.is_default && <span className="flex-shrink-0 text-xs font-semibold text-orange-600">Default</span>}
                  <ChevronDown size={15} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-3 pl-10 text-sm font-medium">
                    {!area.is_default && (
                      <button type="button" onClick={() => handleSetDefault(area.id)} className="text-orange-600 hover:text-orange-700">Make default</button>
                    )}
                    <button type="button" onClick={() => handleRemoveArea(area)} className="text-slate-500 hover:text-red-600">Remove</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
