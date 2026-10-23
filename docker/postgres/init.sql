-- Exécuté une seule fois par un administrateur PostgreSQL (en dev : automatiquement par Docker).
-- Mots de passe de DÉVELOPPEMENT uniquement. En prod, les rôles sont créés par l'exploitant
-- avec des secrets issus du gestionnaire de secrets.

-- Propriétaire du schéma : applique les migrations, jamais utilisé par l'application.
CREATE ROLE paiecam_owner LOGIN PASSWORD 'owner_dev';

-- Rôle de l'application : soumis au RLS, propriétaire d'aucune table.
CREATE ROLE paiecam_app LOGIN PASSWORD 'app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Supervision de la plateforme : lit uniquement les événements hors entreprise (connexions…).
CREATE ROLE paiecam_ops LOGIN PASSWORD 'ops_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Sauvegardes : lecture seule de toutes les données, exemptée du RLS (pg_dump doit tout voir).
-- Ses identifiants ne servent qu'au script de sauvegarde, jamais à l'application.
CREATE ROLE paiecam_backup LOGIN PASSWORD 'backup_dev' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT pg_read_all_data TO paiecam_backup;

-- Rotation des clés de chiffrement : droits limités aux colonnes chiffrées (migration 0020).
-- Utilisé uniquement pendant une rotation ; mot de passe à changer ensuite.
CREATE ROLE paiecam_rotation LOGIN PASSWORD 'rotation_dev' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE paiecam OWNER paiecam_owner;
CREATE DATABASE paiecam_test OWNER paiecam_owner;
-- Cible du test de restauration (recréée à chaque test par l'administrateur).
CREATE DATABASE paiecam_restore_test OWNER paiecam_owner;
