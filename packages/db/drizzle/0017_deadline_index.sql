-- Index des échéances pour la tâche quotidienne de rappels, qui parcourt toutes les entreprises.
-- EXCEPTION DOCUMENTÉE AU RLS : cette table ne contient que des identifiants, une date et un état
-- (aucune donnée de paie ni de personne). La tâche relit chaque déclaration DANS le contexte RLS
-- de son entreprise avant d'envoyer quoi que ce soit ; une ligne forgée ne donne donc accès à rien.
CREATE TABLE declaration_deadlines (
  declaration_id uuid PRIMARY KEY REFERENCES declarations (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  due_date date NOT NULL,
  status declaration_status NOT NULL
);
--> statement-breakpoint
CREATE INDEX declaration_deadlines_due_idx ON declaration_deadlines (status, due_date);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON declaration_deadlines TO paiecam_app;
--> statement-breakpoint
CREATE FUNCTION declarations_sync_deadline() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO declaration_deadlines (declaration_id, tenant_id, due_date, status)
    VALUES (NEW.id, NEW.tenant_id, NEW.due_date, NEW.status)
    ON CONFLICT (declaration_id) DO UPDATE SET due_date = EXCLUDED.due_date, status = EXCLUDED.status;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER declarations_sync_deadline AFTER INSERT OR UPDATE ON declarations
  FOR EACH ROW EXECUTE FUNCTION declarations_sync_deadline();
