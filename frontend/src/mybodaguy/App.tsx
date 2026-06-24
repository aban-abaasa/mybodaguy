import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { Bike, Bell, Menu, X, LogOut } from "lucide-react";
import { authService } from "./services/authService";
import { userService } from "./services/userService";
import SignInPage from "./pages/SignInPage";
import LandingPage from "./pages/LandingPage";
import DeveloperDashboard from "./pages/DeveloperDashboard";
import ChairpersonDashboard from "./pages/ChairpersonDashboard";
import RiderDashboard from "./pages/RiderDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";

export default function MyBodaGuyApp() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Initialize auth state
    const initAuth = async () => {
      console.log('[MyBodaGuy] Initializing auth...');
      try {
        const session = await authService.getSession();
        console.log('[MyBodaGuy] Session:', session ? 'Found' : 'null');
        
        if (session?.user) {
          setUser(session.user);
          // Fetch user role
          try {
            const role = await userService.getUserRole(session.user.id);
            console.log('[MyBodaGuy] User role:', role);
            setUserRole(role || 'customer'); // Default to customer instead of null
          } catch (err) {
            console.error('[MyBodaGuy] Error fetching role:', err);
            setUserRole('customer'); // Default to customer on error
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        console.log('[MyBodaGuy] Setting loading to false');
        setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth changes
    const { data: authListener } = authService.onAuthStateChange(async (event, session) => {
      console.log('[MyBodaGuy] Auth state changed:', event, session ? 'Session exists' : 'No session');
      
      if (session?.user) {
        setUser(session.user);
        try {
          const role = await userService.getUserRole(session.user.id);
          console.log('[MyBodaGuy] Role after auth change:', role);
          setUserRole(role || 'customer'); // Default to customer instead of null
        } catch (err) {
          console.error('[MyBodaGuy] Error fetching role after auth change:', err);
          setUserRole('customer'); // Default to customer on error
        }
      } else {
        // Only clear user state if this is an actual SIGNED_OUT event
        // Don't logout on token refresh or other transient events
        if (event === 'SIGNED_OUT') {
          console.log('[MyBodaGuy] User signed out');
          setUser(null);
          setUserRole(null);
        }
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await authService.signOut();
      setUser(null);
      setUserRole(null);
      toast.success('Signed out successfully');
    } catch (error) {
      toast.error('Failed to sign out');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">Loading My Boda Guy...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - show landing or sign in
  if (!user) {
    if (showAuth) {
      return <SignInPage onBack={() => setShowAuth(false)} />;
    }
    return <LandingPage onGetStarted={() => setShowAuth(true)} />;
  }

  // Authenticated but no role yet (shouldn't happen with trigger)
  if (!userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Setting up your account...</h2>
          <p className="text-slate-600">Please wait a moment</p>
        </div>
      </div>
    );
  }

  // Render role-specific dashboard
  const renderDashboard = () => {
    switch (userRole) {
      case 'developer':
        return <DeveloperDashboard user={user} onSignOut={handleSignOut} />;
      case 'chairperson':
        return <ChairpersonDashboard user={user} onSignOut={handleSignOut} />;
      case 'rider':
        return <RiderDashboard user={user} onSignOut={handleSignOut} />;
      case 'customer':
        return <CustomerDashboard user={user} onSignOut={handleSignOut} />;
      default:
        return (
          <div className="min-h-screen bg-white flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-800 mb-4">Unknown Role</h2>
              <button
                onClick={handleSignOut}
                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
              >
                Sign Out
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      {renderDashboard()}
      <Toaster position="top-right" theme="light" />
    </>
  );
}
