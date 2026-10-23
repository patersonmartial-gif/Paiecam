-- Déclarations et rappels : isolation, cohérence des tenants, cycle de vie imposé par la base.
GRANT SELECT, INSERT, UPDATE ON declarations TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON reminder_deliveries TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['declarations', 'reminder_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE declarations ADD CONSTRAINT declarations_same_tenant_period_fk
  FOREIGN KEY (tenant_id, period_id) REFERENCES pay_periods (tenant_id, id);
--> statement-breakpoint
ALTER TABLE declarations ADD CONSTRAINT declarations_same_tenant_document_fk
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id);
--> statement-breakpoint
ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_same_tenant_fk
  FOREIGN KEY (tenant_id, declaration_id) REFERENCES declarations (tenant_id, id);
--> statement-breakpoint

-- Cycle de vie : generated → filed → paid ; une déclaration déposée est figée.
-- Création et régénération : uniquement sur un mois validé (pas encore verrouillé).
CREATE FUNCTION declarations_lifecycle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE st pay_period_status;
BEGIN
  SELECT status INTO st FROM pay_periods WHERE id = NEW.period_id;
  IF TG_OP = 'INSERT' THEN
    IF st <> 'validated' THEN RAISE EXCEPTION 'déclarations : le mois doit être validé (état %)', st; END IF;
    IF NEW.status <> 'generated' THEN RAISE EXCEPTION 'une déclaration naît « générée »'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.period_id <> OLD.period_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'déclaration : entreprise, mois et type sont immuables';
  END IF;
  IF OLD.status = 'generated' AND NEW.status = 'generated' THEN
    IF st <> 'validated' THEN RAISE EXCEPTION 'régénération impossible : mois %', st; END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'generated' AND NEW.status = 'filed') OR (OLD.status = 'filed' AND NEW.status = 'paid')
          OR (OLD.status = NEW.status AND OLD.status = 'paid' AND ROW(NEW.*) IS NOT DISTINCT FROM ROW(OLD.*))) THEN
    RAISE EXCEPTION 'transition interdite : % → %', OLD.status, NEW.status;
  END IF;
  IF NEW.amount_due <> OLD.amount_due OR NEW.document_id <> OLD.document_id OR NEW.due_date <> OLD.due_date THEN
    RAISE EXCEPTION 'déclaration déposée : montant, fichier et échéance sont figés';
  END IF;
  IF OLD.status = 'filed' AND (NEW.filed_at IS DISTINCT FROM OLD.filed_at OR NEW.filing_reference IS DISTINCT FROM OLD.filing_reference) THEN
    RAISE EXCEPTION 'déclaration déposée : date et référence de dépôt sont figées';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER declarations_lifecycle BEFORE INSERT OR UPDATE ON declarations
  FOR EACH ROW EXECUTE FUNCTION declarations_lifecycle();
--> statement-breakpoint

-- Verrouillage du mois : uniquement quand ses trois déclarations existent et sont déposées.
CREATE OR REPLACE FUNCTION pay_periods_transition() RETURNS trigger
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
  IF NEW.status = 'locked' AND (
    (SELECT count(*) FROM declarations WHERE period_id = NEW.id AND status IN ('filed', 'paid')) < 3
  ) THEN
    RAISE EXCEPTION 'verrouillage impossible : déclarations non déposées';
  END IF;
  RETURN NEW;
END
$$;
