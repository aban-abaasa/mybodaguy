import { supabase } from './supabaseClient';
import { authService } from './authService';
import { userService } from './userService';

const GUEST_KEY = 'chat_guest_identity_v1';
const CONV_PREFIX = 'chat_conversation_id_v1_';

export interface GuestChatIdentity {
  name: string;
  email: string;
}

export interface ChatIdentity {
  userId: string;
  authId: string;
  name: string;
  email: string;
  role: string;
}

export const getGuestIdentity = (): GuestChatIdentity | null => {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
  } catch {
    return null;
  }
};

export const setGuestIdentity = (identity: GuestChatIdentity) => {
  localStorage.setItem(GUEST_KEY, JSON.stringify(identity));
};

export const getStoredConversationId = (scopeKey: string) =>
  localStorage.getItem(CONV_PREFIX + scopeKey);

export const storeConversationId = (scopeKey: string, conversationId: string) => {
  localStorage.setItem(CONV_PREFIX + scopeKey, conversationId);
};

export const createConversation = async ({
  name, email, userId, role, portal, subject,
}: {
  name?: string; email?: string; userId?: string | null; role?: string; portal?: string; subject?: string;
}) => {
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({
      guest_name: name || null,
      guest_email: email || null,
      user_id: userId || null,
      role: role || 'guest',
      portal: portal || 'landing',
      origin_app: 'mybodaguy',
      subject: subject || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const fetchConversation = async (conversationId: string) => {
  const { data } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  return data;
};

export const fetchMessages = async (conversationId: string) => {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return data || [];
};

export const sendMessage = async (conversationId: string, { senderRole, senderName, body }: { senderRole: string; senderName?: string; body: string; }) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      sender_role: senderRole,
      sender_name: senderName || null,
      body,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const markConversationRead = async (conversationId: string, side: 'dev' | 'user') => {
  const field = side === 'dev' ? 'unread_by_dev' : 'unread_by_user';
  await supabase.from('chat_conversations').update({ [field]: false }).eq('id', conversationId);
};

// mybodaguy's Developer Dashboard inbox only shows its own app's support
// threads — origin_app scoping keeps it from wading through every other
// app's conversations too (each app has its own inbox).
export const listConversations = async ({ kind = 'support' }: { kind?: string } = {}) => {
  let query = supabase
    .from('chat_conversations')
    .select('*')
    .eq('origin_app', 'mybodaguy')
    .order('last_message_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  const { data } = await query;
  return data || [];
};

export const subscribeToMessages = (conversationId: string, onInsert: (msg: any) => void) => {
  const channel = supabase
    .channel(`chat_messages_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload: any) => onInsert(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const subscribeToConversation = (conversationId: string, onUpdate: (conv: any) => void) => {
  const channel = supabase
    .channel(`chat_conversation_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_conversations', filter: `id=eq.${conversationId}` },
      (payload: any) => onUpdate(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const subscribeToAllConversations = (onChange: (payload: any) => void) => {
  const channel = supabase
    .channel('chat_conversations_all_mbg')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: 'origin_app=eq.mybodaguy' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// mybodaguy has no hidden dev-token panel — its developer surface is a real
// authenticated account (mbg_users.role_type = 'developer'), so this widget
// is only ever hidden for that real role, checked by the caller.

// Resolve who's chatting: real signed-in user (via mbg_user_profiles) or null for guest.
export const resolveChatIdentity = async (): Promise<ChatIdentity | null> => {
  try {
    const user = await authService.getCurrentUser();
    if (!user) return null;

    let name = (user as any).user_metadata?.full_name || user.email || 'User';
    try {
      const profile = await userService.getUserProfile(user.id);
      if (profile?.full_name) name = profile.full_name;
    } catch {
      // profile lookup is best-effort
    }

    let role = 'user';
    try {
      role = (await userService.getUserRole(user.id)) || 'user';
    } catch {
      // role lookup is best-effort
    }

    return {
      userId: user.id,
      authId: user.id,
      name,
      email: user.email || '',
      role,
    };
  } catch {
    return null;
  }
};
