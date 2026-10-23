-- Salariés et coordonnées de paiement : isolés par entreprise. Pas de DELETE : on archive.
GRANT SELECT, INSERT, UPDATE ON employees, employee_bank_details TO paiecam_app;
--> statement-breakpoint
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_bank_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_bank_details FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employees_isolation ON employees
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY employee_bank_details_isolation ON employee_bank_details
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Les coordonnées doivent appartenir au même tenant que le salarié.
ALTER TABLE employees ADD CONSTRAINT employees_tenant_id_id_key UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE employee_bank_details
  ADD CONSTRAINT employee_bank_details_same_tenant_fk
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id);
