import { useState } from 'react';
import { Bike, MapPin, Clock, Star, LogOut, Package, ShoppingBag, History } from 'lucide-react';
import EnhancedRideRequest from '../components/EnhancedRideRequest';

interface CustomerDashboardProps {
  user: any;
  onSignOut: () => void;
}

export default function CustomerDashboard({ user, onSignOut }: CustomerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'rides' | 'deliveries' | 'history'>('rides');

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Bike size={28} />
              <div>
                <h1 className="text-xl font-bold">My Boda Guy</h1>
                <p className="text-xs opacity-90">Your Trusted Partner</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
                <span className="text-sm font-medium">{user.email}</span>
              </div>
              <button
                onClick={onSignOut}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                <LogOut size={18} />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Welcome Banner */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <h2 className="text-3xl font-bold text-slate-800 mb-2">
            Welcome! 👋
          </h2>
          <p className="text-slate-600 mb-6">
            Request a ride or order delivery from your favorite supermarkets
          </p>

          {/* Service Type Selector */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setActiveTab('rides')}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all ${
                activeTab === 'rides'
                  ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Bike className="inline-block mr-2" size={20} />
              Book a Ride
            </button>
            <button
              onClick={() => setActiveTab('deliveries')}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all ${
                activeTab === 'deliveries'
                  ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Package className="inline-block mr-2" size={20} />
              Order Delivery
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <History className="inline-block mr-2" size={20} />
              History
            </button>
          </div>

          {/* Rides Tab */}
          {activeTab === 'rides' && (
            <EnhancedRideRequest customerId={user.id} />
          )}

          {/* Deliveries Tab */}
          {activeTab === 'deliveries' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-6 text-center border-2 border-dashed border-orange-200">
                <ShoppingBag className="w-16 h-16 text-orange-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                  Supermarket Delivery
                </h3>
                <p className="text-slate-600 mb-4">
                  Connect to supermarkets and get your items delivered to your doorstep
                </p>
                <button className="px-8 py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md">
                  Browse Supermarkets
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white border-2 border-slate-200 rounded-lg p-4 text-center hover:border-orange-500 transition-all cursor-pointer">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <ShoppingBag className="text-orange-500" size={24} />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Shoprite</p>
                </div>
                <div className="bg-white border-2 border-slate-200 rounded-lg p-4 text-center hover:border-orange-500 transition-all cursor-pointer">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <ShoppingBag className="text-orange-500" size={24} />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Carrefour</p>
                </div>
                <div className="bg-white border-2 border-slate-200 rounded-lg p-4 text-center hover:border-orange-500 transition-all cursor-pointer">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <ShoppingBag className="text-orange-500" size={24} />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Quality</p>
                </div>
                <div className="bg-white border-2 border-slate-200 rounded-lg p-4 text-center hover:border-orange-500 transition-all cursor-pointer">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <ShoppingBag className="text-orange-500" size={24} />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">More...</p>
                </div>
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="text-center py-12 bg-slate-50 rounded-lg">
              <Clock className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h4 className="text-lg font-semibold text-slate-800 mb-2">No Ride History</h4>
              <p className="text-slate-600">Your completed rides will appear here</p>
            </div>
          )}
        </div>

        {/* Info Cards - Removed Recent Activity section */}
        <div className="grid md:grid-cols-3 gap-6 mt-8">
          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Bike className="text-orange-500" size={24} />
            </div>
            <h4 className="font-semibold text-slate-800 mb-2">Fast Rides</h4>
            <p className="text-sm text-slate-600">Get a ride in minutes</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Package className="text-orange-500" size={24} />
            </div>
            <h4 className="font-semibold text-slate-800 mb-2">Quick Delivery</h4>
            <p className="text-sm text-slate-600">Supermarket items delivered</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Star className="text-orange-500" size={24} />
            </div>
            <h4 className="font-semibold text-slate-800 mb-2">Safe & Rated</h4>
            <p className="text-sm text-slate-600">Verified riders only</p>
          </div>
        </div>
      </div>
    </div>
  );
}
