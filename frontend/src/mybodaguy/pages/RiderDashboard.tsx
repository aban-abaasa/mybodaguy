import { Bike, MapPin, DollarSign, TrendingUp, LogOut } from 'lucide-react';

interface RiderDashboardProps {
  user: any;
  onSignOut: () => void;
}

export default function RiderDashboard({ user, onSignOut }: RiderDashboardProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Bike size={28} />
              <div>
                <h1 className="text-xl font-bold">My Boda Guy</h1>
                <p className="text-xs opacity-90">Rider Dashboard</p>
              </div>
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
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Rider Dashboard</h2>
          <p className="text-slate-600 mb-4">Accept rides and track your earnings</p>
          <p className="text-sm text-slate-500">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
