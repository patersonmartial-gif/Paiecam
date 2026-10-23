-- Isolation multi-tenant par Row-Level Security.
-- Rôles créés hors migration (docker/postgres/init.sql) : paiecam_owner applique les migrations,
-- paiecam_app est le seul rôle utilisé par l'application et ne contourne jamais le RLS.

-- Contexte de la transaction, fixé par withTenant() / withUser() via set_config(..., true).
-- nullif : après une transaction, un paramètre local déjà utilisé vaut '' et non NULL.
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_user() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

-- Droits du rôle applicatif : le strict nécessaire, rien par défaut.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO paiecam_app;
--> statement-breakpoint
GRANT SELECT ON pay_rules TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON tenants TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO paiecam_app;
--> statement-breakpoint
-- Journal d'audit en insertion seule.
GRANT SELECT, INSERT ON audit_log TO paiecam_app;
--> statement-breakpoint

-- FORCE : le RLS s'applique aussi au propriétaire des tables (dont les fonctions SECURITY DEFINER).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenants_isolation ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());
--> statement-breakpoint

-- Lecture : les lignes du tenant courant, plus les appartenances de l'utilisateur courant
-- (nécessaire pour lister ses entreprises à la connexion, avant d'en choisir une).
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());
--> statement-breakpoint

-- Création d'une entreprise et de son Propriétaire, en une transaction.
-- Le contexte est fixé sur le nouveau tenant : les politiques RLS s'appliquent normalement,
-- et l'appelant peut poursuivre dans ce tenant jusqu'à la fin de sa transaction.
CREATE FUNCTION create_tenant_with_owner(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_user_id text,
  p_legal_name text,
  p_niu text,
  p_cnps_employer_number text,
  p_regime regime,
  p_work_accident_rate integer,
  p_commune text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'utilisateur requis';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  INSERT INTO tenants (id, legal_name, niu, cnps_employer_number, regime, work_accident_rate, commune)
    VALUES (p_tenant_id, p_legal_name, p_niu, p_cnps_employer_number, p_regime, p_work_accident_rate, p_commune);
  INSERT INTO memberships (id, tenant_id, user_id, role)
    VALUES (p_membership_id, p_tenant_id, p_user_id, 'owner');
  RETURN p_tenant_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION create_tenant_with_owner FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION create_tenant_with_owner TO paiecam_app;
