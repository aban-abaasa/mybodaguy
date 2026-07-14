import { useState, useEffect } from 'react';
import { ShoppingBag, Check, X, Clock, MapPin, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';

interface Supermarket {
  id: string;
  name: string;
  location: string;
  address: string | null;
  phone: string | null;
  business_type: string;
  is_applied: boolean;
  application_id?: string;
  application_status?: 'pending' | 'approved' | 'rejected';
}

const BUSINESS_TYPE_EMOJI: Record<string, string> = {
  supermarket: '🏪', hotel: '🏨', boutique: '👗', restaurant_cafe: '🍽️',
};

interface SupermarketPartnershipProps {
  riderId: string;
  vehicleType: string | null;
}

export default function SupermarketPartnership({ riderId, vehicleType }: SupermarketPartnershipProps) {
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'available' | 'applied'>('available');

  useEffect(() => {
    loadSupermarkets();
  }, [riderId]);

  const loadSupermarkets = async () => {
    setLoading(true);
    try {
      const [{ data: markets, error: marketsError }, { data: applications, error: appsError }] = await Promise.all([
        supabase
          .from('supermarkets')
          .select('id, name, location, address, phone, business_type')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('rider_supermarket_applications')
          .select('id, supermarket_id, status')
          .eq('rider_user_id', riderId),
      ]);

      if (marketsError) throw marketsError;
      if (appsError) throw appsError;

      const appBySupermarket = new Map((applications || []).map(a => [a.supermarket_id, a]));

      setSupermarkets(
        (markets || []).map((sm: any) => {
          const app = appBySupermarket.get(sm.id);
          return {
            id: sm.id,
            name: sm.name,
            location: sm.location,
            address: sm.address,
            phone: sm.phone,
            business_type: sm.business_type || 'supermarket',
            is_applied: !!app,
            application_id: app?.id,
            application_status: app?.status,
          };
        })
      );
    } catch (error) {
      console.error('[SupermarketPartnership] Failed to load supermarkets:', error);
      toast.error('Failed to load supermarkets');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (supermarketId: string) => {
    setLoading(true);
    try {
      const [{ data: authUser }, { data: profile }, { data: rider }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('mbg_user_profiles').select('full_name, phone').eq('user_id', riderId).maybeSingle(),
        // Scoped by vehicleType too — a person can hold more than one
        // mbg_riders row now, so this must record the vehicle they're
        // currently active as, not an arbitrary one of possibly several.
        supabase.from('mbg_riders').select('vehicle_type, license_number').eq('user_id', riderId).eq('vehicle_type', vehicleType).maybeSingle(),
      ]);

      const { error } = await supabase.from('rider_supermarket_applications').insert({
        supermarket_id: supermarketId,
        rider_user_id: riderId,
        rider_name: profile?.full_name || authUser?.user?.email?.split('@')[0] || 'Rider',
        rider_email: authUser?.user?.email || null,
        rider_phone: profile?.phone || null,
        vehicle_type: rider?.vehicle_type || null,
        license_number: rider?.license_number || null,
      });

      if (error) throw error;

      toast.success('Application submitted successfully');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawApplication = async (supermarketId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('rider_supermarket_applications')
        .delete()
        .eq('supermarket_id', supermarketId)
        .eq('rider_user_id', riderId);

      if (error) throw error;

      toast.success('Application withdrawn');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to withdraw application');
    } finally {
      setLoading(false);
    }
  };

  const availableSupermarkets = supermarkets.filter(sm => !sm.is_applied);
  const appliedSupermarkets = supermarkets.filter(sm => sm.is_applied);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Supermarket Partnerships</h3>
          <p className="text-sm text-slate-600">Apply to work for supermarkets and earn commissions on deliveries</p>
        </div>
        <button
          onClick={loadSupermarkets}
          disabled={loading}
          className="text-sm text-orange-600 hover:text-orange-700 font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
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
                  <p className="text-sm text-slate-500">You've applied to all registered supermarkets</p>
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
          <strong>How it works:</strong> Apply to any registered supermarket on the platform.
          Once approved, you'll receive delivery requests from customers shopping at that store.
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
            <h4 className="font-bold text-slate-800">{BUSINESS_TYPE_EMOJI[supermarket.business_type] || '🏪'} {supermarket.name}</h4>
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <MapPin size={14} />
              {supermarket.location}
            </div>
            {supermarket.phone && (
              <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                <Phone size={14} />
                {supermarket.phone}
              </div>
            )}
          </div>
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
            <h4 className="font-bold text-slate-800">{BUSINESS_TYPE_EMOJI[supermarket.business_type] || '🏪'} {supermarket.name}</h4>
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
