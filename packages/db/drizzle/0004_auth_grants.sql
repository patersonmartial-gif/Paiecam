-- Tables d'authentification : globales (un compte peut appartenir à plusieurs entreprises),
-- donc sans RLS. Seul le serveur y accède, via Better Auth.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, two_factors, rate_limits TO paiecam_app;
