-- Rotation des clés de chiffrement (rôle créé hors migration, voir docker/postgres/init.sql).
-- Exempté du RLS pour parcourir toutes les entreprises, mais limité colonne par colonne : il ne voit
-- que des valeurs chiffrées, des empreintes et des signatures, et ne modifie rien d'autre. Les données
-- associées du chiffrement (entreprise, table, colonne, ligne) l'empêchent de déplacer une valeur.
GRANT USAGE ON SCHEMA public TO paiecam_rotation;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, cnps_number_enc, cnps_number_index) ON employees TO paiecam_rotation;
--> statement-breakpoint
GRANT UPDATE (cnps_number_enc, cnps_number_index) ON employees TO paiecam_rotation;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, employee_id, iban_enc, mobile_number_enc) ON employee_bank_details TO paiecam_rotation;
--> statement-breakpoint
GRANT UPDATE (iban_enc, mobile_number_enc) ON employee_bank_details TO paiecam_rotation;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, storage_key, sha256, issued_at, verification_code, signature) ON documents TO paiecam_rotation;
--> statement-breakpoint
GRANT UPDATE (signature) ON documents TO paiecam_rotation;
--> statement-breakpoint
-- Trace de chaque rotation (événement hors entreprise, sans donnée personnelle).
GRANT INSERT ON audit_log TO paiecam_rotation;
