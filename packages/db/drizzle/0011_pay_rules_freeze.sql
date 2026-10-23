-- Une règle validée est figée : seule sa date de fin peut être posée (pour ouvrir une nouvelle version).
-- Les paies validées gardent un instantané des règles utilisées ; ceci protège en plus le référentiel.
CREATE FUNCTION pay_rules_freeze_validated() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'règle validée % du % : suppression interdite', OLD.code, OLD.valid_from;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'validated' AND (
    NEW.code IS DISTINCT FROM OLD.code OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR
    NEW.value IS DISTINCT FROM OLD.value OR NEW.status IS DISTINCT FROM OLD.status OR
    NEW.validated_by IS DISTINCT FROM OLD.validated_by OR NEW.validated_at IS DISTINCT FROM OLD.validated_at OR
    (OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to)
  ) THEN
    RAISE EXCEPTION 'règle validée % du % : seule la date de fin peut être posée', OLD.code, OLD.valid_from;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pay_rules_freeze BEFORE UPDATE OR DELETE ON pay_rules
  FOR EACH ROW EXECUTE FUNCTION pay_rules_freeze_validated();
