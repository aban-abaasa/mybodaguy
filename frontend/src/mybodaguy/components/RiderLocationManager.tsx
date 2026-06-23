import { useState, useEffect } from 'react';
import { MapPin, Plus, X, Home, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Location {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  is_home: boolean;
}

interface RiderLocationManagerProps {
  riderId: string;
}

export default function RiderLocationManager({ riderId }: RiderLocationManagerProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: '',
    address: '',
    is_home: false
  });
  const [loading, setLoading] = useState(false);

  // TODO: Load rider's known locations from database
  useEffect(() => {
    loadLocations();
  }, [riderId]);

  const loadLocations = async () => {
    // TODO: Implement API call to fetch rider locations
    setLoading(true);
    try {
      // Placeholder data
      setLocations([
        {
          id: '1',
          name: 'Kampala Central',
          address: 'City Center, Kampala',
          is_home: true
        },
        {
          id: '2',
          name: 'Nakasero Market',
          address: 'Nakasero, Kampala',
          is_home: false
        }
      ]);
    } catch (error) {
      toast.error('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = async () => {
    if (!newLocation.name || !newLocation.address) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement API call to add location
      const location: Location = {
        id: Date.now().toString(),
        ...newLocation
      };
      
      setLocations([...locations, location]);
      setNewLocation({ name: '', address: '', is_home: false });
      setShowAddForm(false);
      toast.success('Location added successfully');
    } catch (error) {
      toast.error('Failed to add location');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLocation = async (locationId: string) => {
    try {
      // TODO: Implement API call to remove location
      setLocations(locations.filter(loc => loc.id !== locationId));
      toast.success('Location removed');
    } catch (error) {
      toast.error('Failed to remove location');
    }
  };

  const handleSetHomeLocation = async (locationId: string) => {
    try {
      // TODO: Implement API call to set home location
      setLocations(locations.map(loc => ({
        ...loc,
        is_home: loc.id === locationId
      })));
      toast.success('Home location updated');
    } catch (error) {
      toast.error('Failed to update home location');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-800">Areas I Know Well</h3>
          <p className="text-sm text-slate-600">Mark locations where you can navigate easily</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all"
        >
          {showAddForm ? <X size={18} /> : <Plus size={18} />}
          <span>{showAddForm ? 'Cancel' : 'Add Area'}</span>
        </button>
      </div>

      {/* Add Location Form */}
      {showAddForm && (
        <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-lg p-6 mb-6 border-2 border-orange-200">
          <h4 className="font-semibold text-slate-800 mb-4">Add New Location</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Area Name
              </label>
              <input
                type="text"
                value={newLocation.name}
                onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                placeholder="e.g., Kampala Central, Nakasero"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Detailed Address
              </label>
              <input
                type="text"
                value={newLocation.address}
                onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })}
                placeholder="e.g., City Center, Near Shoprite"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_home"
                checked={newLocation.is_home}
                onChange={(e) => setNewLocation({ ...newLocation, is_home: e.target.checked })}
                className="w-4 h-4 text-orange-500 border-slate-300 rounded focus:ring-orange-500"
              />
              <label htmlFor="is_home" className="text-sm text-slate-700">
                This is my home base location
              </label>
            </div>
            <button
              onClick={handleAddLocation}
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Location'}
            </button>
          </div>
        </div>
      )}

      {/* Locations List */}
      <div className="space-y-3">
        {loading && locations.length === 0 ? (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : locations.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-lg">
            <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-600">No locations added yet</p>
            <p className="text-sm text-slate-500">Add areas you know well to get more ride requests</p>
          </div>
        ) : (
          locations.map((location) => (
            <div
              key={location.id}
              className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                location.is_home
                  ? 'border-orange-500 bg-gradient-to-r from-orange-50 to-yellow-50'
                  : 'border-slate-200 bg-white hover:border-orange-300'
              }`}
            >
              <div className="flex items-center gap-3 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  location.is_home ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {location.is_home ? <Home size={20} /> : <MapPin size={20} />}
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                    {location.name}
                    {location.is_home && (
                      <span className="text-xs px-2 py-0.5 bg-orange-500 text-white rounded-full">
                        Home Base
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-slate-600">{location.address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!location.is_home && (
                  <button
                    onClick={() => handleSetHomeLocation(location.id)}
                    className="p-2 text-slate-600 hover:text-orange-500 transition-colors"
                    title="Set as home location"
                  >
                    <Home size={18} />
                  </button>
                )}
                <button
                  onClick={() => handleRemoveLocation(location.id)}
                  className="p-2 text-slate-600 hover:text-red-500 transition-colors"
                  title="Remove location"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Tip:</strong> Adding more areas you know well increases your chances of getting ride requests. 
          Your home base helps customers find you for return trips at discounted rates!
        </p>
      </div>
    </div>
  );
}
