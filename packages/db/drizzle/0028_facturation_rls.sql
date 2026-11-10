-- Facturation : isolation par entreprise, numérotation continue sans trou, factures immuables.
GRANT SELECT, INSERT, UPDATE ON invoice_counters TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON invoices TO paiecam_app;
--> statement-breakpoint
-- Seule l'annulation (par un avoir) modifie une facture, et seulement ces colonnes.
GRANT UPDATE (status, cancelled_at, cancelled_by, cancel_reason) ON invoices TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON invoice_lines TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_counters', 'invoices', 'invoice_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_same_tenant_credited_fk
  FOREIGN KEY (tenant_id, credited_invoice_id) REFERENCES invoices (tenant_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX invoices_one_credit_note ON invoices (credited_invoice_id) WHERE credited_invoice_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_same_tenant_invoice_fk
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id);
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_same_tenant_item_fk
  FOREIGN KEY (tenant_id, item_id) REFERENCES catalog_items (tenant_id, id);
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_same_tenant_invoice_fk
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id);
--> statement-breakpoint

-- Numéro attribué par le compteur dans la même transaction : continu, sans trou ni doublon
-- (une transaction annulée annule aussi l'incrément du compteur).
CREATE FUNCTION invoices_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  last integer;
  credited invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'une facture ne se supprime pas (l''annuler par un avoir)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT last_number INTO last FROM invoice_counters
     WHERE tenant_id = NEW.tenant_id AND series = NEW.series AND year = NEW.year;
    IF last IS DISTINCT FROM NEW.number THEN
      RAISE EXCEPTION 'numéro de facture hors séquence (compteur : %, numéro : %)', last, NEW.number;
    END IF;
    IF NEW.status <> 'issued' THEN
      RAISE EXCEPTION 'une facture est émise avant d''être annulée';
    END IF;
    IF NEW.kind = 'credit_note' THEN
      SELECT * INTO credited FROM invoices WHERE id = NEW.credited_invoice_id;
      IF credited.kind IS DISTINCT FROM 'invoice' OR credited.status <> 'issued' THEN
        RAISE EXCEPTION 'un avoir annule une facture émise et non encore annulée';
      END IF;
      IF NEW.total_ttc <> -credited.total_ttc THEN
        RAISE EXCEPTION 'un avoir annule la facture entière (% attendu)', -credited.total_ttc;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Mise à jour : uniquement l'annulation d'une facture émise.
  IF OLD.status <> 'issued' OR NEW.status <> 'cancelled' OR OLD.kind <> 'invoice' THEN
    RAISE EXCEPTION 'une facture émise ne change pas (seule l''annulation par un avoir est possible)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE credited_invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'annulation sans avoir';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint

-- Lignes : ajoutées seulement dans la transaction qui crée la facture.
CREATE FUNCTION invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'une ligne de facture ne se modifie ni ne se supprime';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'une facture émise ne reçoit plus de ligne';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
--> statement-breakpoint

-- À la validation de la transaction : au moins une ligne, et total des lignes = total facturé.
CREATE FUNCTION invoices_check_lines() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  n integer;
  total bigint;
BEGIN
  SELECT count(*), coalesce(sum(total_ttc), 0) INTO n, total FROM invoice_lines WHERE invoice_id = NEW.id;
  IF n = 0 THEN
    RAISE EXCEPTION 'facture sans ligne';
  END IF;
  IF total <> NEW.total_ttc THEN
    RAISE EXCEPTION 'total des lignes (%) différent du total facturé (%)', total, NEW.total_ttc;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoices_check_lines AFTER INSERT ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoices_check_lines();
