import { useState, useEffect } from 'react';
import { Bike, Users, DollarSign, MapPin, LogOut, UserPlus, ChevronRight, TrendingUp, Edit, X, Save } from 'lucide-react';
import { chairpersonService, SubordinateChairperson, CommitteeMember } from '../services/chairpersonService';
import { toast } from 'react-hot-toast';

interface ChairpersonDashboardProps {
  user: any;
  onSignOut: () => void;
}

export default function ChairpersonDashboard({ user, onSignOut }: ChairpersonDashboardProps) {
  const [myCommitteeInfo, setMyCommitteeInfo] = useState<CommitteeMember | null>(null);
  const [subordinates, setSubordinates] = useState<SubordinateChairperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [assignableRegions, setAssignableRegions] = useState<Array<{ id: string; name: string }>>([]);
  const [stats, setStats] = useState({
    totalSubordinates: 0,
    activeSubordinates: 0,
    totalCommission: 0,
    monthlyRides: 0
  });

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    phone: '',
    national_id: '',
    address: ''
  });

  // Assignment form state
  const [assignForm, setAssignForm] = useState({
    email: '',
    regionId: '',
    commissionRate: '5.00',
    notes: ''
  });
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
