-- Exécuté une seule fois par un administrateur PostgreSQL (en dev : automatiquement par Docker).
-- Mots de passe de DÉVELOPPEMENT uniquement. En prod, les rôles sont créés par l'exploitant
-- avec des secrets issus du gestionnaire de secrets.

-- Propriétaire du schéma : applique les migrations, jamais utilisé par l'application.
CREATE ROLE paiecam_owner LOGIN PASSWORD 'owner_dev';

-- Rôle de l'application : soumis au RLS, propriétaire d'aucune table.
CREATE ROLE paiecam_app LOGIN PASSWORD 'app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE paiecam OWNER paiecam_owner;
CREATE DATABASE paiecam_test OWNER paiecam_owner;
