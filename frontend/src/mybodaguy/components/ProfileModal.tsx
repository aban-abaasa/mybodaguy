import { useState, useEffect } from 'react';
import { X, Save, Upload, User, UserPlus, Trash2, Search } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { toast } from 'sonner';

interface ProfileModalProps {
  user: any;
  userRole: string;
  userRoles?: string[];
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

export default function ProfileModal({ user, userRole, userRoles = [], isOpen, onClose, onSaved }: ProfileModalProps) {
  const roles = userRoles.length > 0 ? userRoles : userRolesFor(userRole);
  const isChairperson = roles.includes('chairperson');
  const isOperator = roles.includes('rider');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [committeeMemberId, setCommitteeMemberId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [teamUserId, setTeamUserId] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [teamRole, setTeamRole] = useState('vice_chairperson');
  const [customTeamRole, setCustomTeamRole] = useState('');
  const [teamRate, setTeamRate] = useState('0');
  const [addingTeamMember, setAddingTeamMember] = useState(false);
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
  }, [isOpen, user, isChairperson, isOperator]);

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
      let committee = null;
      if (isChairperson) {
        const { data: committeeRow } = await supabase
          .from('mbg_committee_members')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('appointed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        committee = committeeRow;
        setCommitteeMemberId(committee?.id || null);

        if (committee) {
          const { data: details } = await supabase
            .from('committee_member_details')
            .select('*')
            .eq('committee_member_id', committee.id)
            .maybeSingle();
          
          committeeDetails = details;

          const [{ data: members }, { data: authUsers }] = await Promise.all([
            supabase
              .from('mbg_committee_profile_members')
              .select('id, user_id, committee_role, commission_rate, is_active, created_at')
              .eq('committee_member_id', committee.id)
              .eq('is_active', true)
              .order('created_at', { ascending: true }),
            supabase.rpc('get_all_auth_users')
          ]);
          const authById = new Map((authUsers || []).map((account: any) => [account.id, account]));
          setTeamMembers((members || []).map((member: any) => ({
            ...member,
            email: authById.get(member.user_id)?.email || member.user_id,
            full_name: authById.get(member.user_id)?.full_name || authById.get(member.user_id)?.email?.split('@')[0] || 'Authenticated user'
          })));
          setTeamUsers((authUsers || []).filter((account: any) => account.id !== user.id));
        }
      } else {
        setCommitteeMemberId(null);
        setTeamMembers([]);
        setTeamUsers([]);
      }

      if (isOperator) {
        const { data: riderRows } = await supabase
          .from('mbg_riders')
          .select('id, vehicle_type, operator_type, plate_number, license_number, license_expiry, status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });
        setVehicles(riderRows || []);
      } else {
        setVehicles([]);
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

  const addTeamMember = async () => {
    const selectedRole = teamRole === 'other' ? customTeamRole.trim() : teamRole.trim();
    if (!committeeMemberId || !teamUserId || !selectedRole) return;
    const rate = Number(teamRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Rate share must be between 0 and 100%.');
      return;
    }
    setAddingTeamMember(true);
    const { data, error } = await supabase
      .from('mbg_committee_profile_members')
      .upsert({
        committee_member_id: committeeMemberId,
        user_id: teamUserId,
        committee_role: selectedRole,
        commission_rate: rate,
        added_by: user.id,
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'committee_member_id,user_id' })
        .select('id, user_id, committee_role, commission_rate, is_active, created_at')
      .single();
    if (error) {
      toast.error(error.message.includes('maximum of 10') ? 'You can add a maximum of 10 active committee members.' : error.message);
    } else if (data) {
      const account = teamUsers.find(candidate => candidate.id === teamUserId);
      setTeamMembers(previous => [...previous.filter(member => member.user_id !== data.user_id), {
        ...data,
        email: account?.email || teamUserId,
        full_name: account?.full_name || account?.email?.split('@')[0] || 'Authenticated user'
      }]);
      setTeamUserId('');
      setTeamSearch('');
      setTeamRate('0');
      toast.success('Committee member added');
    }
    setAddingTeamMember(false);
  };

  const removeTeamMember = async (memberId: string) => {
    const { error } = await supabase
      .from('mbg_committee_profile_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', memberId);
    if (error) toast.error(error.message);
    else {
      setTeamMembers(previous => previous.filter(member => member.id !== memberId));
      toast.success('Committee member removed');
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
      if (isChairperson) {
        if (!profileData.full_name.trim() || !profileData.phone.trim() || !profileData.national_id.trim()
          || !profileData.emergency_contact_name?.trim() || !profileData.emergency_contact_phone?.trim()) {
          throw new Error('Complete your name, phone, national ID, and emergency contact before saving commission eligibility.');
        }
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
            throw detailsError;
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
              <p className="text-sm text-slate-600 capitalize">{roles.map(role => role.replace(/_/g, ' ')).join(' · ')} account</p>
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
                    Phone Number {isChairperson ? '*' : ''}
                  </label>
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="+256..."
                    required={isChairperson}
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
                    National ID {isChairperson ? '*' : ''}
                  </label>
                  <input
                    type="text"
                    value={profileData.national_id}
                    onChange={(e) => setProfileData({ ...profileData, national_id: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="National ID number"
                    required={isChairperson}
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
            {isChairperson && (
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
                      Emergency Contact Name *
                    </label>
                    <input
                      type="text"
                      value={profileData.emergency_contact_name}
                      onChange={(e) => setProfileData({ ...profileData, emergency_contact_name: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="Full name"
                      required
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Emergency Contact Phone *
                    </label>
                    <input
                      type="tel"
                      value={profileData.emergency_contact_phone}
                      onChange={(e) => setProfileData({ ...profileData, emergency_contact_phone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="+256..."
                      required
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

            {isChairperson && committeeMemberId && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-800">Committee Working Members</h4>
                    <p className="text-sm text-slate-600">Add authenticated users who work with you, such as a vice chairperson, secretary, defence lead, treasurer, or another approved role.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">{teamMembers.length} active</span>
                </div>
                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1.2fr_1fr_0.55fr_auto]">
                  <div>
                    <div className="relative">
                      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input value={teamSearch} onChange={event => setTeamSearch(event.target.value)} disabled={teamMembers.length >= 10 || addingTeamMember} placeholder="Search name or email" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800" />
                    </div>
                    <select value={teamUserId} onChange={event => setTeamUserId(event.target.value)} disabled={teamMembers.length >= 10 || addingTeamMember} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                    <option value="">Select authenticated user</option>
                    {teamUsers.filter(account => !teamMembers.some(member => member.user_id === account.id) && `${account.full_name || ''} ${account.email || ''}`.toLowerCase().includes(teamSearch.trim().toLowerCase())).map(account => <option key={account.id} value={account.id}>{account.full_name || account.email} — {account.email}</option>)}
                    </select>
                  </div>
                  <div>
                    <select value={teamRole} onChange={event => setTeamRole(event.target.value)} disabled={teamMembers.length >= 10 || addingTeamMember} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                      <option value="vice_chairperson">Vice Chairperson</option>
                      <option value="secretary">Secretary</option>
                      <option value="vice_secretary">Vice Secretary</option>
                      <option value="defence">Defence</option>
                      <option value="treasurer">Treasurer</option>
                      <option value="mobilizer">Mobilizer</option>
                      <option value="communications">Communications</option>
                      <option value="other">Other</option>
                    </select>
                    {teamRole === 'other' && <input value={customTeamRole} onChange={event => setCustomTeamRole(event.target.value)} placeholder="Committee role" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />}
                  </div>
                  <input type="number" min="0" max="100" step="0.01" value={teamRate} onChange={event => setTeamRate(event.target.value)} disabled={addingTeamMember} placeholder="Rate %" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" aria-label="Commission rate share" />
                  <button type="button" onClick={addTeamMember} disabled={addingTeamMember || !teamUserId || (teamRole === 'other' ? !customTeamRole.trim() : !teamRole)} className="flex items-center justify-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"><UserPlus size={16} /> Add</button>
                </div>
                <div className="mt-3 space-y-2">
                  {teamMembers.length === 0 ? <p className="text-sm text-slate-500">No working members added yet.</p> : teamMembers.map(member => <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"><div><p className="text-sm font-semibold text-slate-800">{member.full_name}</p><p className="text-xs text-slate-500">{member.email} · <span className="capitalize">{member.committee_role.replace(/_/g, ' ')}</span> · {Number(member.commission_rate || 0).toFixed(2)}% share</p></div><button type="button" onClick={() => removeTeamMember(member.id)} className="rounded p-2 text-red-500 hover:bg-red-50" title="Remove committee member"><Trash2 size={16} /></button></div>)}
                </div>
              </div>
            )}

            {isOperator && (
              <div>
                <h4 className="text-lg font-semibold text-slate-800 mb-4">Rider / Driver Access</h4>
                <p className="text-sm text-slate-600 mb-3">Your approved vehicles and operator credentials. Availability and ride controls remain in the driver dashboard.</p>
                {vehicles.length === 0 ? <p className="text-sm text-slate-500">No approved vehicle profile found.</p> : <div className="space-y-2">{vehicles.map(vehicle => (
                  <div key={vehicle.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2 font-semibold text-slate-800"><span className="capitalize">{vehicle.vehicle_type} {vehicle.operator_type ? `· ${vehicle.operator_type}` : ''}</span><span className="capitalize text-emerald-600">{vehicle.status || 'active'}</span></div>
                    <div className="mt-1 grid gap-1 text-slate-600 sm:grid-cols-3"><span>Plate: {vehicle.plate_number || 'Not set'}</span><span>License: {vehicle.license_number || 'Not set'}</span><span>Expiry: {vehicle.license_expiry || 'Not set'}</span></div>
                  </div>
                ))}</div>}
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

function userRolesFor(userRole: string): string[] {
  return userRole ? [userRole] : ['customer'];
}
