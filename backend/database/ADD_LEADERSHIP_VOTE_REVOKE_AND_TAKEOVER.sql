-- ============================================================================
-- BodaGoEra: riders vote to REVOKE a chairperson and a successor TAKES OVER
-- ============================================================================
-- Until now a chairperson could only be put in place (mbg_assign_chairperson)
-- or switched off by their own superior (mbg_update_subordinate_chairperson).
-- The riders under them had no say. This adds a real, one-ballot "leadership
-- vote" for ANY seat (stage, parish, subcounty, division, district):
--
--   WHO VOTES      Every active rider in the seat's area (a district seat =
--                  every rider in the district), every chairperson inside that
--                  area, and the seat's own superior chairperson. One person,
--                  one vote, counted once even if they hold several roles.
--                  The chairperson being challenged does not vote.
--   WHO CAN START  Any one of those voters. No signatures needed - that is
--                  what makes it easy. Starting a vote is also your own ballot.
--   ONE BALLOT     "Remove them" + "who should take over" in the same tap.
--                  A remove ballot MUST name a successor, so the seat can
--                  never be left empty. Anyone eligible can be recommended
--                  (one recommendation per voter, 8 candidates max).
--   REVOKE PASSES  when MORE THAN 50% of ALL eligible voters (not just those
--                  who turned up) vote to remove. The electorate is frozen the
--                  moment the vote opens, so nobody can pad it afterwards.
--   TAKEOVER       the recommended person with the highest share of the
--                  successor votes wins and takes the seat. Ties go to
--                  whoever reached that score first.
--   SMART CLOSING  The vote ends the moment the result can no longer change:
--                   - majority can't be reached any more  -> chair stays
--                   - majority reached AND the leader can't be overtaken
--                     by the voters still to vote         -> takeover now
--                   - everybody has voted                 -> decided now
--                  Otherwise it runs 7 days, but once a majority wants the
--                  chairperson out only 24 more hours remain to pick who.
--   FAIR PLAY      Secret ballot (nobody can see who voted what - only the
--                  totals). Ballots are final. The chairperson can post one
--                  reply everyone sees. A seat that just had a vote is locked
--                  for 30 days so a loser can't be harassed with re-votes.
--
-- Takeover moves everything together: the old chairperson's seat rows go
-- inactive, the winner gets the seat with the SAME seniority (so
-- ride-commission crediting - which picks the earliest active row of a
-- region - follows the seat), direct reports are re-parented to the winner,
-- and user_roles / role_type are synced exactly like mbg_assign_chairperson.
--
-- No pg_cron job: due votes are closed lazily the next time anyone opens the
-- screen or votes (keeps the Supabase Free Plan quiet).
--
-- Push alerts reuse the existing 'bodagoera_message' source of the ICANera
-- push relay (no Edge Function redeploy) and are skipped silently if the push
-- SQL has not been run.
--
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABLES (no direct client access - everything goes through the RPCs below,
--    which is also what keeps the ballot secret)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_leadership_motions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_type        mbg_region_type NOT NULL,
  region_id          UUID NOT NULL,
  seat_role          mbg_chairperson_role NOT NULL,
  seat_committee_id  UUID,
  accused_user_id    UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  parent_user_id     UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  opened_by          UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  reason             TEXT NOT NULL,
  chair_reply        TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'failed', 'cancelled')),
  electorate_size    INTEGER NOT NULL CHECK (electorate_size > 0),
  revoke_needed      INTEGER NOT NULL CHECK (revoke_needed > 0),
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at          TIMESTAMPTZ NOT NULL,
  revoke_majority_at TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  close_reason       TEXT,
  winner_user_id     UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  new_committee_id   UUID,
  result             JSONB
);

-- Only one live vote per seat.
CREATE UNIQUE INDEX IF NOT EXISTS mbg_leadership_one_open_per_seat
  ON public.mbg_leadership_motions (region_type, region_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS mbg_leadership_motions_seat_idx
  ON public.mbg_leadership_motions (region_type, region_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS public.mbg_leadership_candidates (
  motion_id    UUID NOT NULL REFERENCES public.mbg_leadership_motions(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  nominated_by UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (motion_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.mbg_leadership_ballots (
  motion_id         UUID NOT NULL REFERENCES public.mbg_leadership_motions(id) ON DELETE CASCADE,
  voter_id          UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  revoke            BOOLEAN NOT NULL,
  candidate_user_id UUID,
  cast_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (motion_id, voter_id),
  FOREIGN KEY (motion_id, candidate_user_id)
    REFERENCES public.mbg_leadership_candidates (motion_id, user_id) ON DELETE CASCADE,
  -- remove => must name a successor; keep => no successor
  CONSTRAINT mbg_leadership_ballot_shape CHECK (
    (revoke AND candidate_user_id IS NOT NULL) OR (NOT revoke AND candidate_user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS mbg_leadership_ballots_candidate_idx
  ON public.mbg_leadership_ballots (motion_id, candidate_user_id) WHERE revoke;

ALTER TABLE public.mbg_leadership_motions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_leadership_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_leadership_ballots    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_leadership_motions_service    ON public.mbg_leadership_motions;
DROP POLICY IF EXISTS mbg_leadership_candidates_service ON public.mbg_leadership_candidates;
DROP POLICY IF EXISTS mbg_leadership_ballots_service    ON public.mbg_leadership_ballots;
CREATE POLICY mbg_leadership_motions_service    ON public.mbg_leadership_motions    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY mbg_leadership_candidates_service ON public.mbg_leadership_candidates FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY mbg_leadership_ballots_service    ON public.mbg_leadership_ballots    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.mbg_leadership_motions, public.mbg_leadership_candidates, public.mbg_leadership_ballots FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. RULES + SMALL HELPERS (internal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_leadership_rules()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'window_hours', 168,   -- a vote stays open at most 7 days
    'final_hours',  24,    -- once a majority wants the chair out, 24h left to pick who
    'cooldown_days', 30,   -- a seat that just had a vote is locked this long
    'min_voters',   3,     -- fewer eligible voters than this and there is nothing to vote on
    'max_candidates', 8
  );
$$;

CREATE OR REPLACE FUNCTION public.mbg_region_name(p_region_type TEXT, p_region_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE p_region_type
    WHEN 'district'  THEN (SELECT name FROM public.mbg_districts   WHERE id = p_region_id)
    WHEN 'division'  THEN (SELECT name FROM public.mbg_divisions   WHERE id = p_region_id)
    WHEN 'subcounty' THEN (SELECT name FROM public.mbg_subcounties WHERE id = p_region_id)
    WHEN 'parish'    THEN (SELECT name FROM public.mbg_parishes    WHERE id = p_region_id)
    WHEN 'stage'     THEN (SELECT name FROM public.mbg_stages      WHERE id = p_region_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.mbg_person_name(p_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(up.full_name), ''), NULLIF(split_part(u.email, '@', 1), ''), 'Rider')
  FROM public.mbg_users u
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = u.id
  WHERE u.id = p_user_id;
$$;

-- The region itself plus everything beneath it.
CREATE OR REPLACE FUNCTION public.mbg_region_scope(p_region_type TEXT, p_region_id UUID)
RETURNS TABLE (r_type TEXT, r_id UUID)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  r_type := p_region_type; r_id := p_region_id; RETURN NEXT;

  IF p_region_type = 'district' THEN
    RETURN QUERY SELECT 'division'::TEXT, d.id FROM public.mbg_divisions d WHERE d.district_id = p_region_id;
    RETURN QUERY SELECT 'subcounty'::TEXT, sc.id FROM public.mbg_subcounties sc
      JOIN public.mbg_divisions d ON d.id = sc.division_id WHERE d.district_id = p_region_id;
    RETURN QUERY SELECT 'parish'::TEXT, p.id FROM public.mbg_parishes p
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
      JOIN public.mbg_divisions d ON d.id = sc.division_id WHERE d.district_id = p_region_id;
    RETURN QUERY SELECT 'stage'::TEXT, s.id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON p.id = s.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
      JOIN public.mbg_divisions d ON d.id = sc.division_id WHERE d.district_id = p_region_id;
  ELSIF p_region_type = 'division' THEN
    RETURN QUERY SELECT 'subcounty'::TEXT, sc.id FROM public.mbg_subcounties sc WHERE sc.division_id = p_region_id;
    RETURN QUERY SELECT 'parish'::TEXT, p.id FROM public.mbg_parishes p
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id WHERE sc.division_id = p_region_id;
    RETURN QUERY SELECT 'stage'::TEXT, s.id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON p.id = s.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id WHERE sc.division_id = p_region_id;
  ELSIF p_region_type = 'subcounty' THEN
    RETURN QUERY SELECT 'parish'::TEXT, p.id FROM public.mbg_parishes p WHERE p.subcounty_id = p_region_id;
    RETURN QUERY SELECT 'stage'::TEXT, s.id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON p.id = s.parish_id WHERE p.subcounty_id = p_region_id;
  ELSIF p_region_type = 'parish' THEN
    RETURN QUERY SELECT 'stage'::TEXT, s.id FROM public.mbg_stages s WHERE s.parish_id = p_region_id;
  END IF;
END;
$$;

-- The region itself plus every level above it (stage -> parish -> ... -> district).
CREATE OR REPLACE FUNCTION public.mbg_region_ancestors(p_region_type TEXT, p_region_id UUID)
RETURNS TABLE (r_type TEXT, r_id UUID)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_parish UUID; v_sub UUID; v_div UUID; v_dist UUID;
BEGIN
  IF p_region_type = 'stage' THEN
    r_type := 'stage'; r_id := p_region_id; RETURN NEXT;
    SELECT parish_id INTO v_parish FROM public.mbg_stages WHERE id = p_region_id;
  ELSIF p_region_type = 'parish' THEN
    v_parish := p_region_id;
  END IF;
  IF v_parish IS NOT NULL THEN
    r_type := 'parish'; r_id := v_parish; RETURN NEXT;
    SELECT subcounty_id INTO v_sub FROM public.mbg_parishes WHERE id = v_parish;
  END IF;

  IF p_region_type = 'subcounty' THEN v_sub := p_region_id; END IF;
  IF v_sub IS NOT NULL THEN
    r_type := 'subcounty'; r_id := v_sub; RETURN NEXT;
    SELECT division_id INTO v_div FROM public.mbg_subcounties WHERE id = v_sub;
  END IF;

  IF p_region_type = 'division' THEN v_div := p_region_id; END IF;
  IF v_div IS NOT NULL THEN
    r_type := 'division'; r_id := v_div; RETURN NEXT;
    SELECT district_id INTO v_dist FROM public.mbg_divisions WHERE id = v_div;
  END IF;

  IF p_region_type = 'district' THEN v_dist := p_region_id; END IF;
  IF v_dist IS NOT NULL THEN
    r_type := 'district'; r_id := v_dist; RETURN NEXT;
  END IF;
END;
$$;

-- Who currently holds a seat. Same rule the ride-commission code uses to find
-- the chairperson of a region: the earliest-appointed ACTIVE row.
CREATE OR REPLACE FUNCTION public.mbg_seat_holder(p_region_type TEXT, p_region_id UUID)
RETURNS public.mbg_committee_members
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT cm.*
  FROM public.mbg_committee_members cm
  WHERE cm.region_type::TEXT = p_region_type AND cm.region_id = p_region_id AND cm.is_active = true
  ORDER BY cm.appointed_at ASC
  LIMIT 1;
$$;

-- The electorate: active riders in the area + chairpersons in the area + the
-- seat's own superior, minus the accused. Everyone counted once.
CREATE OR REPLACE FUNCTION public.mbg_leadership_electorate(
  p_region_type TEXT, p_region_id UUID, p_accused UUID, p_parent_user UUID, p_asof TIMESTAMPTZ
)
RETURNS TABLE (voter_id UUID)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT v.uid
  FROM (
    SELECT r.user_id AS uid
    FROM public.mbg_riders r
    JOIN public.mbg_region_scope(p_region_type, p_region_id) s ON s.r_type = 'stage' AND s.r_id = r.stage_id
    WHERE r.status = 'active' AND r.created_at <= p_asof
    UNION
    SELECT cm.user_id
    FROM public.mbg_committee_members cm
    JOIN public.mbg_region_scope(p_region_type, p_region_id) s ON s.r_type = cm.region_type::TEXT AND s.r_id = cm.region_id
    WHERE cm.is_active = true AND cm.appointed_at <= p_asof
    UNION
    SELECT p_parent_user WHERE p_parent_user IS NOT NULL
  ) v
  JOIN public.mbg_users u ON u.id = v.uid AND u.is_active = true
  WHERE v.uid <> p_accused;
$$;

-- People who can be recommended: active riders inside the area, never the accused.
CREATE OR REPLACE FUNCTION public.mbg_leadership_eligible_successor(
  p_region_type TEXT, p_region_id UUID, p_accused UUID, p_user UUID, p_asof TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_user <> p_accused AND EXISTS (
    SELECT 1
    FROM public.mbg_riders r
    JOIN public.mbg_region_scope(p_region_type, p_region_id) s ON s.r_type = 'stage' AND s.r_id = r.stage_id
    JOIN public.mbg_users u ON u.id = r.user_id AND u.is_active = true
    WHERE r.user_id = p_user AND r.status = 'active' AND r.created_at <= p_asof
  );
$$;

-- Candidates ranked: most successor votes, then whoever reached that score
-- first, then whoever was recommended first.
CREATE OR REPLACE FUNCTION public.mbg_leadership_ranking(p_motion_id UUID)
RETURNS TABLE (candidate_id UUID, votes INTEGER, reached_at TIMESTAMPTZ, nominated_at TIMESTAMPTZ, nominated_by UUID)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH picks AS (
    SELECT b.candidate_user_id AS cand, b.cast_at,
           count(*) OVER (PARTITION BY b.candidate_user_id)::INTEGER AS votes,
           row_number() OVER (PARTITION BY b.candidate_user_id ORDER BY b.cast_at) AS nth
    FROM public.mbg_leadership_ballots b
    WHERE b.motion_id = p_motion_id AND b.revoke AND b.candidate_user_id IS NOT NULL
  )
  SELECT c.user_id,
         COALESCE(max(p.votes), 0)::INTEGER,
         min(p.cast_at) FILTER (WHERE p.nth = p.votes),
         c.created_at,
         c.nominated_by
  FROM public.mbg_leadership_candidates c
  LEFT JOIN picks p ON p.cand = c.user_id
  WHERE c.motion_id = p_motion_id
  GROUP BY c.user_id, c.created_at, c.nominated_by
  ORDER BY 2 DESC, 3 ASC NULLS LAST, c.created_at ASC;
$$;

-- Best-effort phone push. Never lets a missing/broken push setup break a vote.
CREATE OR REPLACE FUNCTION public.mbg_leadership_notify(p_user UUID, p_title TEXT, p_body TEXT, p_motion UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  PERFORM public.mbg_push(p_user, 'bodagoera_message', p_title, p_body, NULL, 'mbg-vote-' || p_motion::TEXT);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. CLOSING A VOTE + THE TAKEOVER (internal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_leadership_close(p_motion_id UUID, p_passed BOOLEAN, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m          public.mbg_leadership_motions%ROWTYPE;
  v_old      public.mbg_committee_members%ROWTYPE;
  v_holder   public.mbg_committee_members%ROWTYPE;
  v_cast     INTEGER;
  v_yes      INTEGER;
  v_passed   BOOLEAN := p_passed;
  v_reason   TEXT := p_reason;
  v_winner   UUID;
  v_new_id   UUID;
  v_rank     RECORD;
  v_stage    UUID;
  v_result   JSONB;
BEGIN
  SELECT * INTO m FROM public.mbg_leadership_motions WHERE id = p_motion_id;
  IF NOT FOUND OR m.status <> 'open' THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE revoke) INTO v_cast, v_yes
  FROM public.mbg_leadership_ballots WHERE motion_id = m.id;

  IF v_passed THEN
    -- The seat must still belong to the person being challenged.
    v_holder := public.mbg_seat_holder(m.region_type::TEXT, m.region_id);
    IF v_holder.id IS NULL OR v_holder.user_id <> m.accused_user_id THEN
      v_passed := false;
      v_reason := 'The seat changed hands while the vote was open';
    ELSE
      v_old := v_holder;
      -- Highest share of the successor votes who is still an eligible rider.
      FOR v_rank IN SELECT * FROM public.mbg_leadership_ranking(m.id) WHERE votes > 0 LOOP
        IF public.mbg_leadership_eligible_successor(m.region_type::TEXT, m.region_id, m.accused_user_id, v_rank.candidate_id, NOW()) THEN
          v_winner := v_rank.candidate_id;
          EXIT;
        END IF;
      END LOOP;
      IF v_winner IS NULL THEN
        v_passed := false;
        v_reason := 'No eligible successor was left standing';
      END IF;
    END IF;
  END IF;

  IF v_passed THEN
    -- 1. Old chairperson out: the seat row, the rows cascaded from it, and the
    --    stage-level row created in the very same assignment.
    UPDATE public.mbg_committee_members
    SET is_active = false, updated_at = NOW()
    WHERE is_active = true AND user_id = m.accused_user_id AND (
      id = v_old.id
      OR parent_chairperson_id = v_old.id
      OR (role = 'stage_chairperson' AND region_type = 'stage'
          AND appointed_at = v_old.appointed_at
          AND assigned_by IS NOT DISTINCT FROM v_old.assigned_by)
    );

    -- 2. Winner in, keeping the seat's seniority (ride commissions credit the
    --    earliest active row of a region, so the money follows the seat).
    INSERT INTO public.mbg_committee_members (
      user_id, role, region_type, region_id, assigned_by,
      parent_chairperson_id, commission_rate, is_active, appointed_at
    ) VALUES (
      v_winner, v_old.role, v_old.region_type, v_old.region_id, v_old.assigned_by,
      v_old.parent_chairperson_id, v_old.commission_rate, true, v_old.appointed_at
    )
    ON CONFLICT (user_id, region_type, region_id) DO UPDATE SET
      role = EXCLUDED.role,
      assigned_by = EXCLUDED.assigned_by,
      parent_chairperson_id = EXCLUDED.parent_chairperson_id,
      commission_rate = EXCLUDED.commission_rate,
      is_active = true,
      appointed_at = EXCLUDED.appointed_at,
      updated_at = NOW()
    RETURNING id INTO v_new_id;

    -- 3. The old chairperson's direct reports now report to the winner.
    UPDATE public.mbg_committee_members
    SET parent_chairperson_id = v_new_id, updated_at = NOW()
    WHERE parent_chairperson_id = v_old.id AND user_id <> m.accused_user_id AND id <> v_new_id;

    -- 4. Same convenience mbg_assign_chairperson gives every chairperson: a
    --    stage-level row on their own stage so they can manage its riders.
    --    Newest appointed_at so it never outranks that stage's real chairperson.
    IF v_old.role <> 'stage_chairperson' THEN
      SELECT r.stage_id INTO v_stage
      FROM public.mbg_riders r
      JOIN public.mbg_region_scope(m.region_type::TEXT, m.region_id) s ON s.r_type = 'stage' AND s.r_id = r.stage_id
      WHERE r.user_id = v_winner AND r.status = 'active'
      LIMIT 1;
      IF v_stage IS NOT NULL THEN
        INSERT INTO public.mbg_committee_members (
          user_id, role, region_type, region_id, assigned_by,
          parent_chairperson_id, commission_rate, is_active, appointed_at
        ) VALUES (
          v_winner, 'stage_chairperson', 'stage', v_stage, v_old.assigned_by,
          v_new_id, v_old.commission_rate, true, NOW()
        )
        ON CONFLICT (user_id, region_type, region_id) DO UPDATE SET is_active = true, updated_at = NOW();
      END IF;
    END IF;

    -- 5. Roles, exactly as mbg_assign_chairperson syncs them.
    UPDATE public.mbg_users SET role_type = 'chairperson', updated_at = NOW()
    WHERE id = v_winner AND role_type <> 'developer';
    PERFORM public.add_user_role(v_winner, 'chairperson');
    PERFORM public.add_user_role(v_winner, 'rider');

    IF NOT EXISTS (
      SELECT 1 FROM public.mbg_committee_members WHERE user_id = m.accused_user_id AND is_active = true
    ) THEN
      PERFORM public.remove_user_role(m.accused_user_id, 'chairperson');
      UPDATE public.mbg_users
      SET role_type = CASE WHEN 'rider' = ANY (COALESCE(user_roles, ARRAY[]::TEXT[]))
                           THEN 'rider'::mbg_user_role_type ELSE 'customer'::mbg_user_role_type END,
          updated_at = NOW()
      WHERE id = m.accused_user_id AND role_type = 'chairperson';
    END IF;
  END IF;

  -- Final tally, kept as the permanent record of the vote.
  SELECT jsonb_build_object(
    'cast', v_cast,
    'yes', v_yes,
    'no', v_cast - v_yes,
    'electorate_size', m.electorate_size,
    'revoke_needed', m.revoke_needed,
    'candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', rk.candidate_id, 'name', public.mbg_person_name(rk.candidate_id), 'votes', rk.votes
      ) ORDER BY rk.votes DESC, rk.reached_at ASC NULLS LAST, rk.nominated_at ASC)
      FROM public.mbg_leadership_ranking(m.id) rk
    ), '[]'::JSONB)
  ) INTO v_result;

  UPDATE public.mbg_leadership_motions
  SET status = CASE WHEN v_passed THEN 'passed' ELSE 'failed' END,
      closed_at = NOW(),
      close_reason = v_reason,
      winner_user_id = CASE WHEN v_passed THEN v_winner END,
      new_committee_id = CASE WHEN v_passed THEN v_new_id END,
      result = v_result
  WHERE id = m.id;

  -- Tell the people it matters to (best effort).
  IF v_passed THEN
    PERFORM public.mbg_leadership_notify(v_winner, 'You are the new chairperson',
      'Riders voted you in as ' || replace(m.seat_role::TEXT, '_', ' ') || ' of ' || COALESCE(public.mbg_region_name(m.region_type::TEXT, m.region_id), 'your area') || '.', m.id);
    PERFORM public.mbg_leadership_notify(m.accused_user_id, 'Leadership vote ended',
      'A majority voted for a new ' || replace(m.seat_role::TEXT, '_', ' ') || '. Your seat has passed to ' || public.mbg_person_name(v_winner) || '.', m.id);
    PERFORM public.mbg_leadership_notify(m.parent_user_id, 'Chairperson replaced by vote',
      public.mbg_person_name(v_winner) || ' now holds the ' || replace(m.seat_role::TEXT, '_', ' ') || ' seat of ' || COALESCE(public.mbg_region_name(m.region_type::TEXT, m.region_id), 'the area') || '.', m.id);
  ELSE
    PERFORM public.mbg_leadership_notify(m.accused_user_id, 'Leadership vote ended',
      'The vote ended and you keep your seat. ' || v_reason || '.', m.id);
  END IF;
END;
$$;

-- Decide whether a vote is finished. Safe to call any time; the row lock makes
-- concurrent votes line up one at a time.
CREATE OR REPLACE FUNCTION public.mbg_leadership_resolve(p_motion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m           public.mbg_leadership_motions%ROWTYPE;
  v_cast      INTEGER;
  v_yes       INTEGER;
  v_remaining INTEGER;
  v_l1        INTEGER;
  v_l2        INTEGER;
  v_close_at  TIMESTAMPTZ;
  v_final_h   INTEGER := (public.mbg_leadership_rules() ->> 'final_hours')::INTEGER;
BEGIN
  SELECT * INTO m FROM public.mbg_leadership_motions WHERE id = p_motion_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF m.status <> 'open' THEN RETURN m.status; END IF;

  SELECT count(*), count(*) FILTER (WHERE revoke) INTO v_cast, v_yes
  FROM public.mbg_leadership_ballots WHERE motion_id = m.id;
  v_remaining := GREATEST(m.electorate_size - v_cast, 0);

  -- The first time a majority wants the chairperson out, start the 24h clock
  -- for choosing who replaces them.
  IF v_yes >= m.revoke_needed AND m.revoke_majority_at IS NULL THEN
    UPDATE public.mbg_leadership_motions SET revoke_majority_at = NOW() WHERE id = m.id;
    m.revoke_majority_at := NOW();
  END IF;

  v_close_at := m.closes_at;
  IF m.revoke_majority_at IS NOT NULL THEN
    v_close_at := LEAST(m.closes_at, m.revoke_majority_at + make_interval(hours => v_final_h));
  END IF;

  -- 1. Even if every voter left voted to remove, a majority is out of reach.
  IF v_yes + v_remaining < m.revoke_needed THEN
    PERFORM public.mbg_leadership_close(m.id, false, 'A majority can no longer be reached');
    RETURN 'failed';
  END IF;

  -- 2. Everybody has voted, or time is up.
  IF v_remaining = 0 OR NOW() >= v_close_at THEN
    IF v_yes >= m.revoke_needed THEN
      PERFORM public.mbg_leadership_close(m.id, true, 'More than half of all eligible voters chose to remove the chairperson');
    ELSE
      PERFORM public.mbg_leadership_close(m.id, false, 'The vote ended without a majority');
    END IF;
    RETURN (SELECT status FROM public.mbg_leadership_motions WHERE id = m.id);
  END IF;

  -- 3. A majority wants a change and nobody who is still to vote can overtake
  --    the front-runner: no reason to keep the seat in limbo.
  IF v_yes >= m.revoke_needed THEN
    SELECT COALESCE(max(votes) FILTER (WHERE rn = 1), 0), COALESCE(max(votes) FILTER (WHERE rn = 2), 0)
    INTO v_l1, v_l2
    FROM (
      SELECT votes, row_number() OVER (ORDER BY votes DESC) AS rn
      FROM public.mbg_leadership_ranking(m.id)
    ) t;
    IF v_l1 > 0 AND (v_l1 - v_l2) > v_remaining THEN
      PERFORM public.mbg_leadership_close(m.id, true, 'A majority chose to remove the chairperson and the leading successor cannot be overtaken');
      RETURN (SELECT status FROM public.mbg_leadership_motions WHERE id = m.id);
    END IF;
  END IF;

  RETURN 'open';
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPCs THE APP CALLS
-- ----------------------------------------------------------------------------

-- Compact summary of a seat's vote, shared by the seat list and the detail view.
CREATE OR REPLACE FUNCTION public.mbg_leadership_motion_summary(p_motion_id UUID, p_uid UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  m          public.mbg_leadership_motions%ROWTYPE;
  v_cast     INTEGER;
  v_yes      INTEGER;
  v_mine     public.mbg_leadership_ballots%ROWTYPE;
  v_close_at TIMESTAMPTZ;
  v_final_h  INTEGER := (public.mbg_leadership_rules() ->> 'final_hours')::INTEGER;
  v_is_voter BOOLEAN;
BEGIN
  SELECT * INTO m FROM public.mbg_leadership_motions WHERE id = p_motion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), count(*) FILTER (WHERE revoke) INTO v_cast, v_yes
  FROM public.mbg_leadership_ballots WHERE motion_id = m.id;
  SELECT * INTO v_mine FROM public.mbg_leadership_ballots WHERE motion_id = m.id AND voter_id = p_uid;

  v_close_at := m.closes_at;
  IF m.revoke_majority_at IS NOT NULL THEN
    v_close_at := LEAST(m.closes_at, m.revoke_majority_at + make_interval(hours => v_final_h));
  END IF;

  v_is_voter := p_uid <> m.accused_user_id AND EXISTS (
    SELECT 1 FROM public.mbg_leadership_electorate(m.region_type::TEXT, m.region_id, m.accused_user_id, m.parent_user_id, m.opened_at) e
    WHERE e.voter_id = p_uid
  );

  RETURN jsonb_build_object(
    'id', m.id,
    'status', m.status,
    'reason', m.reason,
    'chair_reply', m.chair_reply,
    'opened_at', m.opened_at,
    'opened_by_name', public.mbg_person_name(m.opened_by),
    'closes_at', v_close_at,
    'majority_reached', m.revoke_majority_at IS NOT NULL,
    'electorate_size', m.electorate_size,
    'revoke_needed', m.revoke_needed,
    'needed_pct', round(100.0 * m.revoke_needed / m.electorate_size, 1),
    'cast', v_cast,
    'yes', v_yes,
    'no', v_cast - v_yes,
    'yes_pct', round(100.0 * v_yes / m.electorate_size, 1),
    'turnout_pct', round(100.0 * v_cast / m.electorate_size, 1),
    'is_voter', v_is_voter,
    'is_accused', p_uid = m.accused_user_id,
    'has_voted', v_mine.voter_id IS NOT NULL,
    'my_ballot', CASE WHEN v_mine.voter_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revoke', v_mine.revoke, 'candidate_user_id', v_mine.candidate_user_id) END
  );
END;
$$;

-- Everything the screen needs about ONE seat.
CREATE OR REPLACE FUNCTION public.mbg_get_leadership_state(p_region_type TEXT, p_region_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_rules     JSONB := public.mbg_leadership_rules();
  v_holder    public.mbg_committee_members%ROWTYPE;
  v_parent    UUID;
  v_open_id   UUID;
  v_summary   JSONB;
  v_last      public.mbg_leadership_motions%ROWTYPE;
  v_elect_n   INTEGER;
  v_is_voter  BOOLEAN := false;
  v_can_open  BOOLEAN := false;
  v_why       TEXT;
  v_unlock    TIMESTAMPTZ;
  v_cands     JSONB := '[]'::JSONB;
  v_yes       INTEGER;
  v_my_nom    BOOLEAN := false;
  v_cand_n    INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_region_type NOT IN ('district', 'division', 'subcounty', 'parish', 'stage') THEN
    RAISE EXCEPTION 'Unknown area type';
  END IF;

  -- Lazily close a vote that is due.
  SELECT id INTO v_open_id FROM public.mbg_leadership_motions
  WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status = 'open';
  IF v_open_id IS NOT NULL THEN
    IF public.mbg_leadership_resolve(v_open_id) <> 'open' THEN v_open_id := NULL; END IF;
  END IF;

  v_holder := public.mbg_seat_holder(p_region_type, p_region_id);

  SELECT * INTO v_last FROM public.mbg_leadership_motions
  WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status IN ('passed', 'failed')
  ORDER BY closed_at DESC LIMIT 1;

  IF v_open_id IS NOT NULL THEN
    v_summary := public.mbg_leadership_motion_summary(v_open_id, v_uid);
    v_is_voter := COALESCE((v_summary ->> 'is_voter')::BOOLEAN, false);
    v_yes := (v_summary ->> 'yes')::INTEGER;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'user_id', rk.candidate_id,
             'name', public.mbg_person_name(rk.candidate_id),
             'votes', rk.votes,
             'share_pct', CASE WHEN v_yes > 0 THEN round(100.0 * rk.votes / v_yes, 1) ELSE 0 END,
             'pct_of_voters', round(100.0 * rk.votes / (v_summary ->> 'electorate_size')::INTEGER, 1),
             'is_me', rk.candidate_id = v_uid,
             'is_mine_pick', rk.candidate_id = ((v_summary -> 'my_ballot') ->> 'candidate_user_id')::UUID
           ) ORDER BY rk.votes DESC, rk.reached_at ASC NULLS LAST, rk.nominated_at ASC), '[]'::JSONB),
           count(*)::INTEGER,
           COALESCE(bool_or(rk.nominated_by = v_uid), false)
    INTO v_cands, v_cand_n, v_my_nom
    FROM public.mbg_leadership_ranking(v_open_id) rk;
  ELSIF v_holder.id IS NULL THEN
    v_why := 'This seat has no chairperson to vote on';
  ELSIF v_holder.user_id = v_uid THEN
    v_why := 'This is your own seat';
  ELSE
    v_parent := (SELECT p.user_id FROM public.mbg_committee_members p WHERE p.id = v_holder.parent_chairperson_id AND p.is_active = true);
    SELECT count(*) INTO v_elect_n
    FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW());
    v_is_voter := EXISTS (
      SELECT 1 FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW()) e
      WHERE e.voter_id = v_uid
    );

    v_unlock := (SELECT max(closed_at) + make_interval(days => (v_rules ->> 'cooldown_days')::INTEGER)
                 FROM public.mbg_leadership_motions
                 WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status IN ('passed', 'failed'));

    IF NOT v_is_voter THEN
      v_why := 'Only riders and chairpersons in this area can vote on this seat';
    ELSIF v_elect_n < (v_rules ->> 'min_voters')::INTEGER THEN
      v_why := 'At least ' || (v_rules ->> 'min_voters') || ' eligible voters are needed';
    ELSIF v_unlock IS NOT NULL AND v_unlock > NOW() THEN
      v_why := 'This seat just had a vote. A new one can start after ' || to_char(v_unlock, 'DD Mon YYYY');
    ELSE
      v_can_open := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'seat', jsonb_build_object(
      'region_type', p_region_type,
      'region_id', p_region_id,
      'region_name', public.mbg_region_name(p_region_type, p_region_id),
      'role', v_holder.role,
      'holder_user_id', v_holder.user_id,
      'holder_name', CASE WHEN v_holder.id IS NULL THEN NULL ELSE public.mbg_person_name(v_holder.user_id) END,
      'since', v_holder.appointed_at,
      'is_mine', v_holder.user_id = v_uid
    ),
    'rules', v_rules,
    'motion', v_summary,
    'candidates', v_cands,
    'candidate_count', v_cand_n,
    'i_nominated', v_my_nom,
    'can_open', v_can_open,
    'why_not', v_why,
    'unlocks_at', CASE WHEN v_unlock IS NOT NULL AND v_unlock > NOW() THEN v_unlock END,
    'last_result', CASE WHEN v_last.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_last.status,
      'closed_at', v_last.closed_at,
      'close_reason', v_last.close_reason,
      'reason', v_last.reason,
      'chair_reply', v_last.chair_reply,
      'winner_name', CASE WHEN v_last.winner_user_id IS NULL THEN NULL ELSE public.mbg_person_name(v_last.winner_user_id) END,
      'result', v_last.result) END
  );
END;
$$;

-- The caller's seats: every chairperson they can hold to account (their stage
-- and every level above it, plus their own superior and direct reports), and
-- their own seats so an accused chairperson sees a vote against them.
CREATE OR REPLACE FUNCTION public.mbg_my_leadership_seats()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_out     JSONB := '[]'::JSONB;
  v_seat    RECORD;
  v_holder  public.mbg_committee_members%ROWTYPE;
  v_open_id UUID;
  v_lvl     INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;

  FOR v_seat IN
    WITH base AS (
      SELECT 'stage'::TEXT AS t, r.stage_id AS i FROM public.mbg_riders r WHERE r.user_id = v_uid AND r.status = 'active'
      UNION
      SELECT cm.region_type::TEXT, cm.region_id FROM public.mbg_committee_members cm
      WHERE cm.user_id = v_uid AND cm.is_active = true
      UNION
      SELECT p.region_type::TEXT, p.region_id
      FROM public.mbg_committee_members cm
      JOIN public.mbg_committee_members p ON p.id = cm.parent_chairperson_id AND p.is_active = true
      WHERE cm.user_id = v_uid AND cm.is_active = true
      UNION
      SELECT c.region_type::TEXT, c.region_id
      FROM public.mbg_committee_members mine
      JOIN public.mbg_committee_members c ON c.parent_chairperson_id = mine.id AND c.is_active = true
      WHERE mine.user_id = v_uid AND mine.is_active = true
    )
    SELECT DISTINCT a.r_type, a.r_id
    FROM base b
    CROSS JOIN LATERAL public.mbg_region_ancestors(b.t, b.i) a
  LOOP
    -- Skip rows that don't point at a real area (legacy cascade rows).
    IF public.mbg_region_name(v_seat.r_type, v_seat.r_id) IS NULL THEN CONTINUE; END IF;

    v_holder := public.mbg_seat_holder(v_seat.r_type, v_seat.r_id);
    IF v_holder.id IS NULL THEN CONTINUE; END IF;

    v_open_id := NULL;
    SELECT id INTO v_open_id FROM public.mbg_leadership_motions
    WHERE region_type::TEXT = v_seat.r_type AND region_id = v_seat.r_id AND status = 'open';
    IF v_open_id IS NOT NULL AND public.mbg_leadership_resolve(v_open_id) <> 'open' THEN
      v_open_id := NULL;
    END IF;

    v_lvl := CASE v_seat.r_type WHEN 'stage' THEN 5 WHEN 'parish' THEN 4 WHEN 'subcounty' THEN 3 WHEN 'division' THEN 2 ELSE 1 END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'region_type', v_seat.r_type,
      'region_id', v_seat.r_id,
      'region_name', public.mbg_region_name(v_seat.r_type, v_seat.r_id),
      'level', v_lvl,
      'role', v_holder.role,
      'holder_user_id', v_holder.user_id,
      'holder_name', public.mbg_person_name(v_holder.user_id),
      'since', v_holder.appointed_at,
      'is_mine', v_holder.user_id = v_uid,
      'motion', CASE WHEN v_open_id IS NULL THEN NULL ELSE public.mbg_leadership_motion_summary(v_open_id, v_uid) END
    ));
  END LOOP;

  RETURN v_out;
END;
$$;

-- Riders you can recommend for a seat (search by name).
CREATE OR REPLACE FUNCTION public.mbg_list_leadership_nominees(p_region_type TEXT, p_region_id UUID, p_search TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_holder public.mbg_committee_members%ROWTYPE;
  v_parent UUID;
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  v_holder := public.mbg_seat_holder(p_region_type, p_region_id);
  IF v_holder.id IS NULL THEN RETURN '[]'::JSONB; END IF;
  v_parent := (SELECT p.user_id FROM public.mbg_committee_members p WHERE p.id = v_holder.parent_chairperson_id AND p.is_active = true);

  IF v_uid = v_holder.user_id OR NOT EXISTS (
    SELECT 1 FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW()) e WHERE e.voter_id = v_uid
  ) THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.name)
    FROM (
      SELECT DISTINCT ON (r.user_id)
             r.user_id,
             public.mbg_person_name(r.user_id) AS name,
             public.mbg_region_name('stage', r.stage_id) AS stage_name,
             COALESCE(r.completed_rides, 0) AS completed_rides,
             r.rating
      FROM public.mbg_riders r
      JOIN public.mbg_region_scope(p_region_type, p_region_id) s ON s.r_type = 'stage' AND s.r_id = r.stage_id
      JOIN public.mbg_users u ON u.id = r.user_id AND u.is_active = true
      WHERE r.status = 'active'
        AND r.user_id <> v_holder.user_id
        AND (v_q IS NULL OR public.mbg_person_name(r.user_id) ILIKE '%' || v_q || '%')
      ORDER BY r.user_id
      LIMIT 40
    ) t
  ), '[]'::JSONB);
END;
$$;

-- Start a vote. Starting it is also your own ballot: remove + your pick.
CREATE OR REPLACE FUNCTION public.mbg_open_leadership_motion(
  p_region_type TEXT, p_region_id UUID, p_reason TEXT, p_candidate_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_rules   JSONB := public.mbg_leadership_rules();
  v_holder  public.mbg_committee_members%ROWTYPE;
  v_parent  UUID;
  v_reason  TEXT := btrim(COALESCE(p_reason, ''));
  v_elect_n INTEGER;
  v_unlock  TIMESTAMPTZ;
  v_id      UUID;
  v_voter   RECORD;
  v_label   TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_region_type NOT IN ('district', 'division', 'subcounty', 'parish', 'stage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown area type');
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give a reason of 10 to 500 characters so voters know why');
  END IF;

  v_holder := public.mbg_seat_holder(p_region_type, p_region_id);
  IF v_holder.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This seat has no chairperson to vote on');
  END IF;
  IF v_holder.user_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot start a vote on your own seat');
  END IF;

  v_parent := (SELECT p.user_id FROM public.mbg_committee_members p WHERE p.id = v_holder.parent_chairperson_id AND p.is_active = true);

  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW()) e WHERE e.voter_id = v_uid
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only riders and chairpersons in this area can start a vote on this seat');
  END IF;

  SELECT count(*) INTO v_elect_n
  FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW());
  IF v_elect_n < (v_rules ->> 'min_voters')::INTEGER THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least ' || (v_rules ->> 'min_voters') || ' eligible voters are needed');
  END IF;

  -- Settle any vote that is due before deciding there is already one running.
  PERFORM public.mbg_leadership_resolve(id) FROM public.mbg_leadership_motions
  WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status = 'open';
  IF EXISTS (SELECT 1 FROM public.mbg_leadership_motions
             WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status = 'open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'A vote is already open on this seat - join it instead');
  END IF;

  v_unlock := (SELECT max(closed_at) + make_interval(days => (v_rules ->> 'cooldown_days')::INTEGER)
               FROM public.mbg_leadership_motions
               WHERE region_type::TEXT = p_region_type AND region_id = p_region_id AND status IN ('passed', 'failed'));
  IF v_unlock IS NOT NULL AND v_unlock > NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This seat just had a vote. A new one can start after ' || to_char(v_unlock, 'DD Mon YYYY'));
  END IF;

  IF p_candidate_user_id IS NULL OR NOT public.mbg_leadership_eligible_successor(p_region_type, p_region_id, v_holder.user_id, p_candidate_user_id, NOW()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick an active rider in this area to take over');
  END IF;

  INSERT INTO public.mbg_leadership_motions (
    region_type, region_id, seat_role, seat_committee_id, accused_user_id, parent_user_id,
    opened_by, reason, electorate_size, revoke_needed, opened_at, closes_at
  ) VALUES (
    p_region_type::mbg_region_type, p_region_id, v_holder.role, v_holder.id, v_holder.user_id, v_parent,
    v_uid, v_reason, v_elect_n, (v_elect_n / 2) + 1, NOW(),
    NOW() + make_interval(hours => (v_rules ->> 'window_hours')::INTEGER)
  ) RETURNING id INTO v_id;

  INSERT INTO public.mbg_leadership_candidates (motion_id, user_id, nominated_by)
  VALUES (v_id, p_candidate_user_id, v_uid);
  INSERT INTO public.mbg_leadership_ballots (motion_id, voter_id, revoke, candidate_user_id)
  VALUES (v_id, v_uid, true, p_candidate_user_id);

  -- Tell the voters (capped), and the chairperson so they can reply.
  v_label := replace(v_holder.role::TEXT, '_', ' ') || ' of ' || COALESCE(public.mbg_region_name(p_region_type, p_region_id), 'your area');
  FOR v_voter IN
    SELECT voter_id FROM public.mbg_leadership_electorate(p_region_type, p_region_id, v_holder.user_id, v_parent, NOW())
    WHERE voter_id <> v_uid LIMIT 300
  LOOP
    PERFORM public.mbg_leadership_notify(v_voter.voter_id, 'Leadership vote is open',
      'Riders are voting on the ' || v_label || '. Your vote counts - open BodaGoEra > Vote.', v_id);
  END LOOP;
  PERFORM public.mbg_leadership_notify(v_holder.user_id, 'A vote on your seat has opened',
    'Riders opened a vote on your seat. Open BodaGoEra > Vote to reply.', v_id);

  PERFORM public.mbg_leadership_resolve(v_id);
  RETURN jsonb_build_object('success', true, 'motion_id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'A vote is already open on this seat - join it instead');
END;
$$;

-- Recommend a successor (one recommendation per voter).
CREATE OR REPLACE FUNCTION public.mbg_nominate_leadership_candidate(p_motion_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  m       public.mbg_leadership_motions%ROWTYPE;
  v_max   INTEGER := (public.mbg_leadership_rules() ->> 'max_candidates')::INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;

  IF public.mbg_leadership_resolve(p_motion_id) IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This vote has already closed');
  END IF;
  SELECT * INTO m FROM public.mbg_leadership_motions WHERE id = p_motion_id;

  IF v_uid = m.accused_user_id OR NOT EXISTS (
    SELECT 1 FROM public.mbg_leadership_electorate(m.region_type::TEXT, m.region_id, m.accused_user_id, m.parent_user_id, m.opened_at) e WHERE e.voter_id = v_uid
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not an eligible voter on this seat');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_leadership_candidates WHERE motion_id = m.id AND nominated_by = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already recommended someone - vote for them or for another candidate');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_leadership_candidates WHERE motion_id = m.id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That rider is already a candidate');
  END IF;
  IF (SELECT count(*) FROM public.mbg_leadership_candidates WHERE motion_id = m.id) >= v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'The candidate list is full (' || v_max || ') - vote for one of them');
  END IF;
  IF NOT public.mbg_leadership_eligible_successor(m.region_type::TEXT, m.region_id, m.accused_user_id, p_user_id, m.opened_at) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only active riders who were in this area when the vote opened can be recommended');
  END IF;

  INSERT INTO public.mbg_leadership_candidates (motion_id, user_id, nominated_by) VALUES (m.id, p_user_id, v_uid);
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Cast your ONE ballot. p_revoke = true needs a successor; false keeps the chair.
CREATE OR REPLACE FUNCTION public.mbg_cast_leadership_ballot(
  p_motion_id UUID, p_revoke BOOLEAN, p_candidate_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  m        public.mbg_leadership_motions%ROWTYPE;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_revoke IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose remove or keep');
  END IF;

  IF public.mbg_leadership_resolve(p_motion_id) IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This vote has already closed');
  END IF;
  SELECT * INTO m FROM public.mbg_leadership_motions WHERE id = p_motion_id;

  IF v_uid = m.accused_user_id OR NOT EXISTS (
    SELECT 1 FROM public.mbg_leadership_electorate(m.region_type::TEXT, m.region_id, m.accused_user_id, m.parent_user_id, m.opened_at) e WHERE e.voter_id = v_uid
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not an eligible voter on this seat');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_leadership_ballots WHERE motion_id = m.id AND voter_id = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already voted - ballots are final');
  END IF;

  IF p_revoke THEN
    IF p_candidate_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.mbg_leadership_candidates WHERE motion_id = m.id AND user_id = p_candidate_user_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Pick who should take over');
    END IF;
  ELSE
    p_candidate_user_id := NULL;
  END IF;

  INSERT INTO public.mbg_leadership_ballots (motion_id, voter_id, revoke, candidate_user_id)
  VALUES (m.id, v_uid, p_revoke, p_candidate_user_id);

  v_status := public.mbg_leadership_resolve(m.id);
  RETURN jsonb_build_object('success', true, 'status', v_status);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'You have already voted - ballots are final');
END;
$$;

-- The challenged chairperson's one public reply.
CREATE OR REPLACE FUNCTION public.mbg_reply_leadership_motion(p_motion_id UUID, p_reply TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_reply TEXT := btrim(COALESCE(p_reply, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF char_length(v_reply) < 3 OR char_length(v_reply) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Write a reply of 3 to 500 characters');
  END IF;
  IF public.mbg_leadership_resolve(p_motion_id) IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This vote has already closed');
  END IF;

  UPDATE public.mbg_leadership_motions
  SET chair_reply = v_reply
  WHERE id = p_motion_id AND status = 'open' AND accused_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the challenged chairperson can reply');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. PERMISSIONS: only the 7 app-facing RPCs are callable by signed-in users
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mbg_leadership_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_region_name(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_person_name(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_region_scope(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_region_ancestors(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_seat_holder(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_electorate(TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_eligible_successor(TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_ranking(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_notify(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_close(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_resolve(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_leadership_motion_summary(UUID, UUID) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mbg_get_leadership_state(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_my_leadership_seats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_list_leadership_nominees(TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_open_leadership_motion(TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_nominate_leadership_candidate(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_cast_leadership_ballot(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_reply_leadership_motion(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mbg_get_leadership_state(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_my_leadership_seats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_list_leadership_nominees(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_open_leadership_motion(TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_nominate_leadership_candidate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_cast_leadership_ballot(UUID, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_reply_leadership_motion(UUID, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'Leadership vote ready: riders and chairpersons can now revoke a chairperson with more than 50% and the top-recommended successor takes over.' AS status;
