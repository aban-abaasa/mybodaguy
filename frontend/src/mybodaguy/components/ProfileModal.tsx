import { useState, useEffect } from 'react';
import { X, Save, Upload, User } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { toast } from 'sonner';

interface ProfileModalProps {
  user: any;
  userRole: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface ProfileData {
  full_name: string;
  phone: string;
  national_id: string;
  address: string;
  city: string;
  date_of_birth: string;
  gender: string;
  avatar_url: string;
  // Committee member specific fields
  alternate_phone?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  bio?: string;
}

export default function ProfileModal({ user, userRole, isOpen, onClose, onSaved }: ProfileModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData>({
    full_name: '',
    phone: '',
    national_id: '',
    address: '',
    city: '',
    date_of_birth: '',
    gender: '',
    avatar_url: '',
    alternate_phone: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    bio: ''
  });

  useEffect(() => {
    if (isOpen && user) {
      loadProfile();
    }
  }, [isOpen, user]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      // Load basic user profile
      const { data: profile, error } = await supabase
        .from('mbg_user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading profile:', error);
        toast.error('Failed to load profile');
        return;
      }

      // For chairpersons, also load committee member details
      let committeeDetails = null;
      if (userRole === 'chairperson') {
        const { data: committee } = await supabase
          .from('mbg_committee_members')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (committee) {
          const { data: details } = await supabase
            .from('committee_member_details')
            .select('*')
            .eq('committee_member_id', committee.id)
            .maybeSingle();
          
          committeeDetails = details;
        }
      }

      if (profile || committeeDetails) {
        setProfileData({
          full_name: profile?.full_name || '',
          phone: profile?.phone || '',
          national_id: profile?.national_id || committeeDetails?.national_id || '',
          address: profile?.address || committeeDetails?.address || '',
          city: profile?.city || '',
          date_of_birth: profile?.date_of_birth || '',
          gender: profile?.gender || '',
          avatar_url: profile?.avatar_url || committeeDetails?.profile_photo_url || '',
          alternate_phone: committeeDetails?.alternate_phone || '',
          emergency_contact_name: committeeDetails?.emergency_contact_name || '',
          emergency_contact_phone: committeeDetails?.emergency_contact_phone || '',
          bio: committeeDetails?.bio || ''
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Save to mbg_user_profiles
      const { error: profileError } = await supabase
        .from('mbg_user_profiles')
        .upsert({
          user_id: user.id,
          full_name: profileData.full_name,
          phone: profileData.phone,
          national_id: profileData.national_id,
          address: profileData.address,
          city: profileData.city,
          date_of_birth: profileData.date_of_birth,
          gender: profileData.gender,
          avatar_url: profileData.avatar_url,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (profileError) {
        throw profileError;
      }

      // For chairpersons, also save committee member details
      if (userRole === 'chairperson') {
        const { data: committee } = await supabase
          .from('mbg_committee_members')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (committee) {
          const { error: detailsError } = await supabase
            .from('committee_member_details')
            .upsert({
              committee_member_id: committee.id,
              full_name: profileData.full_name,
              national_id: profileData.national_id,
              address: profileData.address,
              alternate_phone: profileData.alternate_phone,
              emergency_contact_name: profileData.emergency_contact_name,
              emergency_contact_phone: profileData.emergency_contact_phone,
              profile_photo_url: profileData.avatar_url,
              bio: profileData.bio,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'committee_member_id'
            });

          if (detailsError) {
            console.error('Error saving committee details:', detailsError);
            // Don't throw - profile was saved successfully
          }
        }
      }

      toast.success('Profile updated successfully!');
      onSaved?.();
      onClose();
    } catch (error: any) {
      console.error('Error saving profile:', error);
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center">
              <User className="text-white" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Edit Profile</h3>
              <p className="text-sm text-slate-600 capitalize">{userRole} Account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
            <p className="mt-4 text-slate-600">Loading profile...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-6 space-y-6">
            {/* Personal Information */}
            <div>
              <h4 className="text-lg font-semibold text-slate-800 mb-4">Personal Information</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="Your full name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="+256..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={profileData.date_of_birth}
                    onChange={(e) => setProfileData({ ...profileData, date_of_birth: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    value={profileData.gender}
                    onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Identification */}
            <div>
              <h4 className="text-lg font-semibold text-slate-800 mb-4">Identification</h4>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    National ID
                  </label>
                  <input
                    type="text"
                    value={profileData.national_id}
                    onChange={(e) => setProfileData({ ...profileData, national_id: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="National ID number"
                  />
                </div>
              </div>
            </div>

            {/* Location */}
            <div>
              <h4 className="text-lg font-semibold text-slate-800 mb-4">Location</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Address
                  </label>
                  <textarea
                    value={profileData.address}
                    onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    rows={3}
                    placeholder="Your physical address"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={profileData.city}
                    onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="City/Town"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value="Uganda"
                    disabled
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
              </div>
            </div>

            {/* Committee Member Details (Chairperson Only) */}
            {userRole === 'chairperson' && (
              <div>
                <h4 className="text-lg font-semibold text-slate-800 mb-4">Committee Member Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Alternate Phone
                    </label>
                    <input
                      type="tel"
                      value={profileData.alternate_phone}
                      onChange={(e) => setProfileData({ ...profileData, alternate_phone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="+256..."
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Secondary contact number for committee members
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Emergency Contact Name
                    </label>
                    <input
                      type="text"
                      value={profileData.emergency_contact_name}
                      onChange={(e) => setProfileData({ ...profileData, emergency_contact_name: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="Full name"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Emergency Contact Phone
                    </label>
                    <input
                      type="tel"
                      value={profileData.emergency_contact_phone}
                      onChange={(e) => setProfileData({ ...profileData, emergency_contact_phone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="+256..."
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Bio / Description
                    </label>
                    <textarea
                      value={profileData.bio}
                      onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      rows={4}
                      placeholder="Tell your committee members about yourself and your commitment to the community..."
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Share your vision and goals to build faith in the benefits of the platform
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Email (Read-only) */}
            <div>
              <h4 className="text-lg font-semibold text-slate-800 mb-4">Account Information</h4>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-600"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Email cannot be changed. Contact support if you need to update your email.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
