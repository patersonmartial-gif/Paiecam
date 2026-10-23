-- Cycle de paie : isolation par entreprise, cohérence des tenants, et états imposés par la base.
GRANT SELECT, INSERT, UPDATE ON pay_items, pay_periods TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pay_variables, payslips, payslip_lines TO paiecam_app;
--> statement-breakpoint
-- Un PDF émis n'est jamais modifié ni supprimé par l'application.
GRANT SELECT, INSERT ON documents TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pay_items', 'pay_periods', 'pay_variables', 'payslips', 'payslip_lines', 'documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Vérification publique d'un PDF : seul qui présente le code voit sa ligne.
CREATE FUNCTION app_document_code() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.document_code', true), '') $$;
--> statement-breakpoint
CREATE POLICY documents_verification_select ON documents FOR SELECT
  USING (verification_code = app_document_code());
--> statement-breakpoint
-- Les lignes liées appartiennent au même tenant que leur parent.
ALTER TABLE pay_variables ADD CONSTRAINT pay_variables_same_tenant_period_fk
  FOREIGN KEY (tenant_id, period_id) REFERENCES pay_periods (tenant_id, id);
--> statement-breakpoint
ALTER TABLE pay_variables ADD CONSTRAINT pay_variables_same_tenant_employee_fk
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id);
--> statement-breakpoint
ALTER TABLE payslips ADD CONSTRAINT payslips_same_tenant_period_fk
  FOREIGN KEY (tenant_id, period_id) REFERENCES pay_periods (tenant_id, id);
--> statement-breakpoint
ALTER TABLE payslips ADD CONSTRAINT payslips_same_tenant_employee_fk
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id);
--> statement-breakpoint
ALTER TABLE payslip_lines ADD CONSTRAINT payslip_lines_same_tenant_fk
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payslips (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_same_tenant_payslip_fk
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payslips (tenant_id, id);
--> statement-breakpoint

-- Transitions autorisées : open ⇄ calculated → validated → locked. Rien ne revient après validation.
CREATE FUNCTION pay_periods_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.year <> OLD.year OR NEW.month <> OLD.month THEN
    RAISE EXCEPTION 'période : entreprise, année et mois sont immuables';
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('validated', 'locked') AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
      RAISE EXCEPTION 'période % : figée', OLD.status;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'open' AND NEW.status = 'calculated') OR
    (OLD.status = 'calculated' AND NEW.status IN ('open', 'validated')) OR
    (OLD.status = 'validated' AND NEW.status = 'locked')
  ) THEN
    RAISE EXCEPTION 'transition interdite : % → %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'validated' AND (NEW.validated_by IS NULL OR NEW.validated_at IS NULL) THEN
    RAISE EXCEPTION 'validation sans auteur ni date';
  END IF;
  IF NEW.status = 'validated' AND EXISTS (
    SELECT 1 FROM payslips WHERE period_id = NEW.id AND status <> 'final'
  ) THEN
    RAISE EXCEPTION 'validation impossible : bulletins provisoires';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pay_periods_transition BEFORE UPDATE ON pay_periods
  FOR EACH ROW EXECUTE FUNCTION pay_periods_transition();
--> statement-breakpoint
CREATE FUNCTION pay_periods_no_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'une période de paie ne se supprime pas'; END $$;
--> statement-breakpoint
CREATE TRIGGER pay_periods_no_delete BEFORE DELETE ON pay_periods
  FOR EACH ROW EXECUTE FUNCTION pay_periods_no_delete();
--> statement-breakpoint

-- Variables : modifiables seulement quand la période est ouverte.
-- Bulletins et lignes : seulement tant que la période n'est pas validée.
CREATE FUNCTION payroll_guard_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  st pay_period_status;
  pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'payslip_lines' THEN
    SELECT p.period_id INTO pid FROM payslips p WHERE p.id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  ELSE
    pid := COALESCE(NEW.period_id, OLD.period_id);
  END IF;
  SELECT status INTO st FROM pay_periods WHERE id = pid;
  IF TG_TABLE_NAME = 'pay_variables' AND st <> 'open' THEN
    RAISE EXCEPTION 'variables figées : période %', st;
  END IF;
  IF TG_TABLE_NAME IN ('payslips', 'payslip_lines') AND st IN ('validated', 'locked') THEN
    RAISE EXCEPTION 'bulletins figés : période %', st;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER pay_variables_guard BEFORE INSERT OR UPDATE OR DELETE ON pay_variables
  FOR EACH ROW EXECUTE FUNCTION payroll_guard_period();
--> statement-breakpoint
CREATE TRIGGER payslips_guard BEFORE INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payroll_guard_period();
--> statement-breakpoint
CREATE TRIGGER payslip_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON payslip_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_guard_period();
