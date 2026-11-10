-- Stock : isolation par entreprise ; la quantité d'un lot ne change que par un mouvement inscrit
-- au registre, et ne passe jamais sous zéro (lot verrouillé : pas de course entre deux ventes).
GRANT SELECT, INSERT ON stock_lots TO paiecam_app;
--> statement-breakpoint
GRANT UPDATE (quantity_on_hand) ON stock_lots TO paiecam_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON stock_movements TO paiecam_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_lots', 'stock_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE stock_lots ADD CONSTRAINT stock_lots_same_tenant_item_fk
  FOREIGN KEY (tenant_id, item_id) REFERENCES catalog_items (tenant_id, id);
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_same_tenant_lot_fk
  FOREIGN KEY (tenant_id, lot_id) REFERENCES stock_lots (tenant_id, id);
--> statement-breakpoint

-- Un lot : médicament seulement, créé vide (la réception est un mouvement), jamais modifié à la main.
CREATE FUNCTION stock_lots_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_on_hand <> 0 THEN
      RAISE EXCEPTION 'un lot est créé vide : la quantité entre par un mouvement de réception';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog_items WHERE id = NEW.item_id AND kind = 'medicine') THEN
      RAISE EXCEPTION 'un lot ne concerne qu''un médicament du catalogue';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'un lot ne se supprime pas';
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'la quantité d''un lot ne change que par un mouvement de stock';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER stock_lots_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION stock_lots_guard();
--> statement-breakpoint

CREATE FUNCTION stock_movements_apply() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  lot stock_lots%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'un mouvement de stock ne se modifie ni ne se supprime';
  END IF;
  SELECT * INTO lot FROM stock_lots WHERE id = NEW.lot_id FOR UPDATE;
  IF lot.quantity_on_hand + NEW.quantity < 0 THEN
    RAISE EXCEPTION 'stock insuffisant pour le lot % (disponible : %)', lot.lot_number, lot.quantity_on_hand;
  END IF;
  -- Une vente ne sort jamais un lot périmé.
  IF NEW.kind = 'sale' AND lot.expiry_date < current_date THEN
    RAISE EXCEPTION 'lot % périmé depuis le % : vente interdite', lot.lot_number, lot.expiry_date;
  END IF;
  UPDATE stock_lots SET quantity_on_hand = quantity_on_hand + NEW.quantity WHERE id = NEW.lot_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_apply BEFORE INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_apply();
