-- Catalogue et prix : isolation par entreprise ; un prix fixé n'est jamais modifié (historique).
GRANT SELECT, INSERT, UPDATE ON catalog_items TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON catalog_prices TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_items', 'catalog_prices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE catalog_prices ADD CONSTRAINT catalog_prices_same_tenant_item_fk
  FOREIGN KEY (tenant_id, item_id) REFERENCES catalog_items (tenant_id, id);
--> statement-breakpoint
-- Un article ne change ni d'entreprise ni de nature (prestation / médicament) ; il se désactive.
CREATE FUNCTION catalog_items_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'un article du catalogue ne se supprime pas (le désactiver)';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'article : entreprise, nature et code sont immuables';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER catalog_items_guard BEFORE UPDATE OR DELETE ON catalog_items
  FOR EACH ROW EXECUTE FUNCTION catalog_items_guard();
