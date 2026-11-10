ALTER TABLE "invoices" ADD COLUMN "issuer_name" text NOT NULL;--> statement-breakpoint
-- Vérification publique d'un reçu : seul qui présente le code voit sa ligne.
CREATE FUNCTION app_invoice_code() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.invoice_code', true), '') $$;
--> statement-breakpoint
CREATE POLICY invoices_verification_select ON invoices FOR SELECT
  USING (verification_code = app_invoice_code());
