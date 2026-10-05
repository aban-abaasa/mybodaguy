import { supabase } from './supabaseClient';

// Riders + chairpersons voting to remove a chairperson, with a successor taking
// over. Every call goes through a SECURITY DEFINER RPC (see
// ADD_LEADERSHIP_VOTE_REVOKE_AND_TAKEOVER.sql) - the ballot tables are not
// readable from the client, which is what keeps the ballot secret.

export type SeatRegionType = 'district' | 'division' | 'subcounty' | 'parish' | 'stage';

export interface LeadershipMotion {
  id: string;
  status: 'open' | 'passed' | 'failed' | 'cancelled';
  reason: string;
  chair_reply: string | null;
  opened_at: string;
  opened_by_name: string;
  closes_at: string;
  majority_reached: boolean;
  electorate_size: number;
  revoke_needed: number;
  needed_pct: number;
  cast: number;
  yes: number;
  no: number;
  yes_pct: number;
  turnout_pct: number;
  is_voter: boolean;
  is_accused: boolean;
  has_voted: boolean;
  my_ballot: { revoke: boolean; candidate_user_id: string | null } | null;
}

export interface LeadershipSeat {
  region_type: SeatRegionType;
  region_id: string;
  region_name: string;
  level: number;
  role: string;
  holder_user_id: string;
  holder_name: string;
  since: string;
  is_mine: boolean;
  motion: LeadershipMotion | null;
}

export interface LeadershipCandidate {
  user_id: string;
  name: string;
  votes: number;
  share_pct: number;      // share of the successor votes
  pct_of_voters: number;  // share of every eligible voter
  is_me: boolean;
  is_mine_pick: boolean;
}

export interface LeadershipResult {
  status: 'passed' | 'failed';
  closed_at: string;
  close_reason: string | null;
  reason: string;
  chair_reply: string | null;
  winner_name: string | null;
  result: {
    cast: number;
    yes: number;
    no: number;
    electorate_size: number;
    revoke_needed: number;
    candidates: { user_id: string; name: string; votes: number }[];
  } | null;
}

export interface LeadershipRules {
  window_hours: number;
  final_hours: number;
  cooldown_days: number;
  min_voters: number;
  max_candidates: number;
}

export interface LeadershipState {
  seat: {
    region_type: SeatRegionType;
    region_id: string;
    region_name: string | null;
    role: string | null;
    holder_user_id: string | null;
    holder_name: string | null;
    since: string | null;
    is_mine: boolean | null;
  };
  rules: LeadershipRules;
  motion: LeadershipMotion | null;
  candidates: LeadershipCandidate[];
  candidate_count: number;
  i_nominated: boolean;
  can_open: boolean;
  why_not: string | null;
  unlocks_at: string | null;
  last_result: LeadershipResult | null;
}

export interface LeadershipNominee {
  user_id: string;
  name: string;
  stage_name: string | null;
  completed_rides: number;
  rating: number | null;
}

type ActionResult = { success: boolean; error?: string };

// The vote RPCs report business-rule failures as { success:false, error }.
function asResult(data: any, error: any): ActionResult & Record<string, any> {
  if (error) return { success: false, error: error.message || 'Something went wrong' };
  if (!data?.success) return { success: false, error: data?.error || 'Something went wrong' };
  return data;
}

export const leadershipVoteService = {
  async mySeats(): Promise<LeadershipSeat[]> {
    const { data, error } = await supabase.rpc('mbg_my_leadership_seats');
    if (error) {
      console.error('[LeadershipVote] seats:', error);
      throw new Error(error.message);
    }
    return (data as LeadershipSeat[]) || [];
  },

  // A seat is one chairperson in one region (a region can have several).
  async seatState(regionType: SeatRegionType, regionId: string, holderUserId: string): Promise<LeadershipState> {
    const { data, error } = await supabase.rpc('mbg_get_leadership_state', {
      p_region_type: regionType,
      p_region_id: regionId,
      p_holder_user_id: holderUserId,
    });
    if (error) {
      console.error('[LeadershipVote] state:', error);
      throw new Error(error.message);
    }
    return data as LeadershipState;
  },

  async nominees(regionType: SeatRegionType, regionId: string, holderUserId: string, search: string): Promise<LeadershipNominee[]> {
    const { data, error } = await supabase.rpc('mbg_list_leadership_nominees', {
      p_region_type: regionType,
      p_region_id: regionId,
      p_holder_user_id: holderUserId,
      p_search: search.trim() || null,
    });
    if (error) {
      console.error('[LeadershipVote] nominees:', error);
      return [];
    }
    return (data as LeadershipNominee[]) || [];
  },

  async open(regionType: SeatRegionType, regionId: string, holderUserId: string, reason: string, successorUserId: string) {
    const { data, error } = await supabase.rpc('mbg_open_leadership_motion', {
      p_region_type: regionType,
      p_region_id: regionId,
      p_holder_user_id: holderUserId,
      p_reason: reason,
      p_candidate_user_id: successorUserId,
    });
    return asResult(data, error);
  },

  async nominate(motionId: string, userId: string) {
    const { data, error } = await supabase.rpc('mbg_nominate_leadership_candidate', {
      p_motion_id: motionId,
      p_user_id: userId,
    });
    return asResult(data, error);
  },

  // revoke=true needs a successor; revoke=false keeps the chairperson.
  async cast(motionId: string, revoke: boolean, successorUserId: string | null) {
    const { data, error } = await supabase.rpc('mbg_cast_leadership_ballot', {
      p_motion_id: motionId,
      p_revoke: revoke,
      p_candidate_user_id: revoke ? successorUserId : null,
    });
    return asResult(data, error) as ActionResult & { status?: 'open' | 'passed' | 'failed' };
  },

  async reply(motionId: string, text: string) {
    const { data, error } = await supabase.rpc('mbg_reply_leadership_motion', {
      p_motion_id: motionId,
      p_reply: text,
    });
    return asResult(data, error);
  },
};

// What needs this person's attention right now (drives badges / banners).
export function summariseAttention(seats: LeadershipSeat[]) {
  return {
    needsMyVote: seats.filter(s => s.motion && s.motion.is_voter && !s.motion.has_voted).length,
    againstMe: seats.filter(s => s.is_mine && s.motion).length,
  };
}
