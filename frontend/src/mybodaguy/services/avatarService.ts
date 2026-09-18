import { supabase } from './supabaseClient';
import { compressImageFile } from '../utils/imageCompression';

const AVATAR_BUCKET = 'avatars';
const MAX_SIZE_MB = 2;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const avatarService = {
  // Uploads to the public `avatars` bucket under a per-user folder (so the
  // storage RLS "owner" policy can key off the path), then writes the
  // resulting public URL onto mbg_user_profiles.avatar_url.
  async uploadAvatar(userId: string, file: File): Promise<string> {
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, or WEBP image.');
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`Image must be under ${MAX_SIZE_MB}MB.`);
    }

    const compressed = await compressImageFile(file, 512, 0.85);
    const ext = compressed.name.split('.').pop() || 'jpg';
    const path = `${userId}/avatar-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, compressed, { upsert: true, cacheControl: '31536000' });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from('mbg_user_profiles')
      .upsert({ user_id: userId, avatar_url: publicUrl, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (updateError) throw updateError;

    return publicUrl;
  },

  async getAvatarUrl(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from('mbg_user_profiles')
      .select('avatar_url')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.avatar_url || null;
  }
};
