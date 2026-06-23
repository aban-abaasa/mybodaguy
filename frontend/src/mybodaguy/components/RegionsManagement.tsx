import { useState, useEffect } from 'react';
import { 
  MapPin, Plus, Users, ChevronRight, ChevronDown, 
  Edit, Trash2, UserPlus, X, Check 
} from 'lucide-react';
import { toast } from 'sonner';
import { regionsService, District, Division, Subcounty, Parish, Stage } from '../services/regionsService';
import { chairpersonService } from '../services/chairpersonService';
import { userService } from '../services/userService';
import { supabase } from '../services/supabaseClient';

export default function RegionsManagement() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDistrict, setExpandedDistrict] = useState<string | null>(null);
  const [showAddDistrictModal, setShowAddDistrictModal] = useState(false);
  const [showAddRegionModal, setShowAddRegionModal] = useState(false);
  const [showAssignChairpersonModal, setShowAssignChairpersonModal] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{
    type: 'district' | 'division' | 'subcounty' | 'parish' | 'stage';
    id: string;
    name: string;
    parentId?: string;
  } | null>(null);

  useEffect(() => {
    loadDistricts();
  }, []);

  const loadDistricts = async () => {
    setLoading(true);
    const data = await regionsService.getAllDistricts();
    setDistricts(data);
    setLoading(false);
  };

  const handleAddDistrict = () => {
    setShowAddDistrictModal(true);
  };

  const handleAssignChairperson = (type: any, id: string, name: string) => {
    setSelectedRegion({ type, id, name });
    setShowAssignChairpersonModal(true);
  };

  const handleAddSubRegion = (type: any, parentId: string, parentName: string) => {
    setSelectedRegion({ type, id: '', name: parentName, parentId });
    setShowAddRegionModal(true);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading regions...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Geographic Regions & Chairpersons</h2>
          <p className="text-sm text-slate-600 mt-1">
            Manage regions hierarchy and assign chairpersons at each level
          </p>
        </div>
        <button
          onClick={handleAddDistrict}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md"
        >
          <Plus size={18} />
          Add District
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h4 className="font-semibold text-blue-800 mb-2">📍 Hierarchical Assignment Rules</h4>
        <div className="text-sm text-blue-700 space-y-1">
          <p><strong>District → Division → Subcounty → Parish → Stage</strong></p>
          <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
            <li><strong>Developer (You):</strong> Can only assign <strong>District Chairpersons</strong></li>
            <li><strong>District Chairperson:</strong> Assigns Division Chairpersons in their district</li>
            <li><strong>Division Chairperson:</strong> Assigns Subcounty Chairpersons in their division</li>
            <li><strong>Subcounty Chairperson:</strong> Assigns Parish Chairpersons in their subcounty</li>
            <li><strong>Parish Chairperson:</strong> Assigns Stage Chairpersons in their parish</li>
            <li><strong>Stage Chairperson:</strong> Manages riders at their boda boda stage</li>
          </ul>
          <p className="mt-2 text-xs italic">💡 Each level earns commissions from riders in their jurisdiction!</p>
        </div>
      </div>

      {/* Districts List */}
      {districts.length === 0 ? (
        <div className="bg-slate-50 rounded-lg p-12 text-center">
          <MapPin className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-700 mb-2">No Districts Yet</h3>
          <p className="text-slate-600 mb-6">Start by creating your first district</p>
          <button
            onClick={handleAddDistrict}
            className="px-6 py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md"
          >
            Create First District
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {districts.map((district) => (
            <DistrictCard
              key={district.id}
              district={district}
              expanded={expandedDistrict === district.id}
              onToggle={() => setExpandedDistrict(expandedDistrict === district.id ? null : district.id)}
              onAssignChairperson={() => handleAssignChairperson('district', district.id, district.name)}
              onAddSubRegion={handleAddSubRegion}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddDistrictModal && (
        <AddDistrictModal
          onClose={() => setShowAddDistrictModal(false)}
          onSuccess={() => {
            setShowAddDistrictModal(false);
            loadDistricts();
          }}
        />
      )}

      {showAddRegionModal && selectedRegion && (
        <AddRegionModal
          regionType={selectedRegion.type}
          parentId={selectedRegion.parentId!}
          parentName={selectedRegion.name}
          onClose={() => {
            setShowAddRegionModal(false);
            setSelectedRegion(null);
          }}
          onSuccess={() => {
            setShowAddRegionModal(false);
            setSelectedRegion(null);
            loadDistricts();
            toast.success('Region added successfully!');
          }}
        />
      )}

      {showAssignChairpersonModal && selectedRegion && (
        <AssignChairpersonModal
          regionType={selectedRegion.type}
          regionId={selectedRegion.id}
          regionName={selectedRegion.name}
          onClose={() => {
            setShowAssignChairpersonModal(false);
            setSelectedRegion(null);
          }}
          onSuccess={() => {
            setShowAssignChairpersonModal(false);
            setSelectedRegion(null);
            toast.success('Chairperson assigned successfully!');
            loadDistricts();
          }}
        />
      )}
    </div>
  );
}

// District Card Component
function DistrictCard({ 
  district, 
  expanded, 
  onToggle, 
  onAssignChairperson,
  onAddSubRegion 
}: { 
  district: District; 
  expanded: boolean; 
  onToggle: () => void;
  onAssignChairperson: () => void;
  onAddSubRegion: (type: string, parentId: string, parentName: string) => void;
}) {
  const [chairperson, setChairperson] = useState<any>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [expandedDivision, setExpandedDivision] = useState<string | null>(null);

  useEffect(() => {
    loadChairperson();
    if (expanded) {
      loadDivisions();
    }
  }, [district.id, expanded]);

  const loadChairperson = async () => {
    const data = await regionsService.getRegionChairperson('district', district.id);
    setChairperson(data);
  };

  const loadDivisions = async () => {
    setLoadingDivisions(true);
    const data = await regionsService.getDivisionsByDistrict(district.id);
    setDivisions(data);
    setLoadingDivisions(false);
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={onToggle}
              className="p-1 hover:bg-slate-200 rounded transition-colors"
            >
              {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </button>
            <MapPin className="text-orange-500" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-slate-800">{district.name}</h3>
              {district.description && (
                <p className="text-sm text-slate-600">{district.description}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {chairperson ? (
              <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-lg">
                <Users size={16} className="text-green-600" />
                <span className="text-sm font-medium text-green-700">
                  {chairperson.mbg_user_profiles?.[0]?.full_name || chairperson.mbg_users?.[0]?.email}
                </span>
              </div>
            ) : (
              <button
                onClick={onAssignChairperson}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium"
              >
                <UserPlus size={16} />
                Assign Chairperson
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-slate-700">Divisions</h4>
            <button
              onClick={() => onAddSubRegion('division', district.id, district.name)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors font-medium"
            >
              <Plus size={14} />
              Add Division
            </button>
          </div>
          
          {loadingDivisions ? (
            <p className="text-sm text-slate-600">Loading divisions...</p>
          ) : divisions.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No divisions yet. Click "Add Division" to create one.</p>
          ) : (
            <div className="space-y-2">
              {divisions.map((division) => (
                <DivisionCard
                  key={division.id}
                  division={division}
                  expanded={expandedDivision === division.id}
                  onToggle={() => setExpandedDivision(expandedDivision === division.id ? null : division.id)}
                  onAssignChairperson={() => onAssignChairperson()}
                  onAddSubRegion={onAddSubRegion}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Add District Modal
function AddDistrictModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  
  // User selection for chairperson
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [commissionRate, setCommissionRate] = useState('5.00');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      // Fetch from mbg_users table (synced from auth.users)
      const allUsers = await userService.getAllUsers();
      
      // Filter out developers
      const availableUsers = allUsers.filter((u: any) => u.role_type !== 'developer');
      setUsers(availableUsers);
      
      // If no users found, show helpful message
      if (availableUsers.length === 0) {
        console.log('No users available. Run SYNC_EXISTING_USERS.sql to import auth.users');
      }
    } catch (error) {
      console.error('Error loading users:', error);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    const searchLower = searchQuery.toLowerCase();
    const email = user.email?.toLowerCase() || '';
    const fullName = (
      user.user_metadata?.full_name || 
      user.user_metadata?.name || 
      user.mbg_user_profiles?.[0]?.full_name ||
      user.email?.split('@')[0] ||
      'User'
    ).toLowerCase();
    return email.includes(searchLower) || fullName.includes(searchLower);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('District name is required');
      return;
    }

    setSaving(true);
    
    // First, create the district
    const result = await regionsService.createDistrict({
      name: name.trim(),
      code: code.trim() || undefined,
      description: description.trim() || undefined
    });

    if (!result.success) {
      toast.error(result.error || 'Failed to create district');
      setSaving(false);
      return;
    }

    // If a user is selected, assign them as District Chairperson
    if (selectedUserId && result.data) {
      const selectedUser = users.find(u => u.id === selectedUserId);
      if (selectedUser) {
        const rate = parseFloat(commissionRate);
        const assignResult = await chairpersonService.assignChairperson({
          targetUserEmail: selectedUser.email,
          targetRole: 'district_chairperson',
          targetRegionType: 'district',
          targetRegionId: result.data.id,
          commissionRate: rate,
          notes: 'Assigned during district creation'
        });

        if (!assignResult.success) {
          toast.warning('District created but chairperson assignment failed: ' + assignResult.error);
        }
      }
    }

    setSaving(false);
    toast.success('District created successfully!');
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Add New District</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                District Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="e.g., Kampala"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                District Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="e.g., KLA"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                rows={3}
                placeholder="Optional description..."
              />
            </div>

            {/* Chairperson Selector */}
            <div className="border-t border-slate-200 pt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Assign District Chairperson (Optional)
              </label>
              
              {loadingUsers ? (
                <div className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-600 text-sm">
                  Loading users...
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent mb-2"
                  />
                  
                  <div className="border border-slate-300 rounded-lg max-h-40 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId('')}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 transition-colors border-b border-slate-200 ${
                        selectedUserId === '' ? 'bg-orange-50 border-l-4 border-orange-500 font-medium' : ''
                      }`}
                    >
                      <span className="text-slate-600 italic">No chairperson (assign later)</span>
                    </button>
                    
                    {filteredUsers.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500 text-center">
                        {searchQuery ? (
                          <p>No users found matching "{searchQuery}"</p>
                        ) : (
                          <div className="space-y-2">
                            <p className="font-medium text-slate-600">No users available yet</p>
                            <p className="text-xs">Users need to sign up first before you can assign them as chairpersons.</p>
                            <p className="text-xs text-blue-600">💡 Tip: Have potential chairpersons create accounts, then come back here to assign them.</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className={`w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0 ${
                            selectedUserId === user.id ? 'bg-orange-50 border-l-4 border-orange-500' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-800">
                                {user.mbg_user_profiles?.[0]?.full_name || 
                                 user.email?.split('@')[0] || 
                                 'No Name'}
                              </p>
                              <p className="text-xs text-slate-600">{user.email}</p>
                              <p className="text-xs text-slate-500">
                                Current role: <span className="font-medium">{user.role_type}</span>
                              </p>
                            </div>
                            {selectedUserId === user.id && (
                              <Check size={16} className="text-orange-600" />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  
                  {selectedUserId && (
                    <div className="mt-3">
                      <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
                        <Check size={12} />
                        Selected: {users.find(u => u.id === selectedUserId)?.email}
                      </p>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Commission Rate (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all font-medium disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Creating...' : 'Create District'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Assign Chairperson Modal
function AssignChairpersonModal({ 
  regionType, 
  regionId, 
  regionName, 
  onClose, 
  onSuccess 
}: { 
  regionType: string; 
  regionId: string; 
  regionName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [commissionRate, setCommissionRate] = useState('5.00');
  const [notes, setNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      // Fetch from mbg_users table (synced from auth.users)
      const allUsers = await userService.getAllUsers();
      
      // Filter out developers
      const availableUsers = allUsers.filter((u: any) => u.role_type !== 'developer');
      setUsers(availableUsers);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    const searchLower = searchQuery.toLowerCase();
    const email = user.email?.toLowerCase() || '';
    const fullName = (
      user.mbg_user_profiles?.[0]?.full_name ||
      user.email?.split('@')[0] ||
      'User'
    ).toLowerCase();
    return email.includes(searchLower) || fullName.includes(searchLower);
  });

  const getRoleFromRegionType = (type: string) => {
    const roleMap: any = {
      'district': 'district_chairperson',
      'division': 'division_chairperson',
      'subcounty': 'subcounty_chairperson',
      'parish': 'parish_chairperson',
      'stage': 'stage_chairperson'
    };
    return roleMap[type];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }

    setAssigning(true);

    // Get selected user's email
    const selectedUser = users.find(u => u.id === selectedUserId);
    if (!selectedUser) {
      toast.error('User not found');
      setAssigning(false);
      return;
    }

    const result = await chairpersonService.assignChairperson({
      targetUserEmail: selectedUser.email,
      targetRole: getRoleFromRegionType(regionType),
      targetRegionType: regionType as any,
      targetRegionId: regionId,
      commissionRate: rate,
      notes: notes.trim() || undefined
    });

    setAssigning(false);

    if (result.success) {
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to assign chairperson');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Assign Chairperson</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700">
            <strong>Region:</strong> {regionName}<br/>
            <strong>Level:</strong> {regionType.charAt(0).toUpperCase() + regionType.slice(1)}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* User Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Select User *
              </label>
              
              {loadingUsers ? (
                <div className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-600 text-sm">
                  Loading users...
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent mb-2"
                  />
                  
                  <div className="border border-slate-300 rounded-lg max-h-48 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500 text-center">
                        {searchQuery ? 'No users found' : 'No users available'}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {filteredUsers.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => setSelectedUserId(user.id)}
                            className={`w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
                              selectedUserId === user.id ? 'bg-orange-50 border-l-4 border-orange-500' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="font-medium text-slate-800">
                                  {user.mbg_user_profiles?.[0]?.full_name || 'No Name'}
                                </p>
                                <p className="text-sm text-slate-600">{user.email}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  Current role: <span className="font-medium">{user.role_type}</span>
                                </p>
                              </div>
                              {selectedUserId === user.id && (
                                <Check size={20} className="text-orange-600" />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {selectedUserId && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      <Check size={14} />
                      User selected: {users.find(u => u.id === selectedUserId)?.email}
                    </p>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Commission Rate (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                rows={3}
                placeholder="Optional notes about this assignment..."
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              disabled={assigning}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={assigning}
            >
              {assigning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <Check size={18} />
                  Assign Chairperson
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// Division Card Component
function DivisionCard({ 
  division, 
  expanded, 
  onToggle, 
  onAssignChairperson,
  onAddSubRegion 
}: { 
  division: Division; 
  expanded: boolean; 
  onToggle: () => void;
  onAssignChairperson: (type: string, id: string, name: string) => void;
  onAddSubRegion: (type: string, parentId: string, parentName: string) => void;
}) {
  const [chairperson, setChairperson] = useState<any>(null);
  const [subcounties, setSubcounties] = useState<Subcounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSubcounty, setExpandedSubcounty] = useState<string | null>(null);

  useEffect(() => {
    loadChairperson();
    if (expanded) {
      loadSubcounties();
    }
  }, [division.id, expanded]);

  const loadChairperson = async () => {
    const data = await regionsService.getRegionChairperson('division', division.id);
    setChairperson(data);
  };

  const loadSubcounties = async () => {
    setLoading(true);
    const data = await regionsService.getSubcountiesByDivision(division.id);
    setSubcounties(data);
    setLoading(false);
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <div className="p-3 hover:bg-slate-50 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <button onClick={onToggle} className="p-1 hover:bg-slate-200 rounded">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="flex-1">
              <span className="font-medium text-slate-800">{division.name}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {chairperson ? (
              <div className="flex items-center gap-1 bg-green-50 px-2 py-1 rounded text-xs">
                <Users size={12} className="text-green-600" />
                <span className="text-green-700 font-medium">
                  {chairperson.mbg_user_profiles?.[0]?.full_name || 'Assigned'}
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-400 italic">
                Assigned by District Chairperson
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-sm font-semibold text-slate-700">Subcounties</h5>
            <button
              onClick={() => onAddSubRegion('subcounty', division.id, division.name)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 font-medium"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          
          {loading ? (
            <p className="text-xs text-slate-600">Loading...</p>
          ) : subcounties.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No subcounties yet</p>
          ) : (
            <div className="space-y-1">
              {subcounties.map((subcounty) => (
                <SubcountyCard
                  key={subcounty.id}
                  subcounty={subcounty}
                  expanded={expandedSubcounty === subcounty.id}
                  onToggle={() => setExpandedSubcounty(expandedSubcounty === subcounty.id ? null : subcounty.id)}
                  onAssignChairperson={onAssignChairperson}
                  onAddSubRegion={onAddSubRegion}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Subcounty Card Component  
function SubcountyCard({ subcounty, expanded, onToggle, onAssignChairperson, onAddSubRegion }: any) {
  const [chairperson, setChairperson] = useState<any>(null);
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedParish, setExpandedParish] = useState<string | null>(null);

  useEffect(() => {
    loadChairperson();
    if (expanded) loadParishes();
  }, [subcounty.id, expanded]);

  const loadChairperson = async () => {
    const data = await regionsService.getRegionChairperson('subcounty', subcounty.id);
    setChairperson(data);
  };

  const loadParishes = async () => {
    setLoading(true);
    const data = await regionsService.getParishesBySubcounty(subcounty.id);
    setParishes(data);
    setLoading(false);
  };

  return (
    <div className="border border-slate-200 rounded bg-white">
      <div className="p-2 hover:bg-slate-50">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 flex-1">
            <button onClick={onToggle} className="p-0.5">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className="font-medium text-slate-700">{subcounty.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {chairperson ? (
              <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">✓</span>
            ) : (
              <span className="text-xs text-slate-400 italic">Via Division Chair</span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center justify-between mb-2">
            <h6 className="text-xs font-semibold text-slate-700">Parishes</h6>
            <button
              onClick={() => onAddSubRegion('parish', subcounty.id, subcounty.name)}
              className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
            >
              + Add
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-slate-600">Loading...</p>
          ) : parishes.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No parishes yet</p>
          ) : (
            <div className="space-y-1">
              {parishes.map((parish) => (
                <ParishCard
                  key={parish.id}
                  parish={parish}
                  expanded={expandedParish === parish.id}
                  onToggle={() => setExpandedParish(expandedParish === parish.id ? null : parish.id)}
                  onAssignChairperson={onAssignChairperson}
                  onAddSubRegion={onAddSubRegion}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Parish Card Component
function ParishCard({ parish, expanded, onToggle, onAssignChairperson, onAddSubRegion }: any) {
  const [chairperson, setChairperson] = useState<any>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadChairperson();
    if (expanded) loadStages();
  }, [parish.id, expanded]);

  const loadChairperson = async () => {
    const data = await regionsService.getRegionChairperson('parish', parish.id);
    setChairperson(data);
  };

  const loadStages = async () => {
    setLoading(true);
    const data = await regionsService.getStagesByParish(parish.id);
    setStages(data);
    setLoading(false);
  };

  return (
    <div className="border border-slate-200 rounded bg-white">
      <div className="p-2 hover:bg-slate-50">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 flex-1">
            <button onClick={onToggle} className="p-0.5">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <span className="font-medium text-slate-700">{parish.name}</span>
          </div>
          {chairperson ? (
            <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">✓</span>
          ) : (
            <span className="text-xs text-slate-400 italic">Via Subcounty Chair</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center justify-between mb-1">
            <h6 className="text-xs font-semibold text-slate-700">Stages (Boda Stations)</h6>
            <button
              onClick={() => onAddSubRegion('stage', parish.id, parish.name)}
              className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded"
            >
              + Add
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-slate-600">Loading...</p>
          ) : stages.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No stages yet</p>
          ) : (
            <div className="space-y-1">
              {stages.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  onAssignChairperson={onAssignChairperson}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Stage Card Component (Final level)
function StageCard({ stage, onAssignChairperson }: any) {
  const [chairperson, setChairperson] = useState<any>(null);

  useEffect(() => {
    loadChairperson();
  }, [stage.id]);

  const loadChairperson = async () => {
    const data = await regionsService.getRegionChairperson('stage', stage.id);
    setChairperson(data);
  };

  return (
    <div className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded text-xs">
      <div className="flex items-center gap-2">
        <MapPin size={12} className="text-orange-500" />
        <span className="font-medium text-slate-700">{stage.name}</span>
        {stage.location_name && (
          <span className="text-slate-500">• {stage.location_name}</span>
        )}
      </div>
      {chairperson ? (
        <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">✓ Assigned</span>
      ) : (
        <span className="text-xs text-slate-400 italic">Via Parish Chair</span>
      )}
    </div>
  );
}

// Add Region Modal (for Divisions, Subcounties, Parishes, Stages)
function AddRegionModal({ regionType, parentId, parentName, onClose, onSuccess }: any) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [locationName, setLocationName] = useState('');
  const [saving, setSaving] = useState(false);

  const getRegionLabel = () => {
    const labels: any = {
      division: 'Division',
      subcounty: 'Subcounty',
      parish: 'Parish',
      stage: 'Stage'
    };
    return labels[regionType] || 'Region';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);

    let result: any = { success: false };

    try {
      switch (regionType) {
        case 'division':
          result = await regionsService.createDivision({
            district_id: parentId,
            name: name.trim(),
            code: code.trim() || undefined,
            description: description.trim() || undefined
          });
          break;
        case 'subcounty':
          result = await regionsService.createSubcounty({
            division_id: parentId,
            name: name.trim(),
            code: code.trim() || undefined,
            description: description.trim() || undefined
          });
          break;
        case 'parish':
          result = await regionsService.createParish({
            subcounty_id: parentId,
            name: name.trim(),
            code: code.trim() || undefined,
            description: description.trim() || undefined
          });
          break;
        case 'stage':
          result = await regionsService.createStage({
            parish_id: parentId,
            name: name.trim(),
            location_name: locationName.trim() || undefined,
            description: description.trim() || undefined
          });
          break;
      }

      if (result.success) {
        onSuccess();
      } else {
        toast.error(result.error || 'Failed to create region');
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Add New {getRegionLabel()}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700">
            <strong>Parent:</strong> {parentName}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {getRegionLabel()} Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder={`e.g., ${regionType === 'stage' ? 'Old Taxi Park' : 'Central'}`}
                required
              />
            </div>

            {regionType === 'stage' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Location Name
                </label>
                <input
                  type="text"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="e.g., Near City Square"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="Optional code"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                rows={3}
                placeholder="Optional description..."
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all font-medium disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Creating...' : `Create ${getRegionLabel()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
