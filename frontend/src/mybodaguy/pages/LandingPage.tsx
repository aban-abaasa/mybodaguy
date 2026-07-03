import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, MapPin, DollarSign, Users, Shield, TrendingUp, Globe, Lock, Send, User as UserIcon, Mail, ThumbsUp, X } from 'lucide-react';
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-xl flex items-center justify-center shadow-lg">
              <Bike size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">My Boda Guy</h1>
              <p className="text-sm text-slate-600">Your Trusted Ride Partner</p>
            </div>
          </div>
          <button
            onClick={onGetStarted}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg"
          >
            Get Started
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-5xl md:text-6xl font-bold text-slate-800 mb-6">
            Ride Smart, Earn More
          </h2>
          <p className="text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
            The complete boda boda management system with fair commission distribution
            and hierarchical leadership structure for Uganda's transport sector
          </p>
          <button
            onClick={onGetStarted}
            className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-2xl"
          >
            Join My Boda Guy Today
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h3 className="text-3xl font-bold text-center text-slate-800 mb-12">
          Why Choose My Boda Guy?
        </h3>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <FeatureCard
            icon={<MapPin className="text-orange-500" size={32} />}
            title="Real-time Tracking"
            description="Track your ride in real-time with GPS navigation and live updates"
          />
          <FeatureCard
            icon={<DollarSign className="text-orange-500" size={32} />}
            title="Fair Commissions"
            description="Transparent commission structure with automatic distribution to chairpersons"
          />
          <FeatureCard
            icon={<Users className="text-orange-500" size={32} />}
            title="Organized System"
            description="Hierarchical structure from District to Stage level for better management"
          />
          <FeatureCard
            icon={<Shield className="text-orange-500" size={32} />}
            title="Secure Payments"
            description="Multiple payment options including mobile money and cash"
          />
          <FeatureCard
            icon={<TrendingUp className="text-orange-500" size={32} />}
            title="Earnings Analytics"
            description="Track your earnings, commissions, and performance metrics"
          />
          <FeatureCard
            icon={<Bike className="text-orange-500" size={32} />}
            title="For Everyone"
            description="Customers, Riders, and Chairpersons all benefit from the platform"
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <h3 className="text-3xl font-bold text-center text-slate-800 mb-12">
          How It Works
        </h3>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <StepCard
            number="1"
            title="Sign Up"
            description="Create your account as a customer, rider, or chairperson"
          />
          <StepCard
            number="2"
            title="Get Verified"
            description="Riders get approved by stage chairpersons, chairpersons by higher levels"
          />
          <StepCard
            number="3"
            title="Start Earning"
            description="Request rides, accept bookings, or earn commissions from your region"
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl p-12">
          <h3 className="text-4xl font-bold text-slate-800 mb-4">
            Ready to Get Started?
          </h3>
          <p className="text-xl text-slate-600 mb-8">
            Join thousands of riders and customers using My Boda Guy every day
          </p>
          <button
            onClick={onGetStarted}
            className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg"
          >
            Sign Up Now - It's Free!
          </button>
        </div>
      </section>

      {/* Ask something / Contact */}
      <section id="contact" className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-3xl font-bold text-slate-800 mb-2">
              {identity ? `Welcome back, ${identity.name}.` : 'Ask us something'}
            </h3>
            <p className="text-slate-600">
              Questions about setup, riders, chairpersons, or commissions? Send us a message.
            </p>
          </div>

          <form onSubmit={handleContactSubmit} className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Your name</label>
                <input
                  name="name"
                  value={contactForm.name}
                  onChange={handleContactChange}
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-slate-800 outline-none transition focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Email address</label>
                <input
                  type="email"
                  name="email"
                  value={contactForm.email}
                  onChange={handleContactChange}
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-slate-800 outline-none transition focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  placeholder="jane@example.com"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-slate-700">Message</label>
              <textarea
                name="message"
                value={contactForm.message}
                onChange={handleContactChange}
                rows={5}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-slate-800 outline-none transition focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                placeholder="Tell us what you need: rider onboarding, chairperson setup, commissions, or general questions."
              />
            </div>

            {identity && hasWallet ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                  contactForm.isPublic ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="visibility"
                    className="mt-1"
                    checked={contactForm.isPublic}
                    onChange={() => setContactForm((prev) => ({ ...prev, isPublic: true }))}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Globe className="h-4 w-4" /> Public
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Everyone can see this on the community board.</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                  !contactForm.isPublic ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="visibility"
                    className="mt-1"
                    checked={!contactForm.isPublic}
                    onChange={() => setContactForm((prev) => ({ ...prev, isPublic: false }))}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Lock className="h-4 w-4" /> Private
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Only you and the My Boda Guy team can see this.</span>
                  </span>
                </label>
              </div>
            ) : identity ? (
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Messages here are public — anyone can see them, but the My Boda Guy team can remove any message.
                Connect your ICAN wallet from your dashboard to unlock private messages.
              </p>
            ) : (
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Messages here are public — anyone can see them, but the My Boda Guy team can remove any message.
                Sign in with an ICAN wallet to choose public or private for your own messages.
              </p>
            )}

            <button
              type="submit"
              disabled={submitState === 'sending' || !contactForm.message.trim()}
              className="mt-5 inline-flex items-center gap-3 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:from-orange-600 hover:to-yellow-600 disabled:opacity-50"
            >
              <Mail className="h-5 w-5" />
              {submitState === 'sending' ? 'Posting…' : 'Send message'}
            </button>
            {submitState === 'sent' && (
              <p className="mt-3 text-sm text-emerald-600">Thanks — your message has been posted.</p>
            )}
            {submitState === 'error' && (
              <p className="mt-3 text-sm text-rose-600">Something went wrong sending that. Please try again.</p>
            )}
          </form>

          {identity && myMessages.length > 0 && (
            <div className="mt-6 bg-white rounded-2xl shadow-lg p-6">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-3">Your messages</p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {myMessages.map((m) => (
                  <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        m.is_public
                          ? 'border-orange-200 bg-orange-50 text-orange-600'
                          : 'border-amber-200 bg-amber-50 text-amber-600'
                      }`}>
                        {m.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {m.is_public ? 'Public' : 'Private'}
                      </span>
                      <span className="text-[10px] text-slate-400">{fmtBoardTime(m.created_at)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{m.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Community board */}
      <section className="container mx-auto px-4 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
          <div>
            <p className="text-sm uppercase tracking-wide text-orange-500 font-semibold">Community board</p>
            <h3 className="mt-1 text-3xl font-bold text-slate-800">
              Public questions from the My Boda Guy community.
            </h3>
          </div>
          <p className="max-w-2xl text-sm text-slate-600 md:text-right">
            Anyone can read these. The My Boda Guy team can remove any message.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-w-6xl mx-auto">
          {threads.map((m) => {
            const isExpanded = expandedId === m.id;
            const canReply = !!(identity || guestIdentity?.name);
            return (
              <article
                key={m.id}
                className={`bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all ${isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}`}
              >
                <div role="button" tabIndex={0} onClick={() => handleToggleThread(m.id)} className="w-full cursor-pointer text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-100 to-yellow-100 text-orange-500">
                      <UserIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{m.name || 'Website visitor'}</p>
                      <p className="text-xs text-slate-500">{fmtBoardTime(m.created_at)}</p>
                    </div>
                    {m.reward_reason && (
                      <span className="flex-shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                        🪙 Rewarded
                      </span>
                    )}
                    {m.replies.length > 0 && (
                      <span className="flex-shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {m.replies.length} {m.replies.length === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{m.message}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleLike(m.id)}
                  disabled={m.likedByMe}
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-default ${
                    m.likedByMe ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-100'
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> {m.likeCount || 0}
                </button>

                {isExpanded && (
                  <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                    {m.replies.map((r) => (
                      <div
                        key={r.id}
                        className={`rounded-lg border p-3 ${
                          r.sender_role === 'dev' ? 'border-orange-200 bg-orange-50' : 'border-slate-100 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-semibold ${r.sender_role === 'dev' ? 'text-orange-600' : 'text-slate-800'}`}>
                              {r.sender_role === 'dev' ? 'My Boda Guy Team' : (r.name || 'Website visitor')}
                            </p>
                            {r.reward_reason && (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                                🪙 Correct answer
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">{fmtBoardTime(r.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{r.message}</p>
                        <button
                          type="button"
                          onClick={() => handleLike(r.id)}
                          disabled={r.likedByMe}
                          className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition disabled:cursor-default ${
                            r.likedByMe ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-100'
                          }`}
                        >
                          <ThumbsUp className="h-3 w-3" /> {r.likeCount || 0}
                        </button>
                      </div>
                    ))}
                    {m.replies.length === 0 && (
                      <p className="text-xs text-slate-500">No replies yet.</p>
                    )}

                    {!canReply && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={guestReplyForm.name}
                          onChange={(e) => setGuestReplyForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="Your name"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <input
                          value={guestReplyForm.email}
                          onChange={(e) => setGuestReplyForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="Your email"
                          type="email"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <button
                          type="button"
                          onClick={handleSaveGuestReplyIdentity}
                          disabled={!guestReplyForm.name.trim()}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 sm:col-span-2"
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
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <button
                          type="button"
                          onClick={() => handleSendReply(m.id)}
                          disabled={replyState === 'sending' || !replyDraft.trim()}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-yellow-500 text-white transition disabled:opacity-40"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {replyState === 'error' && <p className="text-xs text-rose-600">Reply failed — please try again.</p>}
                  </div>
                )}
              </article>
            );
          })}
          {threads.length === 0 && (
            <p className="text-sm text-slate-500">No public messages yet — be the first to ask something.</p>
          )}
        </div>

        {contributors.length > 0 && (
          <div className="mt-8 max-w-6xl mx-auto">
            <p className="text-xs uppercase tracking-[0.3em] text-orange-500">Community members</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {contributors.map((c) => (
                <button
                  key={c.authId || 'guests'}
                  type="button"
                  onClick={() => handleSelectContributor(c)}
                  disabled={c.isGuestGroup}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition disabled:cursor-default"
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
            className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-slate-900">{selectedContributor.name}</p>
              <button onClick={() => setSelectedContributor(null)} className="text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {selectedContributor.count} {selectedContributor.count === 1 ? 'message' : 'messages'} on the community board
            </p>
            {identity?.authId === selectedContributor.authId && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-600">Your ICAN balance</p>
                <p className="mt-1 text-xl font-bold text-amber-600">
                  {balanceLoading ? '…' : `${(contributorBalance ?? 0).toFixed(2)} ICAN`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t border-slate-200">
        <div className="text-center text-slate-600">
          <p>&copy; 2026 My Boda Guy. All rights reserved.</p>
          <p className="text-sm mt-2">Your Trusted Ride Partner in Uganda</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all">
      <div className="mb-4">{icon}</div>
      <h4 className="text-xl font-bold text-slate-800 mb-2">{title}</h4>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-lg text-center">
      <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4 text-white font-bold text-xl">
        {number}
      </div>
      <h4 className="text-xl font-bold text-slate-800 mb-2">{title}</h4>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}
