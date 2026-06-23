import { useState } from 'react';
import { Bike, MapPin, DollarSign, TrendingUp, LogOut, Settings, Map, ShoppingBag } from 'lucide-react';
import RiderLocationManager from '../components/RiderLocationManager';
import RiderModeSelector from '../components/RiderModeSelector';
import SupermarketPartnership from '../components/SupermarketPartnership';

interface RiderDashboardProps {
  user: any;
  onSignOut: () => void;
}

type TabType = 'overview' | 'mode' | 'locations' | 'partnerships';

export default function RiderDashboard({ user, onSignOut }: RiderDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

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
                <p className="text-xs opacity-90">Rider Dashboard</p>
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

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-slate-200 sticky top-16 z-40">
        <div className="container mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            <TabButton
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon={<TrendingUp size={18} />}
              label="Overview"
            />
            <TabButton
              active={activeTab === 'mode'}
              onClick={() => setActiveTab('mode')}
              icon={<Settings size={18} />}
              label="Work Mode"
            />
            <TabButton
              active={activeTab === 'locations'}
              onClick={() => setActiveTab('locations')}
              icon={<Map size={18} />}
              label="My Areas"
            />
            <TabButton
              active={activeTab === 'partnerships'}
              onClick={() => setActiveTab('partnerships')}
              icon={<ShoppingBag size={18} />}
              label="Supermarkets"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid md:grid-cols-4 gap-6">
              <StatCard
                title="Today's Earnings"
                value="UGX 45,000"
                icon={<DollarSign size={24} />}
                color="green"
              />
              <StatCard
                title="Rides Completed"
                value="8"
                icon={<Bike size={24} />}
                color="blue"
              />
              <StatCard
                title="Rating"
                value="4.8 ⭐"
                icon={<TrendingUp size={24} />}
                color="yellow"
              />
              <StatCard
                title="Active Mode"
                value="Normal"
                icon={<Settings size={24} />}
                color="purple"
              />
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-slate-800 mb-4">Quick Start</h3>
              <div className="grid md:grid-cols-3 gap-4">
                <button
                  onClick={() => setActiveTab('mode')}
                  className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border-2 border-purple-200 hover:border-purple-400 transition-all text-left"
                >
                  <Settings className="text-purple-500 mb-3" size={32} />
                  <h4 className="font-bold text-slate-800 mb-1">Set Work Mode</h4>
                  <p className="text-sm text-slate-600">Choose VIP, Normal, or Return mode</p>
                </button>
                <button
                  onClick={() => setActiveTab('locations')}
                  className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border-2 border-blue-200 hover:border-blue-400 transition-all text-left"
                >
                  <Map className="text-blue-500 mb-3" size={32} />
                  <h4 className="font-bold text-slate-800 mb-1">Manage Areas</h4>
                  <p className="text-sm text-slate-600">Mark locations you know well</p>
                </button>
                <button
                  onClick={() => setActiveTab('partnerships')}
                  className="p-6 bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl border-2 border-orange-200 hover:border-orange-400 transition-all text-left"
                >
                  <ShoppingBag className="text-orange-500 mb-3" size={32} />
                  <h4 className="font-bold text-slate-800 mb-1">Partnerships</h4>
                  <p className="text-sm text-slate-600">Apply to work for supermarkets</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mode' && (
          <RiderModeSelector riderId={user.id} />
        )}

        {activeTab === 'locations' && (
          <RiderLocationManager riderId={user.id} />
        )}

        {activeTab === 'partnerships' && (
          <SupermarketPartnership riderId={user.id} />
        )}
      </div>
    </div>
  );
}

function TabButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string; 
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 font-medium transition-all relative whitespace-nowrap ${
        active
          ? 'text-orange-500'
          : 'text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      <span>{label}</span>
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
      )}
    </button>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  color 
}: { 
  title: string; 
  value: string; 
  icon: React.ReactNode; 
  color: string; 
}) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-12 h-12 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-600`}>
          {icon}
        </div>
      </div>
      <h4 className="text-sm text-slate-600 mb-1">{title}</h4>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
}
