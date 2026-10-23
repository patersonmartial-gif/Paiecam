-- Rôle de supervision (créé hors migration, voir docker/postgres/init.sql).
-- Il lit les événements hors entreprise (connexions, échecs 2FA…) pour les alertes de sécurité,
-- et jamais le journal d'une entreprise.
GRANT USAGE ON SCHEMA public TO paiecam_ops;
--> statement-breakpoint
GRANT SELECT ON audit_log TO paiecam_ops;
--> statement-breakpoint
CREATE POLICY audit_log_platform_select ON audit_log FOR SELECT TO paiecam_ops
  USING (tenant_id IS NULL);
