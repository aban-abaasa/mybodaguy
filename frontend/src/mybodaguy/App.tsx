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
      try {
        const session = await authService.getSession();
        if (session?.user) {
          setUser(session.user);
          // Fetch user role
          const role = await userService.getUserRole(session.user.id);
          setUserRole(role);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth changes
    const { data: authListener } = authService.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        const role = await userService.getUserRole(session.user.id);
        setUserRole(role);
      } else {
        setUser(null);
        setUserRole(null);
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
