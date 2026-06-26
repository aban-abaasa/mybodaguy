import { useState } from 'react';
import { Bike, MapPin, DollarSign, TrendingUp, LogOut, Settings, Map, ShoppingBag, Menu, X, User, Package } from 'lucide-react';
import RiderLocationManager from '../components/RiderLocationManager';
import RiderModeSelector from '../components/RiderModeSelector';
import SupermarketPartnership from '../components/SupermarketPartnership';
import ProfileModal from '../components/ProfileModal';
import RiderICANEarnings from '../components/RiderICANEarnings';
import SupermarketDeliveryPool from '../components/SupermarketDeliveryPool';
import IcanCoinCard from '../components/IcanCoinCard';

interface RiderDashboardProps {
  user: any;
  onSignOut: () => void;
}

type TabType = 'overview' | 'mode' | 'locations' | 'partnerships' | 'deliveries';

export default function RiderDashboard({ user, onSignOut }: RiderDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  return (
    <div>
      {/* Content without header - header is in UnifiedDashboard */}
      
      {/* Navigation Tabs - Desktop Only */}
      <div className="hidden md:block bg-white border-b border-slate-200 sticky top-12 xs:top-14 sm:top-16 z-40">
        <div className="container mx-auto px-1 xs:px-2 sm:px-4">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
            <TabButton
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon={<TrendingUp size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Overview"
            />
            <TabButton
              active={activeTab === 'mode'}
              onClick={() => setActiveTab('mode')}
              icon={<Settings size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Work Mode"
            />
            <TabButton
              active={activeTab === 'locations'}
              onClick={() => setActiveTab('locations')}
              icon={<Map size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Areas"
            />
            <TabButton
              active={activeTab === 'partnerships'}
              onClick={() => setActiveTab('partnerships')}
              icon={<ShoppingBag size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Markets"
            />
          </div>
        </div>
      </div>

      {/* Mobile: Current Tab Indicator with Dropdown */}
      <div className="md:hidden bg-white border-b border-slate-200 sticky top-12 xs:top-14 z-40">
        <div className="container mx-auto px-2 xs:px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeTab === 'overview' && <><TrendingUp size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Overview</span></>}
            {activeTab === 'mode' && <><Settings size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Work Mode</span></>}
            {activeTab === 'locations' && <><Map size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Areas</span></>}
            {activeTab === 'partnerships' && <><ShoppingBag size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Markets</span></>}
          </div>
          
          {/* Mobile Menu Button */}
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {showMobileMenu ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {showMobileMenu && (
          <div className="absolute right-2 xs:right-3 top-14 bg-white rounded-lg shadow-xl py-2 min-w-[180px] xs:min-w-[200px] z-50">
            {/* Navigation Items */}
            <div className="py-1 border-b border-slate-200">
              <button
                onClick={() => {
                  setActiveTab('overview');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'overview' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <TrendingUp size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Overview</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('mode');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'mode' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Work Mode</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('locations');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'locations' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Map size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Areas</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('partnerships');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'partnerships' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <ShoppingBag size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Markets</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('deliveries');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'deliveries' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Package size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Deliveries</span>
              </button>
            </div>

            {/* Profile */}
            <button
              onClick={() => {
                setShowMobileMenu(false);
                setShowProfileModal(true);
              }}
              className="w-full px-3 xs:px-4 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <User size={14} className="xs:w-4 xs:h-4" />
              <span className="text-xs xs:text-sm font-medium">My Profile</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-2 xs:px-3 sm:px-4 py-3 xs:py-4 sm:py-8">
        {activeTab === 'overview' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-6">
              <StatCard
                title="Today's Earnings"
                value="UGX 45k"
                icon={<DollarSign size={20} className="sm:w-6 sm:h-6" />}
                color="green"
              />
              <StatCard
                title="Rides Done"
                value="8"
                icon={<Bike size={20} className="sm:w-6 sm:h-6" />}
                color="blue"
              />
              <StatCard
                title="Rating"
                value="4.8 ⭐"
                icon={<TrendingUp size={20} className="sm:w-6 sm:h-6" />}
                color="yellow"
              />
              <StatCard
                title="Mode"
                value="Normal"
                icon={<Settings size={20} className="sm:w-6 sm:h-6" />}
                color="purple"
              />
              <IcanCoinCard userId={user?.id} onGoToWallet={() => (window.location.href = '/ican-wallet')} />
            </div>

            {/* ICAN Wallet Earnings */}
            <RiderICANEarnings user={user} />

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
              <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-3 sm:mb-4">Quick Start</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <button
                  onClick={() => setActiveTab('mode')}
                  className="p-4 sm:p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border-2 border-purple-200 hover:border-purple-400 transition-all text-left"
                >
                  <Settings className="text-purple-500 mb-2 sm:mb-3" size={24} />
                  <h4 className="font-bold text-sm sm:text-base text-slate-800 mb-1">Set Work Mode</h4>
                  <p className="text-xs text-slate-600">VIP, Normal, Discount, or Return</p>
                </button>
                <button
                  onClick={() => setActiveTab('locations')}
                  className="p-4 sm:p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border-2 border-blue-200 hover:border-blue-400 transition-all text-left"
                >
                  <Map className="text-blue-500 mb-2 sm:mb-3" size={24} />
                  <h4 className="font-bold text-sm sm:text-base text-slate-800 mb-1">Manage Areas</h4>
                  <p className="text-xs text-slate-600">Mark locations you know well</p>
                </button>
                <button
                  onClick={() => setActiveTab('partnerships')}
                  className="p-4 sm:p-6 bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl border-2 border-orange-200 hover:border-orange-400 transition-all text-left"
                >
                  <ShoppingBag className="text-orange-500 mb-2 sm:mb-3" size={24} />
                  <h4 className="font-bold text-sm sm:text-base text-slate-800 mb-1">Partnerships</h4>
                  <p className="text-xs text-slate-600">Work for supermarkets</p>
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

        {activeTab === 'deliveries' && (
          <SupermarketDeliveryPool user={user} />
        )}
      </div>

      {/* Profile Modal */}
      <ProfileModal
        user={user}
        userRole="rider"
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={() => {
          // Optional: Reload rider data if needed
        }}
      />
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
      className={`flex items-center gap-1 sm:gap-2 px-2 xs:px-2.5 sm:px-4 py-1.5 xs:py-2 sm:py-3 font-medium transition-all relative whitespace-nowrap text-[10px] xs:text-xs sm:text-sm ${
        active
          ? 'text-orange-500'
          : 'text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      <span className="hidden xs:inline">{label}</span>
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
    <div className="bg-white rounded-lg xs:rounded-xl shadow-md p-2.5 xs:p-3 sm:p-6">
      <div className="flex items-center justify-between mb-1.5 xs:mb-2 sm:mb-3">
        <div className={`w-7 h-7 xs:w-8 xs:h-8 sm:w-12 sm:h-12 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-600`}>
          {icon}
        </div>
      </div>
      <h4 className="text-[9px] xs:text-[10px] sm:text-sm text-slate-600 mb-0.5 truncate leading-tight">{title}</h4>
      <p className="text-base xs:text-lg sm:text-2xl font-bold text-slate-800 truncate">{value}</p>
    </div>
  );
}
