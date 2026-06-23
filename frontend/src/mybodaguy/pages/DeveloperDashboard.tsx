import { useState, useEffect } from 'react';
import { 
  Bike, Users, MapPin, DollarSign, Settings, 
  TrendingUp, LogOut, Menu, X, Shield 
} from 'lucide-react';
import { toast } from 'sonner';
import { userService } from '../services/userService';
import RegionsManagement from '../components/RegionsManagement';

interface DeveloperDashboardProps {
  user: any;
  onSignOut: () => void;
}

export default function DeveloperDashboard({ user, onSignOut }: DeveloperDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await userService.getAllUsers();
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'regions', label: 'Regions', icon: MapPin },
    { id: 'commissions', label: 'Commissions', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Bike size={28} />
              <div>
                <h1 className="text-xl font-bold">My Boda Guy</h1>
                <p className="text-xs opacity-90">Developer Panel</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
                <Shield size={16} />
                <span className="text-sm font-medium">Developer</span>
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
        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-md p-2 mb-8 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          {activeTab === 'overview' && <OverviewTab onSwitchToRegions={() => setActiveTab('regions')} />}
          {activeTab === 'users' && <UsersTab users={users} loading={loading} onReload={loadUsers} />}
          {activeTab === 'regions' && <RegionsManagement />}
          {activeTab === 'commissions' && <CommissionsTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ onSwitchToRegions }: { onSwitchToRegions: () => void }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Platform Overview</h2>
      
      <div className="grid md:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total Users" value="0" icon={<Users className="text-orange-500" />} />
        <StatCard title="Active Riders" value="0" icon={<Bike className="text-orange-500" />} />
        <StatCard title="Total Rides" value="0" icon={<TrendingUp className="text-orange-500" />} />
        <StatCard title="Total Revenue" value="0 UGX" icon={<DollarSign className="text-orange-500" />} />
      </div>

      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-8 text-center">
        <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Developer Panel</h3>
        <p className="text-slate-600 mb-4">
          You have full control over the My Boda Guy platform. Start by setting up geographic regions 
          and assigning chairpersons.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <button 
            onClick={onSwitchToRegions}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md"
          >
            Setup Regions
          </button>
          <button className="px-6 py-2 bg-white text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all shadow-md border border-slate-200">
            Configure Commissions
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersTab({ users, loading, onReload }: { users: any[]; loading: boolean; onReload: () => void }) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading users...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">User Management</h2>
          <p className="text-sm text-slate-600 mt-1">
            All users start as <span className="font-semibold text-orange-600">customers</span> and can order rides/deliveries.
            Promote them to riders or chairpersons below.
          </p>
        </div>
        <button
          onClick={onReload}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all"
        >
          Refresh
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h4 className="font-semibold text-blue-800 mb-2">🎯 How It Works</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>✅ <strong>Customers:</strong> Anyone can sign up and immediately order rides/deliveries</li>
          <li>✅ <strong>Riders:</strong> Must be assigned by Stage Chairperson or Developer after signing up</li>
          <li>✅ <strong>Chairpersons:</strong> Must be assigned by higher-level Chairperson or Developer</li>
        </ul>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <p className="text-slate-600">No users yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Email</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Full Name</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Role</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Created</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 text-sm">{user.email}</td>
                  <td className="py-3 px-4 text-sm">
                    {user.mbg_user_profiles?.[0]?.full_name || 'N/A'}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                      user.role_type === 'developer' ? 'bg-purple-100 text-purple-700' :
                      user.role_type === 'chairperson' ? 'bg-blue-100 text-blue-700' :
                      user.role_type === 'rider' ? 'bg-green-100 text-green-700' :
                      'bg-orange-100 text-orange-700'
                    }`}>
                      {user.role_type}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                      user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    {user.role_type === 'customer' && user.email !== 'abanabaasa2@gmail.com' && (
                      <button className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors font-medium">
                        Promote
                      </button>
                    )}
                    {user.role_type === 'developer' && (
                      <span className="text-xs text-slate-400">Super Admin</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CommissionsTab() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Commission Settings</h2>
      <div className="bg-slate-50 rounded-lg p-8 text-center">
        <DollarSign className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600 mb-4">Commission configuration coming soon</p>
        <p className="text-sm text-slate-500">Configure commission percentages for each level of the hierarchy.</p>
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Platform Settings</h2>
      <div className="bg-slate-50 rounded-lg p-8 text-center">
        <Settings className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600 mb-4">Platform settings coming soon</p>
        <p className="text-sm text-slate-500">Configure global platform settings and preferences.</p>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-6 shadow-md border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-600">{title}</h3>
        {icon}
      </div>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
    </div>
  );
}
