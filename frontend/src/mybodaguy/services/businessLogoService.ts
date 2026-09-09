import { supabase } from '../../services/supabaseClient';

const LOGO_BUCKET = 'business-logos';
const MAX_SIZE_MB = 2;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Mirrors avatarService.ts, but keyed by business_profile_id (storage RLS
// checks ican_business_admin on the folder) instead of auth.uid() — so a
// business must exist (mbg_register_business) before its logo can be
// uploaded, not the other way around.
export const businessLogoService = {
  async uploadLogo(businessProfileId: string, file: File): Promise<string> {
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, or WEBP image.');
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`Image must be under ${MAX_SIZE_MB}MB.`);
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${businessProfileId}/logo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from('business_profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', businessProfileId);
    if (updateError) throw updateError;

    return publicUrl;
  },
};
