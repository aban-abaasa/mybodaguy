import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, MapPin, DollarSign, Users, Shield, TrendingUp, Globe, Lock, Send, User as UserIcon, Mail, ThumbsUp, X, Car, Package, Plane, Menu } from 'lucide-react';
import { authService } from '../services/authService';
import { userService } from '../services/userService';
import {
  createLandingMessage,
  fetchPublicThreads,
  getMyIcanBalance,
  getOrCreateGuestLikeKey,
  hasIcanWallet,
  likeMessage,
  listMyLandingMessages,
  replyToLandingMessage,
  subscribeToPublicLandingMessages,
  type LandingMessage,
  type LandingThread,
} from '../services/landingMessagesService';

interface Contributor {
  authId: string | null;
  name: string;
  count: number;
  isGuestGroup?: boolean;
}

interface LandingPageProps {
  onGetStarted: () => void;
}

interface Identity {
  authId: string;
  name: string;
  email: string;
}

interface GuestIdentity {
  name: string;
  email: string;
}

const GUEST_KEY = 'mbg_guest_identity';

const getGuestIdentity = (): GuestIdentity | null => {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
  } catch {
    return null;
  }
};

const setGuestIdentity = (identity: GuestIdentity) => {
  localStorage.setItem(GUEST_KEY, JSON.stringify(identity));
};

const fmtBoardTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString();
};

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    message: '',
    isPublic: true,
  });
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const [threads, setThreads] = useState<LandingThread[]>([]);
  const [myMessages, setMyMessages] = useState<LandingMessage[]>([]);
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyState, setReplyState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [guestIdentity, setGuestIdentityState] = useState<GuestIdentity | null>(() => getGuestIdentity());
  const [guestReplyForm, setGuestReplyForm] = useState({ name: '', email: '' });
  const [guestLikeKey] = useState<string>(() => getOrCreateGuestLikeKey());
  const [selectedContributor, setSelectedContributor] = useState<Contributor | null>(null);
  const [contributorBalance, setContributorBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileMenuOpen, closeMobileMenu]);

  // Real posters shown individually (name + message count); every guest
  // post (no user_id) folds into one aggregate "Guests" entry instead of
  // showing as separate unnamed people.
  const contributors = useMemo<Contributor[]>(() => {
    const byUser = new Map<string, Contributor>();
    let guestCount = 0;
    const visit = (m: LandingMessage) => {
      if (m.user_id) {
        const existing = byUser.get(m.user_id);
        if (existing) {
          existing.count += 1;
          existing.name = m.name || existing.name;
        } else {
          byUser.set(m.user_id, { authId: m.user_id, name: m.name || 'Community member', count: 1 });
        }
      } else {
        guestCount += 1;
      }
    };
    threads.forEach((t) => {
      visit(t);
      t.replies.forEach(visit);
    });
    const list = Array.from(byUser.values()).sort((a, b) => b.count - a.count);
    if (guestCount > 0) list.push({ authId: null, name: 'Guests', count: guestCount, isGuestGroup: true });
    return list;
  }, [threads]);

  const handleSelectContributor = (c: Contributor) => {
    if (c.isGuestGroup) return;
    setSelectedContributor(c);
    setContributorBalance(null);
    if (identity?.authId && c.authId === identity.authId) {
      setBalanceLoading(true);
      getMyIcanBalance(c.authId)
        .then((bal) => setContributorBalance(bal))
        .catch(() => setContributorBalance(null))
        .finally(() => setBalanceLoading(false));
    }
  };

  // Personalize the form for a visitor who's already signed in. Private
  // posting also requires an active ICAN wallet (cross-app identity check) —
  // a bare login isn't enough on its own.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await authService.getSession();
        const authUser = session?.user;
        if (!authUser || cancelled) return;

        let name = authUser.user_metadata?.full_name || authUser.email || 'User';
        try {
          const profile = await userService.getUserProfile(authUser.id);
          if (profile?.full_name) name = profile.full_name;
        } catch {
          // profile lookup is best-effort
        }

        if (cancelled) return;
        const id: Identity = { authId: authUser.id, name, email: authUser.email || '' };
        setIdentity(id);
        setContactForm((prev) => ({
          ...prev,
          name: prev.name || id.name || '',
          email: prev.email || id.email || '',
        }));
        hasIcanWallet(id.authId)
          .then((ok) => { if (!cancelled) setHasWallet(ok); })
          .catch(() => { if (!cancelled) setHasWallet(false); });
      } catch (err) {
        console.error('[LandingPage] failed to resolve identity:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Public community board — everyone can read these, live-updated.
  const loadThreads = useCallback(() => {
    return fetchPublicThreads(50, { authId: identity?.authId, guestKey: guestLikeKey })
      .then((rows) => setThreads(rows))
      .catch((err) => console.error('[LandingPage] failed to load public threads:', err));
  }, [identity?.authId, guestLikeKey]);

  useEffect(() => {
    loadThreads();
    return subscribeToPublicLandingMessages(() => { loadThreads(); });
  }, [loadThreads]);

  const handleLike = async (messageId: string) => {
    setThreads((prev) => prev.map((t) => {
      const bump = (m: LandingMessage) => (m.id === messageId && !m.likedByMe
        ? { ...m, likeCount: (m.likeCount || 0) + 1, likedByMe: true }
        : m);
      return { ...bump(t), replies: t.replies.map(bump) };
    }));
    try {
      await likeMessage({ messageId, authId: identity?.authId, guestKey: guestLikeKey });
    } catch (err) {
      console.error('[LandingPage] failed to like message:', err);
      loadThreads();
    }
  };

  // A signed-in visitor's own message history, public and private.
  useEffect(() => {
    if (!identity?.authId) { setMyMessages([]); return; }
    let cancelled = false;
    listMyLandingMessages(identity.authId)
      .then((rows) => { if (!cancelled) setMyMessages(rows); })
      .catch((err) => console.error('[LandingPage] failed to load your messages:', err));
    return () => { cancelled = true; };
  }, [identity?.authId]);

  const handleContactChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setContactForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleContactSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contactForm.message.trim() || submitState === 'sending') return;

    setSubmitState('sending');
    try {
      const saved = await createLandingMessage({
        name: contactForm.name,
        email: contactForm.email,
        message: contactForm.message,
        authId: identity?.authId || null,
        // Only a wallet-holding poster can go private — force public otherwise.
        isPublic: hasWallet ? contactForm.isPublic : true,
      });

      setSubmitState('sent');
      setContactForm((prev) => ({ ...prev, message: '' }));
      if (saved.is_public) {
        loadThreads();
      }
      if (identity?.authId) {
        setMyMessages((prev) => [saved, ...prev]);
      }
    } catch (err) {
      console.error('[LandingPage] failed to post message:', err);
      setSubmitState('error');
    }
  };

  const handleToggleThread = (threadId: string) => {
    setExpandedId((prev) => (prev === threadId ? null : threadId));
    setReplyDraft('');
    setReplyState('idle');
  };

  const handleSaveGuestReplyIdentity = () => {
    const name = guestReplyForm.name.trim();
    const email = guestReplyForm.email.trim();
    if (!name) return;
    const guest = { name, email };
    setGuestIdentity(guest);
    setGuestIdentityState(guest);
  };

  const handleSendReply = async (threadId: string) => {
    const body = replyDraft.trim();
    if (!body || replyState === 'sending') return;

    const who = identity
      ? { name: identity.name, email: identity.email, authId: identity.authId }
      : guestIdentity?.name
        ? { name: guestIdentity.name, email: guestIdentity.email, authId: null }
        : null;
    if (!who) return;

    setReplyState('sending');
    try {
      await replyToLandingMessage({ parentId: threadId, name: who.name, email: who.email, authId: who.authId, message: body });
      setReplyDraft('');
      setReplyState('idle');
      await loadThreads();
    } catch (err) {
      console.error('[LandingPage] failed to reply:', err);
      setReplyState('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F3] text-[#2C2416] font-classic-body overflow-x-hidden pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:pb-0">
      {/* Classic masthead strip — shorter copy on very small screens */}
      <div className="border-b border-[#C4A052]/40 bg-[#F3EDE3]">
        <p className="text-center text-[10px] xs:text-[11px] tracking-[0.15em] xs:tracking-[0.3em] uppercase text-[#8B6914] py-2 px-3 font-sans leading-snug">
          <span className="hidden xs:inline">Est. 2026 &middot; Your Trusted Ride Partner &middot; Uganda &amp; Beyond</span>
          <span className="xs:hidden">Trusted rides · Uganda &amp; beyond</span>
        </p>
      </div>

      {/* Header */}
      <header className="border-b border-[#2C2416]/10 bg-[#FAF8F3]/95 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-3 xs:px-4 py-3 xs:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 xs:gap-3 min-w-0">
            <div className="w-9 h-9 xs:w-10 xs:h-10 shrink-0 border-2 border-[#C4A052] flex items-center justify-center bg-[#2C2416]">
              <Bike size={18} className="text-[#C4A052] xs:hidden" />
              <Bike size={20} className="text-[#C4A052] hidden xs:block" />
            </div>
            <div className="min-w-0">
              <h1 className="font-classic-display text-lg xs:text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-[#2C2416] truncate">
                BodaGoEra
              </h1>
              <p className="hidden xs:block text-[10px] sm:text-xs tracking-[0.15em] sm:tracking-[0.2em] uppercase text-[#8B6914] font-sans truncate">
                Ride with dignity
              </p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm tracking-wide text-[#5C4D3A] font-sans">
            <a href="#features" className="hover:text-[#8B6914] transition-colors">Features</a>
            <a href="#journey" className="hover:text-[#8B6914] transition-colors">Global Journeys</a>
            <a href="#contact" className="hover:text-[#8B6914] transition-colors">Contact</a>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('bodagoera-install-requested'))}
              className="rounded-full border border-[#C4A052] px-4 py-2 font-semibold text-[#8B6914] transition-colors hover:bg-[#2C2416] hover:text-[#FAF8F3]"
            >
              Install app
            </button>
          </nav>
          <div className="flex items-center gap-1.5 xs:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="md:hidden landing-touch-target inline-flex items-center justify-center border border-[#C4A052]/40 text-[#2C2416] px-2.5"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              onClick={onGetStarted}
              className="hidden xs:inline-flex px-4 sm:px-5 py-2.5 border-2 border-[#2C2416] bg-[#2C2416] text-[#FAF8F3] text-xs sm:text-sm font-semibold tracking-wide hover:bg-[#8B6914] hover:border-[#8B6914] transition-colors font-sans landing-touch-target items-center"
            >
              Get Started
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-[#C4A052]/30 bg-[#FAF8F3] px-3 xs:px-4 py-2">
            {[
              { href: '#features', label: 'Features' },
              { href: '#journey', label: 'Global Journeys' },
              { href: '#contact', label: 'Contact' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMobileMenu}
                className="block py-3.5 text-base font-sans text-[#2C2416] border-b border-[#C4A052]/15 last:border-0 active:bg-[#F3EDE3]"
              >
                {link.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => { closeMobileMenu(); onGetStarted(); }}
              className="mt-2 w-full py-3.5 bg-[#2C2416] text-[#FAF8F3] text-sm font-semibold font-sans landing-touch-target"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={() => { closeMobileMenu(); window.dispatchEvent(new Event('bodagoera-install-requested')); }}
              className="mt-2 w-full border border-[#C4A052] py-3.5 text-[#8B6914] text-sm font-semibold font-sans landing-touch-target"
            >
              Install BodaGoEra
            </button>
          </nav>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden min-h-[min(480px,88vh)] sm:min-h-[520px] flex items-end sm:items-center">
        <div className="absolute inset-0">
          <img
            src="/images/hero-bodagoera.png"
            alt="Boda boda rider on a Kampala street at golden hour"
            className="h-full w-full object-cover object-[center_30%] sm:object-center"
            loading="eager"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#2C2416]/95 via-[#2C2416]/75 to-[#2C2416]/35 sm:bg-gradient-to-r sm:from-[#2C2416]/90 sm:via-[#2C2416]/65 sm:to-[#2C2416]/25" />
        </div>
        <div className="relative container mx-auto px-3 xs:px-4 py-10 xs:py-14 sm:py-24 md:py-32 lg:py-40 w-full">
          <div className="max-w-2xl">
            <p className="text-[#C4A052] text-[10px] xs:text-xs tracking-[0.25em] xs:tracking-[0.4em] uppercase mb-3 xs:mb-4 font-sans">
              Transport reimagined
            </p>
            <h2 className="font-classic-display text-[1.75rem] leading-[1.12] xs:text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-[#FAF8F3] mb-4 xs:mb-6">
              Ride Smart,<br />
              <span className="italic text-[#C4A052]">Earn More</span>
            </h2>
            <p className="text-sm xs:text-base sm:text-lg md:text-xl text-[#E8DFD0] leading-relaxed mb-6 xs:mb-8 max-w-xl">
              Fair commissions and dignified leadership for Uganda&apos;s boda boda sector — all in one platform.
            </p>
            <div className="flex flex-col xs:flex-row gap-3 xs:gap-4">
              <button
                onClick={onGetStarted}
                className="w-full xs:w-auto px-6 xs:px-8 py-3.5 bg-[#C4A052] text-[#2C2416] font-semibold tracking-wide hover:bg-[#D4B062] transition-colors font-sans landing-touch-target text-sm xs:text-base"
              >
                Join BodaGoEra Today
              </button>
              <a
                href="#features"
                className="w-full xs:w-auto px-6 xs:px-8 py-3.5 border border-[#FAF8F3]/50 text-[#FAF8F3] font-medium tracking-wide hover:bg-[#FAF8F3]/10 transition-colors font-sans inline-flex items-center justify-center landing-touch-target text-sm xs:text-base"
              >
                Learn More
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-[#C4A052]/30 bg-[#F3EDE3]">
        <div className="container mx-auto px-3 xs:px-4 py-5 xs:py-6 sm:py-8 grid grid-cols-2 md:grid-cols-4 gap-3 xs:gap-4 sm:gap-6 text-center">
          {[
            { label: 'Real-time GPS', short: 'GPS', sub: 'Live tracking' },
            { label: 'Fair Commissions', short: 'Fair pay', sub: 'Transparent' },
            { label: 'ICAN Wallet', short: 'ICAN', sub: 'Secure pay' },
            { label: 'Global Reach', short: 'Global', sub: 'Rides & flights' },
          ].map((item) => (
            <div key={item.label} className="px-1">
              <p className="font-classic-display text-sm xs:text-base sm:text-lg font-semibold text-[#2C2416] leading-snug">
                <span className="xs:hidden">{item.short}</span>
                <span className="hidden xs:inline">{item.label}</span>
              </p>
              <p className="text-[10px] xs:text-xs text-[#8B6914] mt-0.5 xs:mt-1 tracking-wide font-sans">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-3 xs:px-4 py-12 xs:py-16 md:py-20 scroll-mt-[4.5rem] md:scroll-mt-20">
        <div className="text-center mb-8 xs:mb-10 md:mb-14">
          <p className="text-[10px] xs:text-xs tracking-[0.25em] xs:tracking-[0.35em] uppercase text-[#8B6914] mb-2 xs:mb-3 font-sans">Our Promise</p>
          <h3 className="font-classic-display text-2xl xs:text-3xl md:text-4xl font-bold text-[#2C2416] px-2">
            Why Choose BodaGoEra?
          </h3>
          <div className="landing-classic-divider w-16 xs:w-24 mx-auto mt-4 xs:mt-6" />
        </div>

        <div className="grid lg:grid-cols-2 gap-5 xs:gap-8 lg:gap-10 max-w-6xl mx-auto mb-8 xs:mb-12">
          <div className="landing-classic-frame overflow-hidden border border-[#C4A052]/30">
            <img
              src="/images/community-riders.png"
              alt="Organized community of boda boda riders at a stage stop"
              className="w-full h-44 xs:h-56 sm:h-64 md:h-80 object-cover"
              loading="lazy"
            />
            <div className="p-4 xs:p-5 sm:p-6 bg-[#F3EDE3] border-t border-[#C4A052]/30">
              <h4 className="font-classic-display text-lg xs:text-xl font-bold text-[#2C2416] mb-2">
                Built for the Community
              </h4>
              <p className="text-sm xs:text-base text-[#5C4D3A] leading-relaxed">
                From district chairpersons to stage leaders — a hierarchical structure
                that respects tradition while bringing modern tools to every rider.
              </p>
            </div>
          </div>
          <div className="landing-classic-frame overflow-hidden border border-[#C4A052]/30">
            <img
              src="/images/secure-payments.png"
              alt="Secure mobile money and ICAN wallet payments"
              className="w-full h-44 xs:h-56 sm:h-64 md:h-80 object-cover"
              loading="lazy"
            />
            <div className="p-4 xs:p-5 sm:p-6 bg-[#F3EDE3] border-t border-[#C4A052]/30">
              <h4 className="font-classic-display text-lg xs:text-xl font-bold text-[#2C2416] mb-2">
                Payments You Can Trust
              </h4>
              <p className="text-sm xs:text-base text-[#5C4D3A] leading-relaxed">
                Mobile money, cash, and ICAN wallet — every transaction recorded,
                every commission distributed fairly and automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 xs:gap-6 max-w-6xl mx-auto">
          <FeatureCard
            icon={<MapPin className="text-[#8B6914]" size={28} />}
            title="Real-time Tracking"
            description="Track your ride in real-time with GPS navigation and live updates"
          />
          <FeatureCard
            icon={<DollarSign className="text-[#8B6914]" size={28} />}
            title="Fair Commissions"
            description="Transparent commission structure with automatic distribution to chairpersons"
          />
          <FeatureCard
            icon={<Users className="text-[#8B6914]" size={28} />}
            title="Organized System"
            description="Hierarchical structure from District to Stage level for better management"
          />
          <FeatureCard
            icon={<Shield className="text-[#8B6914]" size={28} />}
            title="Secure Payments"
            description="Multiple payment options including mobile money and cash"
          />
          <FeatureCard
            icon={<TrendingUp className="text-[#8B6914]" size={28} />}
            title="Earnings Analytics"
            description="Track your earnings, commissions, and performance metrics"
          />
          <FeatureCard
            icon={<Bike className="text-[#8B6914]" size={28} />}
            title="For Everyone"
            description="Customers, Riders, and Chairpersons all benefit from the platform"
          />
        </div>
      </section>

      {/* Beyond boda rides */}
      <section id="journey" className="bg-[#2C2416] text-[#FAF8F3]">
        <div className="container mx-auto px-4 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            <div>
              <p className="text-[#C4A052] text-xs tracking-[0.35em] uppercase mb-4 font-sans">Now Live</p>
              <h3 className="font-classic-display text-3xl md:text-4xl font-bold mb-5 leading-tight">
                Beyond boda rides —<br />
                <span className="italic text-[#C4A052]">going global.</span>
              </h3>
              <p className="text-[#C8BFB0] text-lg leading-relaxed mb-8">
                Book one continuous journey: a boda to the airport, a real flight, and a driver
                waiting for you the moment you land — anywhere in the world.
              </p>
              <button
                onClick={onGetStarted}
                className="px-7 py-3 bg-[#C4A052] text-[#2C2416] font-semibold tracking-wide hover:bg-[#D4B062] transition-colors font-sans"
              >
                Book a Journey
              </button>
            </div>
            <div className="landing-classic-frame border border-[#C4A052]/40 overflow-hidden">
              <img
                src="/images/global-journey.png"
                alt="Global journey connecting boda rides, flights, and shipping"
                className="w-full h-72 md:h-96 object-cover"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto mt-16">
            <FeatureCard
              dark
              icon={<Car className="text-[#C4A052]" size={28} />}
              title="Private Vehicles"
              description="Book a car or van for longer trips and larger groups, not just a boda."
            />
            <FeatureCard
              dark
              icon={<Package className="text-[#C4A052]" size={28} />}
              title="Global Shipping"
              description="Send packages across town or across borders, with door-to-door tracking."
            />
            <FeatureCard
              dark
              icon={<Plane className="text-[#C4A052]" size={28} />}
              title="Air Travel"
              description="Book a real flight alongside your everyday rides — a driver picks you up automatically when you land."
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <p className="text-xs tracking-[0.35em] uppercase text-[#8B6914] mb-3 font-sans">Simple Steps</p>
          <h3 className="font-classic-display text-3xl md:text-4xl font-bold text-[#2C2416]">
            How It Works
          </h3>
          <div className="landing-classic-divider w-24 mx-auto mt-6" />
        </div>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <StepCard
            number="I"
            title="Sign Up"
            description="Create your account as a customer, rider, or chairperson"
          />
          <StepCard
            number="II"
            title="Get Verified"
            description="Riders get approved by stage chairpersons, chairpersons by higher levels"
          />
          <StepCard
            number="III"
            title="Start Earning"
            description="Request rides, accept bookings, or earn commissions from your region"
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16 md:py-20">
        <div className="max-w-3xl mx-auto text-center border-2 border-[#C4A052]/50 bg-[#F3EDE3] landing-classic-frame p-10 md:p-14">
          <h3 className="font-classic-display text-3xl md:text-4xl font-bold text-[#2C2416] mb-4">
            Ready to Get Started?
          </h3>
          <p className="text-lg text-[#5C4D3A] mb-8 leading-relaxed">
            Join thousands of riders and customers using BodaGoEra every day
          </p>
          <button
            onClick={onGetStarted}
            className="px-10 py-3.5 bg-[#2C2416] text-[#FAF8F3] font-semibold tracking-wide hover:bg-[#8B6914] transition-colors font-sans"
          >
            Sign Up Now — It&apos;s Free
          </button>
        </div>
      </section>

      {/* Ask something / Contact */}
      <section id="contact" className="border-t border-[#C4A052]/30 bg-[#F3EDE3]">
        <div className="container mx-auto px-4 py-20">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs tracking-[0.35em] uppercase text-[#8B6914] mb-3 font-sans">Get in Touch</p>
            <h3 className="font-classic-display text-3xl md:text-4xl font-bold text-[#2C2416] mb-3">
              {identity ? `Welcome back, ${identity.name}.` : 'Ask us something'}
            </h3>
            <p className="text-[#5C4D3A] leading-relaxed">
              Questions about setup, riders, chairpersons, or commissions? Send us a message.
            </p>
          </div>

          <form onSubmit={handleContactSubmit} className="border border-[#C4A052]/40 bg-[#FAF8F3] landing-classic-frame p-6 md:p-8">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#5C4D3A] font-sans">Your name</label>
                <input
                  name="name"
                  value={contactForm.name}
                  onChange={handleContactChange}
                  className="w-full border border-[#C4A052]/30 bg-white px-4 py-3 text-[#2C2416] outline-none transition focus:ring-2 focus:ring-[#C4A052]/50 focus:border-[#C4A052] font-sans"
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#5C4D3A] font-sans">Email address</label>
                <input
                  type="email"
                  name="email"
                  value={contactForm.email}
                  onChange={handleContactChange}
                  className="w-full border border-[#C4A052]/30 bg-white px-4 py-3 text-[#2C2416] outline-none transition focus:ring-2 focus:ring-[#C4A052]/50 focus:border-[#C4A052] font-sans"
                  placeholder="jane@example.com"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-[#5C4D3A] font-sans">Message</label>
              <textarea
                name="message"
                value={contactForm.message}
                onChange={handleContactChange}
                rows={5}
                className="w-full border border-[#C4A052]/30 bg-white px-4 py-3 text-[#2C2416] outline-none transition focus:ring-2 focus:ring-[#C4A052]/50 focus:border-[#C4A052] font-sans"
                placeholder="Tell us what you need: rider onboarding, chairperson setup, commissions, or general questions."
              />
            </div>

            {identity && hasWallet ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={`flex cursor-pointer items-start gap-3 border p-4 transition ${
                  contactForm.isPublic ? 'border-[#C4A052] bg-[#F3EDE3]' : 'border-[#C4A052]/30 bg-white'
                }`}>
                  <input
                    type="radio"
                    name="visibility"
                    className="mt-1"
                    checked={contactForm.isPublic}
                    onChange={() => setContactForm((prev) => ({ ...prev, isPublic: true }))}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-[#2C2416] font-sans">
                      <Globe className="h-4 w-4" /> Public
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#8B6914]">Everyone can see this on the community board.</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 border p-4 transition ${
                  !contactForm.isPublic ? 'border-[#8B6914] bg-[#F3EDE3]' : 'border-[#C4A052]/30 bg-white'
                }`}>
                  <input
                    type="radio"
                    name="visibility"
                    className="mt-1"
                    checked={!contactForm.isPublic}
                    onChange={() => setContactForm((prev) => ({ ...prev, isPublic: false }))}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-[#2C2416] font-sans">
                      <Lock className="h-4 w-4" /> Private
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#8B6914]">Only you and the BodaGo team can see this.</span>
                  </span>
                </label>
              </div>
            ) : identity ? (
              <p className="mt-4 text-xs leading-5 text-[#8B6914]">
                Messages here are public — anyone can see them, but the BodaGoEra team can remove any message.
                Connect your ICAN wallet from your dashboard to unlock private messages.
              </p>
            ) : (
              <p className="mt-4 text-xs leading-5 text-[#8B6914]">
                Messages here are public — anyone can see them, but the BodaGoEra team can remove any message.
                Sign in with an ICAN wallet to choose public or private for your own messages.
              </p>
            )}

            <button
              type="submit"
              disabled={submitState === 'sending' || !contactForm.message.trim()}
              className="mt-5 inline-flex items-center gap-3 bg-[#2C2416] px-6 py-3 font-semibold text-[#FAF8F3] transition hover:bg-[#8B6914] disabled:opacity-50 font-sans"
            >
              <Mail className="h-5 w-5" />
              {submitState === 'sending' ? 'Posting…' : 'Send message'}
            </button>
            {submitState === 'sent' && (
              <p className="mt-3 text-sm text-emerald-700">Thanks — your message has been posted.</p>
            )}
            {submitState === 'error' && (
              <p className="mt-3 text-sm text-rose-700">Something went wrong sending that. Please try again.</p>
            )}
          </form>

          {identity && myMessages.length > 0 && (
            <div className="mt-6 border border-[#C4A052]/40 bg-[#FAF8F3] landing-classic-frame p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-[#8B6914] mb-3 font-sans">Your messages</p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {myMessages.map((m) => (
                  <div key={m.id} className="border border-[#C4A052]/20 bg-[#F3EDE3] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-medium font-sans ${
                        m.is_public
                          ? 'border-[#C4A052]/50 bg-[#FAF8F3] text-[#8B6914]'
                          : 'border-[#8B6914]/50 bg-[#FAF8F3] text-[#8B6914]'
                      }`}>
                        {m.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {m.is_public ? 'Public' : 'Private'}
                      </span>
                      <span className="text-[10px] text-[#8B6914] font-sans">{fmtBoardTime(m.created_at)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#5C4D3A]">{m.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </section>

      {/* Community board */}
      <section className="container mx-auto px-4 py-20">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#8B6914] font-sans">Community board</p>
            <h3 className="mt-2 font-classic-display text-3xl font-bold text-[#2C2416]">
              Public questions from the BodaGoEra community.
            </h3>
          </div>
          <p className="max-w-2xl text-sm text-[#5C4D3A] md:text-right leading-relaxed">
            Anyone can read these. The BodaGoEra team can remove any message.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-w-6xl mx-auto">
          {threads.map((m) => {
            const isExpanded = expandedId === m.id;
            const canReply = !!(identity || guestIdentity?.name);
            return (
              <article
                key={m.id}
                className={`border border-[#C4A052]/30 bg-[#FAF8F3] landing-classic-frame p-6 hover:border-[#C4A052]/60 transition-all ${isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}`}
              >
                <div role="button" tabIndex={0} onClick={() => handleToggleThread(m.id)} className="w-full cursor-pointer text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center border border-[#C4A052]/40 bg-[#F3EDE3] text-[#8B6914]">
                      <UserIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#2C2416] font-sans">{m.name || 'Website visitor'}</p>
                      <p className="text-xs text-[#8B6914] font-sans">{fmtBoardTime(m.created_at)}</p>
                    </div>
                    {m.reward_reason && (
                      <span className="flex-shrink-0 border border-[#C4A052]/50 bg-[#F3EDE3] px-2 py-0.5 text-[10px] font-medium text-[#8B6914] font-sans">
                        Rewarded
                      </span>
                    )}
                    {m.replies.length > 0 && (
                      <span className="flex-shrink-0 border border-[#C4A052]/30 px-2 py-0.5 text-[10px] font-medium text-[#5C4D3A] font-sans">
                        {m.replies.length} {m.replies.length === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-sm leading-7 text-[#5C4D3A]">{m.message}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleLike(m.id)}
                  disabled={m.likedByMe}
                  className={`mt-3 inline-flex items-center gap-1.5 border px-3 py-1 text-xs font-medium transition disabled:cursor-default font-sans ${
                    m.likedByMe ? 'border-[#C4A052] bg-[#F3EDE3] text-[#8B6914]' : 'border-[#C4A052]/30 text-[#5C4D3A] hover:bg-[#F3EDE3] disabled:opacity-100'
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> {m.likeCount || 0}
                </button>

                {isExpanded && (
                  <div className="mt-5 space-y-3 border-t border-[#C4A052]/20 pt-4">
                    {m.replies.map((r) => (
                      <div
                        key={r.id}
                        className={`border p-3 ${
                          r.sender_role === 'dev' ? 'border-[#C4A052]/50 bg-[#F3EDE3]' : 'border-[#C4A052]/20 bg-[#FAF8F3]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-semibold font-sans ${r.sender_role === 'dev' ? 'text-[#8B6914]' : 'text-[#2C2416]'}`}>
                              {r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}
                            </p>
                            {r.reward_reason && (
                              <span className="border border-[#C4A052]/50 bg-[#F3EDE3] px-2 py-0.5 text-[10px] font-medium text-[#8B6914] font-sans">
                                Correct answer
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[#8B6914] font-sans">{fmtBoardTime(r.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[#5C4D3A]">{r.message}</p>
                        <button
                          type="button"
                          onClick={() => handleLike(r.id)}
                          disabled={r.likedByMe}
                          className={`mt-2 inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-[11px] font-medium transition disabled:cursor-default font-sans ${
                            r.likedByMe ? 'border-[#C4A052] bg-[#F3EDE3] text-[#8B6914]' : 'border-[#C4A052]/30 text-[#5C4D3A] hover:bg-[#F3EDE3] disabled:opacity-100'
                          }`}
                        >
                          <ThumbsUp className="h-3 w-3" /> {r.likeCount || 0}
                        </button>
                      </div>
                    ))}
                    {m.replies.length === 0 && (
                      <p className="text-xs text-[#8B6914]">No replies yet.</p>
                    )}

                    {!canReply && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={guestReplyForm.name}
                          onChange={(e) => setGuestReplyForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="Your name"
                          className="border border-[#C4A052]/30 px-3 py-2 text-sm text-[#2C2416] outline-none focus:ring-2 focus:ring-[#C4A052]/50 font-sans"
                        />
                        <input
                          value={guestReplyForm.email}
                          onChange={(e) => setGuestReplyForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="Your email"
                          type="email"
                          className="border border-[#C4A052]/30 px-3 py-2 text-sm text-[#2C2416] outline-none focus:ring-2 focus:ring-[#C4A052]/50 font-sans"
                        />
                        <button
                          type="button"
                          onClick={handleSaveGuestReplyIdentity}
                          disabled={!guestReplyForm.name.trim()}
                          className="border border-[#C4A052]/40 px-3 py-2 text-xs font-medium text-[#5C4D3A] transition hover:bg-[#F3EDE3] disabled:opacity-40 sm:col-span-2 font-sans"
                        >
                          Continue as this name
                        </button>
                      </div>
                    )}

                    {canReply && (
                      <div className="flex items-center gap-2">
                        <input
                          value={replyDraft}
                          onChange={(e) => setReplyDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSendReply(m.id); }}
                          placeholder={`Reply as ${identity?.name || guestIdentity?.name}…`}
                          className="flex-1 border border-[#C4A052]/30 px-3 py-2 text-sm text-[#2C2416] outline-none focus:ring-2 focus:ring-[#C4A052]/50 font-sans"
                        />
                        <button
                          type="button"
                          onClick={() => handleSendReply(m.id)}
                          disabled={replyState === 'sending' || !replyDraft.trim()}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center bg-[#2C2416] text-[#FAF8F3] transition hover:bg-[#8B6914] disabled:opacity-40"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {replyState === 'error' && <p className="text-xs text-rose-700">Reply failed — please try again.</p>}
                  </div>
                )}
              </article>
            );
          })}
          {threads.length === 0 && (
            <p className="text-sm text-[#8B6914] col-span-full text-center py-8">No public messages yet — be the first to ask something.</p>
          )}
        </div>

        {contributors.length > 0 && (
          <div className="mt-10 max-w-6xl mx-auto">
            <p className="text-xs uppercase tracking-[0.3em] text-[#8B6914] font-sans">Community members</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {contributors.map((c) => (
                <button
                  key={c.authId || 'guests'}
                  type="button"
                  onClick={() => handleSelectContributor(c)}
                  disabled={c.isGuestGroup}
                  className="inline-flex items-center gap-2 border border-[#C4A052]/30 bg-[#FAF8F3] px-3 py-1.5 text-xs font-medium text-[#5C4D3A] transition hover:border-[#C4A052] disabled:cursor-default font-sans"
                >
                  <UserIcon className="h-3 w-3" /> {c.name}
                  <span className="text-slate-400">· {c.count} {c.count === 1 ? 'message' : 'messages'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {selectedContributor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedContributor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs border border-[#C4A052]/40 bg-[#FAF8F3] landing-classic-frame p-6"
          >
            <div className="flex items-center justify-between">
              <p className="font-classic-display text-lg font-semibold text-[#2C2416]">{selectedContributor.name}</p>
              <button onClick={() => setSelectedContributor(null)} className="text-[#8B6914]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-[#5C4D3A]">
              {selectedContributor.count} {selectedContributor.count === 1 ? 'message' : 'messages'} on the community board
            </p>
            {identity?.authId === selectedContributor.authId && (
              <div className="mt-4 border border-[#C4A052]/50 bg-[#F3EDE3] p-3">
                <p className="text-xs uppercase tracking-wide text-[#8B6914] font-sans">Your ICAN balance</p>
                <p className="mt-1 font-classic-display text-xl font-bold text-[#8B6914]">
                  {balanceLoading ? '…' : `${(contributorBalance ?? 0).toFixed(2)} ICAN`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t-2 border-[#2C2416]/10 bg-[#2C2416] text-[#C8BFB0]">
        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-3 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 border border-[#C4A052] flex items-center justify-center">
                  <Bike size={18} className="text-[#C4A052]" />
                </div>
                <span className="font-classic-display text-xl font-bold text-[#FAF8F3]">BodaGoEra</span>
              </div>
              <p className="text-sm leading-relaxed text-[#A89880]">
                Uganda&apos;s trusted boda boda platform — fair commissions, dignified leadership, and journeys that reach the world.
              </p>
            </div>
            <div>
              <p className="text-xs tracking-[0.25em] uppercase text-[#C4A052] mb-4 font-sans">Platform</p>
              <ul className="space-y-2 text-sm font-sans">
                <li><a href="#features" className="hover:text-[#C4A052] transition-colors">Features</a></li>
                <li><a href="#journey" className="hover:text-[#C4A052] transition-colors">Global Journeys</a></li>
                <li><a href="#contact" className="hover:text-[#C4A052] transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs tracking-[0.25em] uppercase text-[#C4A052] mb-4 font-sans">Part of IcanEra</p>
              <p className="text-sm leading-relaxed text-[#A89880]">
                Powered by ICAN wallet and the IcanEra ecosystem — one identity across transport, retail, and agriculture.
              </p>
            </div>
          </div>
          <div className="landing-classic-divider mb-6 opacity-40" />
          <div className="text-center text-sm text-[#8B7355] font-sans">
            <p>&copy; 2026 BodaGoEra. All rights reserved.</p>
            <p className="mt-1">Your Trusted Ride Partner in Uganda</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  dark = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  dark?: boolean;
}) {
  return (
    <div className={`border p-6 transition-all ${
      dark
        ? 'border-[#C4A052]/30 bg-[#FAF8F3]/5 hover:border-[#C4A052]/60'
        : 'border-[#C4A052]/30 bg-[#FAF8F3] landing-classic-frame hover:border-[#C4A052]/60'
    }`}>
      <div className="mb-4">{icon}</div>
      <h4 className={`font-classic-display text-xl font-bold mb-2 ${dark ? 'text-[#FAF8F3]' : 'text-[#2C2416]'}`}>
        {title}
      </h4>
      <p className={`leading-relaxed ${dark ? 'text-[#C8BFB0]' : 'text-[#5C4D3A]'}`}>{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="border border-[#C4A052]/30 bg-[#FAF8F3] landing-classic-frame p-8 text-center">
      <div className="w-14 h-14 border-2 border-[#C4A052] flex items-center justify-center mx-auto mb-5 font-classic-display text-[#8B6914] font-bold text-xl">
        {number}
      </div>
      <h4 className="font-classic-display text-xl font-bold text-[#2C2416] mb-2">{title}</h4>
      <p className="text-[#5C4D3A] leading-relaxed">{description}</p>
    </div>
  );
}
