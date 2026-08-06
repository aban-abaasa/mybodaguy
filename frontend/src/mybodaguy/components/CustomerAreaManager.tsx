import { useState, useEffect } from 'react';
import { MapPin, Plus, X, Star, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { reverseGeocode } from '../services/geocodeService';
import LocationPickerMap from './LocationPickerMap';
import type { Location } from '../data/mockLocations';

interface Area {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

interface CustomerAreaManagerProps {
  customerId: string;
}

export default function CustomerAreaManager({ customerId }: CustomerAreaManagerProps) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newArea, setNewArea] = useState({
    name: '',
    address: '',
    latitude: null as number | null,
    longitude: null as number | null,
    is_default: false
  });
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    loadAreas();
  }, [customerId]);

  const loadAreas = async () => {
    setLoading(true);
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
      toast.error('Failed to load your areas');
    } finally {
      setLoading(false);
    }
  };

  const captureCurrentPosition = () => {
    if (!navigator.geolocation) {
      toast.error('Your browser does not support GPS location');
      return;
    }
    setLocating(true);
    const savePosition = async (pos: GeolocationPosition) => {
      const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      setNewArea((prev) => ({
        ...prev,
        address: address || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }));
      toast.success('GPS location captured');
      setLocating(false);
    };
    const showLocationHelp = () => {
      toast.error('GPS needs permission and HTTPS. Use the secure site, or search/tap the map on local HTTP.');
      setLocating(false);
    };
    navigator.geolocation.getCurrentPosition(
      savePosition,
      () => navigator.geolocation.getCurrentPosition(savePosition, showLocationHelp, { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleAddArea = async () => {
    if (!newArea.name || !newArea.address || newArea.latitude == null || newArea.longitude == null) {
      toast.error('Choose the location on the map before saving');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('mbg_customer_areas').insert({
        customer_user_id: customerId,
        name: newArea.name,
        address: newArea.address,
        latitude: newArea.latitude,
        longitude: newArea.longitude,
        is_default: newArea.is_default
      });

      if (error) throw error;

      if (newArea.is_default) {
        await supabase
          .from('mbg_customer_areas')
          .update({ is_default: false })
          .eq('customer_user_id', customerId)
          .neq('name', newArea.name);
      }

      setNewArea({ name: '', address: '', latitude: null, longitude: null, is_default: false });
      setShowAddForm(false);
      toast.success('Area added successfully');
      await loadAreas();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add area');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveArea = async (areaId: string) => {
    try {
      const { error } = await supabase.from('mbg_customer_areas').delete().eq('id', areaId);
      if (error) throw error;
      setAreas(areas.filter((a) => a.id !== areaId));
      toast.success('Area removed');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to remove area');
    }
  };

  const handleSetDefault = async (areaId: string) => {
    try {
      await supabase.from('mbg_customer_areas').update({ is_default: false }).eq('customer_user_id', customerId);
      const { error } = await supabase.from('mbg_customer_areas').update({ is_default: true }).eq('id', areaId);
      if (error) throw error;
      setAreas(areas.map((a) => ({ ...a, is_default: a.id === areaId })));
      toast.success('Default area updated');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update default area');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <MapPin size={18} className="text-orange-500" /> My Areas
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Save your real pickup spots for faster, more accurate rides</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all"
        >
          {showAddForm ? <X size={16} /> : <Plus size={16} />}
          {showAddForm ? 'Cancel' : 'Add Area'}
        </button>
      </div>

      {showAddForm && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Area Name</label>
            <input
              type="text"
              value={newArea.name}
              onChange={(e) => setNewArea({ ...newArea, name: e.target.value })}
              placeholder="e.g., Home, Office, Ntinda"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Map-selected address</label>
            <input
              type="text"
              value={newArea.address}
              readOnly
              placeholder="Search or select a point on the map below"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-700 outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={captureCurrentPosition}
              disabled={locating}
              className="flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50"
            >
              <Crosshair size={16} className={locating ? 'animate-spin' : ''} />
              {locating ? 'Getting GPS location…' : 'Use my current GPS location'}
            </button>
            {newArea.latitude != null && newArea.longitude != null && (
              <p className="text-xs text-slate-500 mt-1">
                📍 {newArea.latitude.toFixed(5)}, {newArea.longitude.toFixed(5)}
              </p>
            )}
          </div>
          <LocationPickerMap
            pickup={newArea.latitude != null && newArea.longitude != null ? {
              id: 'new_area', name: newArea.name || 'Selected area', area: newArea.name || 'Selected area',
              fullAddress: newArea.address || 'Selected map location',
              coordinates: { lat: newArea.latitude, lng: newArea.longitude },
            } as Location : null}
            dropoff={null}
            selectionMode="pickup"
            onPickupChange={(location: Location) => setNewArea((prev) => ({
              ...prev,
              address: location.fullAddress,
              latitude: location.coordinates.lat,
              longitude: location.coordinates.lng,
            }))}
            onDropoffChange={() => {}}
          />
          <p className="text-xs text-slate-500">Use the search bar, current-location button, or tap/drag the green pin. Saving requires a map-selected coordinate.</p>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_default"
              checked={newArea.is_default}
              onChange={(e) => setNewArea({ ...newArea, is_default: e.target.checked })}
              className="w-4 h-4 text-orange-500 border-slate-300 rounded focus:ring-orange-500"
            />
            <label htmlFor="is_default" className="text-sm text-slate-700">Set as my default pickup area</label>
          </div>
          <button
            onClick={handleAddArea}
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save Area'}
          </button>
        </div>
      )}

      {loading && areas.length === 0 ? (
        <div className="text-center py-6">
          <div className="animate-spin w-6 h-6 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : areas.length === 0 ? (
        <div className="text-center py-8 bg-slate-50 rounded-lg">
          <MapPin className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No saved areas yet</p>
          <p className="text-xs text-slate-400 mt-0.5">Add your home, office, or favorite spots for quicker booking</p>
        </div>
      ) : (
        <div className="space-y-2">
          {areas.map((area) => (
            <div
              key={area.id}
              className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                area.is_default ? 'border-orange-400 bg-orange-50' : 'border-slate-100 bg-white'
              }`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  area.is_default ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  <MapPin size={16} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate flex items-center gap-1.5">
                    {area.name}
                    {area.is_default && <span className="text-[10px] px-1.5 py-0.5 bg-orange-500 text-white rounded-full">Default</span>}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{area.address}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!area.is_default && (
                  <button onClick={() => handleSetDefault(area.id)} className="p-2 text-slate-400 hover:text-orange-500" title="Set as default">
                    <Star size={16} />
                  </button>
                )}
                <button onClick={() => handleRemoveArea(area.id)} className="p-2 text-slate-400 hover:text-red-500" title="Remove">
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
