-- File de tâches de fond (pg-boss) : schéma dédié où le rôle applicatif crée ses propres tables.
-- Les tâches ne transportent que des identifiants ; les données de paie restent sous RLS.
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO paiecam_app;
