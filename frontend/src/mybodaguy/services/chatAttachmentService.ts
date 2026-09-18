import { supabase } from './supabaseClient';

const BUCKET = 'chat-attachments';
const MAX_SIZE_MB = 8;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface ChatAttachment {
  url: string;
  type: 'image';
  name: string;
}

// Mirrors avatarService.ts/businessLogoService.ts — a public Storage bucket,
// uploaded to straight from the browser, no backend involved. Used by the
// support ChatWidget (chat_messages) and the Community board/live chat
// (landing_messages) — both tables, and this bucket, are shared across
// ICAN, digital-city-era, mybodaguy and FARM-AGENT (see
// ADD_CHAT_IMAGE_ATTACHMENTS.sql), so the plain public URL this returns
// renders with a bare <img src> in every app, no per-app resolver needed.
export const uploadChatImage = async (file: File): Promise<ChatAttachment> => {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Please choose a JPG, PNG, WEBP, or GIF image.');
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image must be under ${MAX_SIZE_MB}MB.`);
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const path = `mybodaguy/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, type: 'image', name: file.name };
};
