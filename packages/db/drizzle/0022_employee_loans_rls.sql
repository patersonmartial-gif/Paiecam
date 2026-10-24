-- Prêts et avances : isolation par entreprise, cohérence des tenants, cycle de vie imposé par la base.
GRANT SELECT, INSERT, UPDATE ON employee_loans TO paiecam_app;
--> statement-breakpoint
-- Un remboursement enregistré ne se modifie ni ne se supprime.
GRANT SELECT, INSERT ON loan_repayments TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_loans', 'loan_repayments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE employee_loans ADD CONSTRAINT employee_loans_same_tenant_employee_fk
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id);
--> statement-breakpoint
ALTER TABLE loan_repayments ADD CONSTRAINT loan_repayments_same_tenant_loan_fk
  FOREIGN KEY (tenant_id, loan_id) REFERENCES employee_loans (tenant_id, id);
--> statement-breakpoint
ALTER TABLE loan_repayments ADD CONSTRAINT loan_repayments_same_tenant_period_fk
  FOREIGN KEY (tenant_id, period_id) REFERENCES pay_periods (tenant_id, id);
--> statement-breakpoint

-- Seules la mensualité (prêt en cours) et le statut évoluent ; active → settled | cancelled, sans retour.
CREATE FUNCTION employee_loans_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE repaid integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'un prêt ne se supprime pas (l''annuler)';
  END IF;
  IF (NEW.tenant_id, NEW.employee_id, NEW.kind, NEW.label, NEW.principal, NEW.granted_on,
      NEW.start_year, NEW.start_month, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.employee_id, OLD.kind, OLD.label, OLD.principal, OLD.granted_on,
      OLD.start_year, OLD.start_month, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'prêt : seuls la mensualité et le statut peuvent changer';
  END IF;
  IF OLD.status <> 'active' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'prêt % : figé', OLD.status;
  END IF;
  IF NEW.status = 'settled' AND OLD.status = 'active' THEN
    SELECT coalesce(sum(amount), 0) INTO repaid FROM loan_repayments WHERE loan_id = NEW.id;
    IF repaid <> NEW.principal THEN
      RAISE EXCEPTION 'prêt non soldé : % remboursés sur %', repaid, NEW.principal;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER employee_loans_guard BEFORE UPDATE OR DELETE ON employee_loans
  FOR EACH ROW EXECUTE FUNCTION employee_loans_guard();
--> statement-breakpoint

-- Un remboursement : mois validé, prêt en cours, jamais plus que le reste dû ; le prêt est soldé
-- automatiquement au dernier franc. Le prêt est verrouillé pendant le contrôle (pas de course).
CREATE FUNCTION loan_repayments_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  loan employee_loans%ROWTYPE;
  st pay_period_status;
  repaid integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'un remboursement ne se modifie ni ne se supprime';
  END IF;
  SELECT * INTO loan FROM employee_loans WHERE id = NEW.loan_id FOR UPDATE;
  IF loan.status <> 'active' THEN
    RAISE EXCEPTION 'prêt % : aucun remboursement possible', loan.status;
  END IF;
  SELECT status INTO st FROM pay_periods WHERE id = NEW.period_id;
  IF st IS DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION 'remboursement hors d''une paie validée (période %)', st;
  END IF;
  SELECT coalesce(sum(amount), 0) INTO repaid FROM loan_repayments WHERE loan_id = NEW.loan_id;
  IF repaid + NEW.amount > loan.principal THEN
    RAISE EXCEPTION 'remboursement supérieur au reste dû (% FCFA)', loan.principal - repaid;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER loan_repayments_guard BEFORE INSERT OR UPDATE OR DELETE ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION loan_repayments_guard();
--> statement-breakpoint
CREATE FUNCTION loan_repayments_settle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE employee_loans SET status = 'settled'
   WHERE id = NEW.loan_id AND status = 'active'
     AND principal = (SELECT sum(amount) FROM loan_repayments WHERE loan_id = NEW.loan_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER loan_repayments_settle AFTER INSERT ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION loan_repayments_settle();
