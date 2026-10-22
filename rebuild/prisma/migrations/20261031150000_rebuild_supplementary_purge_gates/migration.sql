-- OAuthCode is a legacy compatibility table without a workspace FK. Use the
-- same parent lock/check as directly owned tables. Do not add FKs over unaudited
-- historical orphan records. Deletes remain allowed for erasure/account cleanup.
CREATE FUNCTION public.rebuild_reject_purging_legacy_oauth_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  -- No FK exists here to reject a writer resuming after Root removes a workspace.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
      WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public."OAuthCode"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_legacy_oauth_write();

-- Profiles inherit ownership from targets. Parent-first locking matches erasure:
-- resolve the tenant, lock its workspace, then recheck/lock the target. Locking
-- the target first would deadlock against a purge that already owns the workspace.
CREATE FUNCTION public.rebuild_reject_purging_channel_profile_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_workspace TEXT;
BEGIN
  SELECT "workspaceId" INTO owner_workspace FROM public.targets WHERE id = NEW."targetId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Channel unavailable' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = owner_workspace FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.targets
    WHERE id = NEW."targetId" AND "workspaceId" = owner_workspace FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Channel ownership changed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
      WHERE "workspaceId" = owner_workspace AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public.rebuild_channel_profiles
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_channel_profile_write();
