import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Flame, Home, MapPin, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { reverseGeocode } from '../services/geocodeService';
import { coveringArea, formatKm } from '../utils/riderAreas';
import SinglePinMap from './SinglePinMap';
import type { RiderSmartAssist } from './RiderSmartAssist';

interface Location {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_home: boolean;
}

interface Draft {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_home: boolean;
  // Once the rider types a field, moving the pin no longer overwrites it.
  nameTouched: boolean;
  addressTouched: boolean;
}

const EMPTY_DRAFT: Draft = { name: '', address: '', latitude: null, longitude: null, is_home: false, nameTouched: false, addressTouched: false };

interface RiderLocationManagerProps {
  riderId: string;
  /** The dashboard's smart assist: busy places the rider doesn't cover yet, and the list the Overview card shows. */
  assist?: Pick<RiderSmartAssist, 'hotspots' | 'addHotspot' | 'addingKey' | 'snooze' | 'areas' | 'reloadAreas'>;
}

const underlineInput =
  'input-bare w-full border-0 border-b border-[#c4a052]/60 bg-transparent py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-orange-500 dark:text-slate-100';

// Areas — the places a rider knows, as a plain classic list on the page itself. A saved
// area with a pin is what the matching engine uses to put the rider first for requests
// there, so the page is built around getting a pin on every area with as few taps as possible.
export default function RiderLocationManager({ riderId, assist }: RiderLocationManagerProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [geocoding, setGeocoding] = useState(false);
  // One row open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // An area being given (or moved to) a pin.
  const [pinEdit, setPinEdit] = useState<{ id: string; lat: number | null; lng: number | null } | null>(null);

  const loadLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('mbg_rider_locations')
        .select('id, name, address, latitude, longitude, is_home')
        .eq('rider_user_id', riderId)
        .order('is_home', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('[RiderLocationManager] Failed to load locations:', error);
      toast.error("Couldn't load your areas");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId]);

  // An area added from a "busy near you" suggestion (or anywhere else the dashboard saves one) shows up here too.
  const assistKey = assist?.areas.map(a => a.id).join(',') ?? '';
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistKey]);

  const changed = () => { assist?.reloadAreas(); };

  const closeForm = () => { setShowAddForm(false); setDraft(EMPTY_DRAFT); };

  const handlePinChange = async (lat: number, lng: number) => {
    setDraft(prev => ({ ...prev, latitude: lat, longitude: lng }));
    setGeocoding(true);
    try {
      const address = await reverseGeocode(lat, lng);
      if (!address) return;
      setDraft(prev => {
        if (prev.latitude !== lat || prev.longitude !== lng) return prev; // the pin moved again meanwhile
        return {
          ...prev,
          address: prev.addressTouched ? prev.address : address,
          name: prev.nameTouched ? prev.name : address.split(',')[0],
        };
      });
    } finally {
      setGeocoding(false);
    }
  };

  const covered = draft.latitude != null && draft.longitude != null ? coveringArea(draft.latitude, draft.longitude, locations) : null;
  const canSave = draft.latitude != null && draft.longitude != null && draft.name.trim() !== '' && !saving;

  const handleAddLocation = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const name = draft.name.trim();
      const { data: created, error } = await supabase
        .from('mbg_rider_locations')
        .insert({
          rider_user_id: riderId,
          name,
          address: draft.address.trim() || name,
          latitude: draft.latitude,
          longitude: draft.longitude,
          is_home: draft.is_home,
        })
        .select('id')
        .single();
      if (error) throw error;

      // Only one home base makes sense — clear it on every other row.
      if (draft.is_home && created?.id) {
        await supabase.from('mbg_rider_locations').update({ is_home: false }).eq('rider_user_id', riderId).neq('id', created.id);
      }

      closeForm();
      toast.success('Area saved');
      await loadLocations();
      changed();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't save the area");
    } finally {
      setSaving(false);
    }
  };

  const handleSetHome = async (id: string) => {
    try {
      const { error: clearError } = await supabase.from('mbg_rider_locations').update({ is_home: false }).eq('rider_user_id', riderId).neq('id', id);
      if (clearError) throw clearError;
      const { error } = await supabase.from('mbg_rider_locations').update({ is_home: true }).eq('id', id);
      if (error) throw error;
      // Home goes to the top, like the server's ordering.
      setLocations(prev => prev.map(l => ({ ...l, is_home: l.id === id })).sort((a, b) => Number(b.is_home) - Number(a.is_home)));
      toast.success('Home base set');
      changed();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't set home base");
    }
  };

  const restoreLocation = async (loc: Location) => {
    const { error } = await supabase.from('mbg_rider_locations').insert({
      rider_user_id: riderId, name: loc.name, address: loc.address,
      latitude: loc.latitude, longitude: loc.longitude, is_home: loc.is_home,
    });
    if (error) { toast.error("Couldn't bring it back"); return; }
    await loadLocations();
    changed();
  };

  // No confirm dialog: removing is instant and undoable from the toast.
  const handleRemove = async (loc: Location) => {
    try {
      const { error } = await supabase.from('mbg_rider_locations').delete().eq('id', loc.id);
      if (error) throw error;
      setLocations(prev => prev.filter(l => l.id !== loc.id));
      setExpandedId(null);
      setPinEdit(null);
      changed();
      toast(`${loc.name} removed`, { duration: 8000, action: { label: 'Undo', onClick: () => restoreLocation(loc) } });
    } catch (error: any) {
      toast.error(error?.message || "Couldn't remove it");
    }
  };

  const handleSavePin = async () => {
    if (!pinEdit || pinEdit.lat == null || pinEdit.lng == null) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('mbg_rider_locations')
        .update({ latitude: pinEdit.lat, longitude: pinEdit.lng })
        .eq('id', pinEdit.id);
      if (error) throw error;
      setLocations(prev => prev.map(l => (l.id === pinEdit.id ? { ...l, latitude: pinEdit.lat, longitude: pinEdit.lng } : l)));
      setPinEdit(null);
      toast.success('Pin saved');
      changed();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't save the pin");
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedId(cur => (cur === id ? null : id));
    setPinEdit(null);
  };

  const hotspots = (assist?.hotspots ?? []).slice(0, 2);

  return (
    <section className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <h2 className="font-classic-display text-xl font-semibold text-slate-800 dark:text-slate-100">Areas</h2>
        <div className="landing-classic-divider flex-1" />
        <button
          type="button"
          onClick={() => (showAddForm ? closeForm() : setShowAddForm(true))}
          aria-expanded={showAddForm}
          className="flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          {showAddForm ? <><X size={15} /> Close</> : <><Plus size={15} /> Add</>}
        </button>
      </div>

      {/* Add — the map comes first: one tap on it fills in the name and address. */}
      {showAddForm && (
        <div className="mt-4 space-y-4 border-b border-[#c4a052]/25 pb-5">
          <SinglePinMap lat={draft.latitude} lng={draft.longitude} onChange={handlePinChange} />

          {draft.latitude == null ? (
            <p className="text-xs text-slate-500">Tap the map or search to drop a pin.</p>
          ) : (
            <>
              <div className="space-y-3">
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value, nameTouched: true })}
                  placeholder="Name"
                  aria-label="Area name"
                  className={`${underlineInput} font-classic-display text-base font-semibold`}
                />
                <input
                  type="text"
                  value={draft.address}
                  onChange={e => setDraft({ ...draft, address: e.target.value, addressTouched: true })}
                  placeholder={geocoding ? 'Finding the address…' : 'Address'}
                  aria-label="Address"
                  className={underlineInput}
                />
              </div>

              {covered && (
                <p className="text-xs text-amber-700">
                  Near <strong>{covered.area.name}</strong> ({formatKm(covered.km)}) — you're already matched around here.
                </p>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={draft.is_home}
                onClick={() => setDraft({ ...draft, is_home: !draft.is_home })}
                className="flex w-full items-center justify-between py-1 text-sm text-slate-700 dark:text-slate-200"
              >
                <span className="flex items-center gap-2"><Home size={15} className="text-orange-500" /> My home base</span>
                <span className={`relative h-5 w-9 rounded-full transition-colors ${draft.is_home ? 'bg-orange-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${draft.is_home ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>

              <button
                type="button"
                onClick={handleAddLocation}
                disabled={!canSave}
                className="w-full rounded-full bg-orange-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 active:scale-[0.99] disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save area'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Busy places the rider doesn't cover yet — the same signal as the Overview nudge. */}
      {hotspots.length > 0 && assist && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Busy near you</p>
          <ul>
            {hotspots.map(h => (
              <li key={h.key} className="flex items-center gap-3 border-b border-[#c4a052]/20 py-3">
                <Flame size={18} className="w-7 flex-shrink-0 text-orange-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-classic-display text-[15px] font-semibold text-slate-800 dark:text-slate-100">{h.label}</p>
                  <p className="text-xs text-slate-500">{h.customers} customers · {h.requests} requests</p>
                </div>
                <button type="button" onClick={() => assist.snooze(h)} className="flex-shrink-0 text-xs text-slate-400 hover:text-slate-600">Not now</button>
                <button
                  type="button"
                  onClick={() => assist.addHotspot(h)}
                  disabled={assist.addingKey !== null}
                  className="flex-shrink-0 rounded-full border border-orange-400 px-3.5 py-1 text-xs font-semibold text-orange-600 transition-colors hover:bg-orange-50 active:scale-95 disabled:opacity-50"
                >
                  {assist.addingKey === h.key ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
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
      ) : locations.length === 0 ? (
        !showAddForm && (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500">Pin the places you know — requests there find you first.</p>
            <button type="button" onClick={() => setShowAddForm(true)} className="mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700">Add your first area</button>
          </div>
        )
      ) : (
        <ul className="mt-1">
          {locations.map(loc => {
            const open = expandedId === loc.id;
            const hasPin = loc.latitude != null && loc.longitude != null;
            const editingPin = pinEdit?.id === loc.id;
            return (
              <li key={loc.id} className="border-b border-[#c4a052]/20 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleRow(loc.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  {loc.is_home
                    ? <Home size={18} className="w-7 flex-shrink-0 text-orange-500" aria-hidden />
                    : <MapPin size={18} className="w-7 flex-shrink-0 text-slate-400" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className={`block font-classic-display text-[15px] font-semibold text-slate-800 dark:text-slate-100 ${open ? 'break-words' : 'truncate'}`}>{loc.name}</span>
                    {loc.address && loc.address !== loc.name && (
                      <span className={`block text-xs text-slate-500 ${open ? 'break-words' : 'truncate'}`}>{loc.address}</span>
                    )}
                  </span>
                  {loc.is_home && <span className="flex-shrink-0 text-xs font-semibold text-orange-600">Home</span>}
                  {!hasPin && <span className="flex-shrink-0 text-xs font-semibold text-amber-600">No pin</span>}
                  <ChevronDown size={15} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="space-y-3 pb-3 pl-10">
                    {editingPin && pinEdit ? (
                      <>
                        <SinglePinMap
                          lat={pinEdit.lat}
                          lng={pinEdit.lng}
                          height={220}
                          onChange={(lat, lng) => setPinEdit(prev => (prev ? { ...prev, lat, lng } : prev))}
                        />
                        <div className="flex items-center gap-4 text-sm">
                          <button
                            type="button"
                            onClick={handleSavePin}
                            disabled={saving || pinEdit.lat == null}
                            className="rounded-full bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
                          >
                            {saving ? 'Saving…' : 'Save pin'}
                          </button>
                          <button type="button" onClick={() => setPinEdit(null)} className="text-xs font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium">
                        {!loc.is_home && hasPin && (
                          <button type="button" onClick={() => handleSetHome(loc.id)} className="text-orange-600 hover:text-orange-700">Make home</button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPinEdit({ id: loc.id, lat: loc.latitude, lng: loc.longitude })}
                          className={hasPin ? 'text-slate-600 hover:text-slate-800' : 'text-orange-600 hover:text-orange-700'}
                        >
                          {hasPin ? 'Move pin' : 'Add pin'}
                        </button>
                        <button type="button" onClick={() => handleRemove(loc)} className="text-slate-500 hover:text-red-600">Remove</button>
                      </div>
                    )}
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
