-- Invitations : isolées par entreprise, plus un accès ciblé par jeton pour l'acceptation.
CREATE FUNCTION app_invitation_token_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.invitation_token_hash', true), '') $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invitations TO paiecam_app;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_select ON invitations FOR SELECT
  USING (tenant_id = app_current_tenant() OR token_hash = app_invitation_token_hash());
--> statement-breakpoint
CREATE POLICY invitations_insert ON invitations FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY invitations_update ON invitations FOR UPDATE
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- La lecture d'une entreprise par jeton d'invitation (pour afficher « Rejoindre X ») passe aussi par le jeton.
CREATE POLICY tenants_invitation_select ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM invitations WHERE token_hash = app_invitation_token_hash()));
