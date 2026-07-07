import { supabase } from './supabaseClient';

// Tags every message with the app it was posted from — this table is a
// single shared board across ICAN, digital-city-era, mybodaguy, FARM-AGENT.
export const ORIGIN_APP = 'mybodaguy';

export interface LandingMessage {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  message: string;
  user_id: string | null;
  origin_app: string;
  is_public: boolean;
  parent_id: string | null;
  sender_role: 'guest' | 'user' | 'dev';
  created_at: string;
  rewarded_at?: string | null;
  reward_reason?: 'correct_answer' | 'popular' | null;
  likeCount?: number;
  likedByMe?: boolean;
}

export interface LandingThread extends LandingMessage {
  replies: LandingMessage[];
}

interface Reaction {
  message_id: string;
  user_id: string | null;
  guest_key: string | null;
}

// landing_messages.user_id references auth.users(id) directly (auth.uid()),
// the one identity space shared by all 4 apps — pass `authId` here, which in
// mybodaguy happens to equal mbg_users.id (mbg_users.id is PK REFERENCES
// auth.users(id)), but always source it from supabase.auth.getSession()/
// getUser() rather than a table lookup, to guarantee correctness.

export const createLandingMessage = async ({
  name,
  email,
  company,
  message,
  authId,
  isPublic,
}: {
  name?: string;
  email?: string;
  company?: string;
  message: string;
  authId?: string | null;
  isPublic?: boolean;
}): Promise<LandingMessage> => {
  const { data, error } = await supabase
    .from('landing_messages')
    .insert({
      name: name || null,
      email: email || null,
      company: company || null,
      message,
      user_id: authId || null,
      origin_app: ORIGIN_APP,
      // Guests can never post privately — only a resolved logged-in poster can,
      // and the DB additionally requires an active ICAN wallet for is_public=false.
      is_public: authId ? !!isPublic : true,
      sender_role: authId ? 'user' : 'guest',
    })
    .select()
    .single();
  if (error) throw error;
  return data as LandingMessage;
};

// Replies are single-level (a reply can't itself be replied to) and always
// public — you can only reply to a public top-level message in the first place.
export const replyToLandingMessage = async ({
  parentId,
  name,
  email,
  authId,
  message,
}: {
  parentId: string;
  name?: string;
  email?: string;
  authId?: string | null;
  message: string;
}): Promise<LandingMessage> => {
  const { data, error } = await supabase
    .from('landing_messages')
    .insert({
      parent_id: parentId,
      name: name || null,
      email: email || null,
      message,
      user_id: authId || null,
      origin_app: ORIGIN_APP,
      is_public: true,
      sender_role: authId ? 'user' : 'guest',
    })
    .select()
    .single();
  if (error) throw error;
  return data as LandingMessage;
};

export const listMyLandingMessages = async (authId?: string | null): Promise<LandingMessage[]> => {
  if (!authId) return [];
  const { data, error } = await supabase
    .from('landing_messages')
    .select('*')
    .eq('user_id', authId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as LandingMessage[];
};

// Whether this poster can go private — private posting requires an active
// ICAN wallet (same table/shape as icanWalletService.ts's getWallet()), a
// stronger identity bar than just being logged in.
export const hasIcanWallet = async (authId?: string | null): Promise<boolean> => {
  if (!authId) return false;
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('user_id')
    .eq('user_id', authId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return !!data;
};

// Balances are only ever safe to show to their owner — ican_user_wallets
// RLS currently lets any authenticated user in any app read any wallet
// (pre-existing, shared by every wallet feature, not something this file
// changes), so the privacy guarantee here is enforced by convention at the
// call site: only ever call this with the CURRENT viewer's own authId,
// never for another poster's id.
export const getMyIcanBalance = async (authId?: string | null): Promise<number | null> => {
  if (!authId) return null;
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('ican_balance')
    .eq('user_id', authId)
    .maybeSingle();
  if (error) throw error;
  return data?.ican_balance ?? 0;
};

// A stable per-browser identifier for guest likes — separate from the
// name/email guest identity used for posting/replying, since liking needs
// no name at all, just something to dedupe against (matches the DB's
// one-like-per-guest_key-per-message unique constraint).
const GUEST_LIKE_KEY = 'landing_guest_like_key';
export const getOrCreateGuestLikeKey = (): string => {
  let key = localStorage.getItem(GUEST_LIKE_KEY);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(GUEST_LIKE_KEY, key);
  }
  return key;
};

// Guests like with guestKey, logged-in visitors like with authId — never
// both. 23505 (unique violation) means "already liked this", a harmless
// no-op rather than an error the caller needs to handle.
export const likeMessage = async ({
  messageId,
  authId,
  guestKey,
}: {
  messageId: string;
  authId?: string | null;
  guestKey?: string | null;
}): Promise<void> => {
  const { error } = await supabase.from('landing_message_reactions').insert({
    message_id: messageId,
    user_id: authId || null,
    guest_key: authId ? null : (guestKey || null),
  });
  if (error && (error as any).code !== '23505') throw error;
};

// Groups the flat public rows into top-level messages with a nested `replies`
// array. Also attaches `likeCount`/`likedByMe` per message so cards can
// render the like button state.
export const fetchPublicThreads = async (
  limit = 50,
  viewer: { authId?: string | null; guestKey?: string | null } = {}
): Promise<LandingThread[]> => {
  const { authId, guestKey } = viewer;

  // Fetch a generous window of rows (top-level + replies mixed together),
  // then group into threads and cap to `limit` threads below.
  const { data, error } = await supabase
    .from('landing_messages')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows = (data || []) as LandingMessage[];
  const ids = rows.map((r) => r.id);

  let reactionsByMessage: Record<string, Reaction[]> = {};
  if (ids.length) {
    const { data: reactions, error: reactionsError } = await supabase
      .from('landing_message_reactions')
      .select('message_id, user_id, guest_key')
      .in('message_id', ids);
    if (reactionsError) throw reactionsError;
    reactionsByMessage = (reactions || []).reduce((acc: Record<string, Reaction[]>, r: Reaction) => {
      (acc[r.message_id] ||= []).push(r);
      return acc;
    }, {});
  }

  const withLikes = (m: LandingMessage): LandingMessage => {
    const rs = reactionsByMessage[m.id] || [];
    return {
      ...m,
      likeCount: rs.length,
      likedByMe: rs.some((r) => (authId ? r.user_id === authId : !!guestKey && r.guest_key === guestKey)),
    };
  };

  const topLevel = rows.filter((r) => !r.parent_id);
  const repliesByParent: Record<string, LandingMessage[]> = {};
  rows.forEach((r) => {
    if (r.parent_id) (repliesByParent[r.parent_id] ||= []).push(r);
  });

  return topLevel
    .map((m) => ({ ...withLikes(m), replies: (repliesByParent[m.id] || []).map(withLikes) }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
};

export const subscribeToPublicLandingMessages = (onInsert: (row: LandingMessage) => void) => {
  // Create a unique channel name to avoid conflicts when remounting
  const channelName = `landing_messages_public_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'landing_messages', filter: 'is_public=eq.true' },
      (payload: any) => onInsert(payload.new)
    )
    .subscribe();
  
  return () => {
    supabase.removeChannel(channel);
  };
};

// Developer Dashboard moderation — mybodaguy has no dev-token panel like the
// other 3 apps; its developer surface is DeveloperDashboard.tsx, shown only
// to a real authenticated account where mbg_users.role_type = 'developer'.
// landing_messages_is_dev() checks auth.uid() against that as a second
// authorization path, so these calls omit dev_token entirely.
export const devListAllLandingMessages = async (): Promise<LandingMessage[]> => {
  const { data, error } = await supabase.rpc('dev_get_landing_messages', {});
  if (error) throw error;
  return (data || []) as LandingMessage[];
};

export const devDeleteLandingMessage = async (messageId: string): Promise<void> => {
  const { error } = await supabase.rpc('dev_delete_landing_message', { message_id: messageId });
  if (error) throw error;
};

export const devReplyToLandingMessage = async (
  parentId: string,
  body: string,
  teamName = 'mybodaguy Team'
): Promise<LandingMessage> => {
  const { data, error } = await supabase.rpc('dev_reply_landing_message', {
    parent_id: parentId,
    body,
    team_name: teamName,
  });
  if (error) throw error;
  return data as LandingMessage;
};

// Fixed 1 ICAN reward to the replier — DB rejects guest replies and
// already-rewarded ones (see dev_mark_correct_answer in
// ADD_LANDING_MESSAGE_REWARDS.sql). No dev_token — same real-role
// authorization as the other dev_* calls in this file.
export const devMarkCorrectAnswer = async (replyId: string): Promise<LandingMessage> => {
  const { data, error } = await supabase.rpc('dev_mark_correct_answer', { reply_id: replyId });
  if (error) throw error;
  return data as LandingMessage;
};

// General manual grant — independent of the correct-answer/popular-message
// auto-rewards, for a developer to award any amount to any poster. No
// dev_token — same real-role authorization as the other dev_* calls here.
export const devGrantLandingBonus = async (
  targetUserId: string,
  amount: number,
  note = 'Manual grant from Public Board'
): Promise<any> => {
  const { data, error } = await supabase.rpc('dev_grant_landing_bonus', {
    target_user_id: targetUserId,
    amount,
    note,
    source_app: ORIGIN_APP,
  });
  if (error) throw error;
  return data;
};
