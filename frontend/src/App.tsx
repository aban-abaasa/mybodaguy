import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { Bike, Bell, Menu, X, LogOut } from "lucide-react";
import { authService } from "./mybodaguy/services/authService";
import { userService } from "./mybodaguy/services/userService";
import SignInPage from "./mybodaguy/pages/SignInPage";
import LandingPage from "./mybodaguy/pages/LandingPage";
import UnifiedDashboard from "./mybodaguy/pages/UnifiedDashboard";

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    // Prevent multiple initialization in React Strict Mode
    let isInitialized = false;
    
    // Initialize auth state
    const initAuth = async () => {
      if (isInitialized) return;
      isInitialized = true;
      
      try {
        console.log('[MyBodaGuy] Initializing auth...');
        const session = await authService.getSession();
        console.log('[MyBodaGuy] Session:', session);
        if (session?.user) {
          setUser(session.user);
          console.log('[MyBodaGuy] Fetching user role for:', session.user.id);
          // Fetch user role
          const role = await userService.getUserRole(session.user.id);
          console.log('[MyBodaGuy] User role received:', role);
          
          if (!role) {
            console.warn('[MyBodaGuy] No role found for user. Tables may not exist or trigger not working.');
            // Still set loading to false so user sees an error instead of infinite loading
          }
          
          setUserRole(role);
        }
      } catch (error) {
        console.error('[MyBodaGuy] Auth initialization error:', error);
      } finally {
        console.log('[MyBodaGuy] Setting loading to false');
        setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth changes - debounce to prevent rapid state changes
    let timeoutId: NodeJS.Timeout;
    const { data: authListener } = authService.onAuthStateChange(async (event, session) => {
      console.log('[MyBodaGuy] Auth state changed:', event);
      
      // Clear any pending updates
      if (timeoutId) clearTimeout(timeoutId);
      
      // Only handle SIGNED_OUT event to prevent false logouts
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setUserRole(null);
        return;
      }
      
      // For SIGNED_IN and TOKEN_REFRESHED, debounce the update
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        timeoutId = setTimeout(async () => {
          setUser(session.user);
          const role = await userService.getUserRole(session.user.id);
          console.log('[MyBodaGuy] Role after auth change:', role);
          setUserRole(role);
        }, 100); // 100ms debounce
      }
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
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
      return (
        <>
          <SignInPage onBack={() => setShowAuth(false)} />
          <Toaster position="top-right" theme="light" />
        </>
      );
    }
    return (
      <>
        <LandingPage onGetStarted={() => setShowAuth(true)} />
        <Toaster position="top-right" theme="light" />
      </>
    );
  }

  // Authenticated but no role yet (shouldn't happen with trigger)
  if (!userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Setting up your account...</h2>
          <p className="text-slate-600 mb-4">
            Database tables may not be initialized. Please run the SQL setup in Supabase.
          </p>
          <div className="bg-white rounded-lg p-4 text-left text-sm">
            <p className="font-semibold mb-2">Quick Fix:</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600">
              <li>Go to Supabase Dashboard → SQL Editor</li>
              <li>Run: backend/database/COMPLETE_MYBODAGUY_SETUP.sql</li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-4 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Render unified dashboard that handles all roles
  return (
    <>
      <UnifiedDashboard user={user} onSignOut={handleSignOut} />
      <Toaster position="top-right" theme="light" />
    </>
  );
}

