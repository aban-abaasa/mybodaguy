import { useState, useEffect } from 'react';
import { ShoppingBag, Check, X, Clock, MapPin, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface Supermarket {
  id: string;
  name: string;
  location: string;
  commission_rate: number;
  distance_km?: number;
  logo?: string;
  is_applied: boolean;
  application_status?: 'pending' | 'approved' | 'rejected';
}

interface SupermarketPartnershipProps {
  riderId: string;
}

export default function SupermarketPartnership({ riderId }: SupermarketPartnershipProps) {
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'available' | 'applied'>('available');

  useEffect(() => {
    loadSupermarkets();
  }, [riderId]);

  const loadSupermarkets = async () => {
    setLoading(true);
    try {
      // TODO: Implement API call to fetch supermarkets
      // Placeholder data
      setSupermarkets([
        {
          id: '1',
          name: 'Shoprite Kampala',
          location: 'City Center, Kampala',
          commission_rate: 15,
          distance_km: 2.5,
          is_applied: false
        },
        {
          id: '2',
          name: 'Carrefour Nakasero',
          location: 'Nakasero Hill, Kampala',
          commission_rate: 18,
          distance_km: 3.2,
          is_applied: true,
          application_status: 'pending'
        },
        {
          id: '3',
          name: 'Quality Supermarket',
          location: 'Ntinda, Kampala',
          commission_rate: 20,
          distance_km: 5.0,
          is_applied: true,
          application_status: 'approved'
        },
        {
          id: '4',
          name: 'Game Stores',
          location: 'Lugogo, Kampala',
          commission_rate: 12,
          distance_km: 4.1,
          is_applied: false
        }
      ]);
    } catch (error) {
      toast.error('Failed to load supermarkets');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (supermarketId: string) => {
    setLoading(true);
    try {
      // TODO: Implement API call to apply for partnership
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setSupermarkets(supermarkets.map(sm => 
        sm.id === supermarketId 
          ? { ...sm, is_applied: true, application_status: 'pending' as const }
          : sm
      ));
      
      toast.success('Application submitted successfully');
    } catch (error) {
      toast.error('Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawApplication = async (supermarketId: string) => {
    setLoading(true);
    try {
      // TODO: Implement API call to withdraw application
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setSupermarkets(supermarkets.map(sm => 
        sm.id === supermarketId 
          ? { ...sm, is_applied: false, application_status: undefined }
          : sm
      ));
      
      toast.success('Application withdrawn');
    } catch (error) {
      toast.error('Failed to withdraw application');
    } finally {
      setLoading(false);
    }
  };

  const availableSupermarkets = supermarkets.filter(sm => !sm.is_applied);
  const appliedSupermarkets = supermarkets.filter(sm => sm.is_applied);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-slate-800 mb-2">Supermarket Partnerships</h3>
        <p className="text-sm text-slate-600">Apply to work for supermarkets and earn commissions on deliveries</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-200">
        <button
          onClick={() => setSelectedTab('available')}
          className={`px-4 py-2 font-medium transition-all relative ${
            selectedTab === 'available'
              ? 'text-orange-500'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          Available ({availableSupermarkets.length})
          {selectedTab === 'available' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
          )}
        </button>
        <button
          onClick={() => setSelectedTab('applied')}
          className={`px-4 py-2 font-medium transition-all relative ${
            selectedTab === 'applied'
              ? 'text-orange-500'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          My Applications ({appliedSupermarkets.length})
          {selectedTab === 'applied' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading && supermarkets.length === 0 ? (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <div className="space-y-4">
          {selectedTab === 'available' && (
            <>
              {availableSupermarkets.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-lg">
                  <ShoppingBag className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <p className="text-slate-600">No available supermarkets</p>
                  <p className="text-sm text-slate-500">You've applied to all nearby supermarkets</p>
                </div>
              ) : (
                availableSupermarkets.map((supermarket) => (
                  <SupermarketCard
                    key={supermarket.id}
                    supermarket={supermarket}
                    onApply={handleApply}
                    loading={loading}
                  />
                ))
              )}
            </>
          )}

          {selectedTab === 'applied' && (
            <>
              {appliedSupermarkets.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-lg">
                  <ShoppingBag className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <p className="text-slate-600">No applications yet</p>
                  <p className="text-sm text-slate-500">Apply to supermarkets to start earning commissions</p>
                </div>
              ) : (
                appliedSupermarkets.map((supermarket) => (
                  <ApplicationCard
                    key={supermarket.id}
                    supermarket={supermarket}
                    onWithdraw={handleWithdrawApplication}
                    loading={loading}
                  />
                ))
              )}
            </>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>How it works:</strong> Apply to supermarkets near your known areas. 
          Once approved, you'll receive delivery requests from customers shopping at these stores. 
          Earn commission on every successful delivery!
        </p>
      </div>
    </div>
  );
}

function SupermarketCard({ 
  supermarket, 
  onApply, 
  loading 
}: { 
  supermarket: Supermarket; 
  onApply: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="border-2 border-slate-200 rounded-lg p-5 hover:border-orange-300 transition-all bg-white">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
            <ShoppingBag className="text-orange-500" size={24} />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">{supermarket.name}</h4>
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <MapPin size={14} />
              {supermarket.location}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-600 mb-1">Commission Rate</p>
          <p className="text-lg font-bold text-slate-800">{supermarket.commission_rate}%</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-600 mb-1">Distance</p>
          <p className="text-lg font-bold text-slate-800">{supermarket.distance_km} km</p>
        </div>
      </div>

      <button
        onClick={() => onApply(supermarket.id)}
        disabled={loading}
        className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50"
      >
        Apply Now
      </button>
    </div>
  );
}

function ApplicationCard({ 
  supermarket, 
  onWithdraw, 
  loading 
}: { 
  supermarket: Supermarket; 
  onWithdraw: (id: string) => void;
  loading: boolean;
}) {
  const statusConfig = {
    pending: { color: 'yellow', icon: Clock, text: 'Pending Review' },
    approved: { color: 'green', icon: Check, text: 'Approved' },
    rejected: { color: 'red', icon: X, text: 'Rejected' }
  };

  const status = statusConfig[supermarket.application_status || 'pending'];
  const StatusIcon = status.icon;

  return (
    <div className={`border-2 rounded-lg p-5 transition-all ${
      supermarket.application_status === 'approved' 
        ? 'border-green-300 bg-gradient-to-br from-green-50 to-emerald-50'
        : supermarket.application_status === 'rejected'
        ? 'border-red-300 bg-red-50'
        : 'border-yellow-300 bg-yellow-50'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-sm">
            <ShoppingBag className="text-orange-500" size={24} />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-slate-800">{supermarket.name}</h4>
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <MapPin size={14} />
              {supermarket.location}
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-${status.color}-100 text-${status.color}-700`}>
          <StatusIcon size={16} />
          {status.text}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <p className="text-xs text-slate-600 mb-1">Commission Rate</p>
          <p className="text-lg font-bold text-slate-800">{supermarket.commission_rate}%</p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <p className="text-xs text-slate-600 mb-1">Distance</p>
          <p className="text-lg font-bold text-slate-800">{supermarket.distance_km} km</p>
        </div>
      </div>

      {supermarket.application_status === 'pending' && (
        <button
          onClick={() => onWithdraw(supermarket.id)}
          disabled={loading}
          className="w-full py-2.5 bg-white border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all disabled:opacity-50"
        >
          Withdraw Application
        </button>
      )}

      {supermarket.application_status === 'approved' && (
        <div className="bg-green-100 border border-green-200 rounded-lg p-3 text-center">
          <p className="text-sm text-green-800 font-medium">
            🎉 You can now accept delivery requests from this supermarket!
          </p>
        </div>
      )}

      {supermarket.application_status === 'rejected' && (
        <div className="bg-red-100 border border-red-200 rounded-lg p-3 text-center">
          <p className="text-sm text-red-800">
            Your application was not approved. You can try again later.
          </p>
        </div>
      )}
    </div>
  );
}
