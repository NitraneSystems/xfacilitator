-- Phase 4: settle_jobs uniqueness + lease claim (FOR UPDATE SKIP LOCKED)

ALTER TABLE settle_jobs
  ADD COLUMN IF NOT EXISTS call_id TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Backfill call_id from existing payload when possible
UPDATE settle_jobs
SET call_id = payload->>'callId'
WHERE call_id IS NULL
  AND payload ? 'callId'
  AND NULLIF(payload->>'callId', '') IS NOT NULL;

-- Drop rows that cannot be backfilled (pre-Phase-4 junk) so NOT NULL + UNIQUE can apply
DELETE FROM settle_jobs WHERE call_id IS NULL;

ALTER TABLE settle_jobs
  ALTER COLUMN call_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS settle_jobs_call_id_uidx ON settle_jobs (call_id);

CREATE OR REPLACE FUNCTION claim_settle_jobs(
  p_limit integer,
  p_worker text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF settle_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RETURN;
  END IF;
  IF p_worker IS NULL OR length(trim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'claim_settle_jobs: p_worker required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM settle_jobs
    WHERE status = 'pending'
       OR (
         status = 'leased'
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at < NOW()
       )
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE settle_jobs j
  SET
    status = 'leased',
    locked_by = p_worker,
    leased_at = NOW(),
    lease_expires_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
    attempts = j.attempts + 1,
    updated_at = NOW(),
    last_error = NULL
  FROM candidates c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION complete_settle_job(p_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE settle_jobs
  SET
    status = 'done',
    lease_expires_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION fail_settle_job(
  p_id uuid,
  p_error text,
  p_max_attempts integer DEFAULT 5,
  p_requeue boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempts integer;
BEGIN
  SELECT attempts INTO v_attempts FROM settle_jobs WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_requeue AND v_attempts < p_max_attempts THEN
    UPDATE settle_jobs
    SET
      status = 'pending',
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = p_error,
      updated_at = NOW()
    WHERE id = p_id;
  ELSE
    UPDATE settle_jobs
    SET
      status = 'failed',
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = p_error,
      updated_at = NOW()
    WHERE id = p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_settle_jobs(integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION complete_settle_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fail_settle_job(uuid, text, integer, boolean) TO service_role;
