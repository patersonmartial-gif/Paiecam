CREATE TABLE "cash_closings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"expected" jsonb NOT NULL,
	"counted_cash" integer NOT NULL,
	"difference" integer NOT NULL,
	"invoice_count" integer NOT NULL,
	"note" text,
	"closed_by" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_closings_tenant_day_key" UNIQUE("tenant_id","day"),
	CONSTRAINT "cash_closings_counted_chk" CHECK ("cash_closings"."counted_cash" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT ON cash_closings TO paiecam_app;
--> statement-breakpoint
ALTER TABLE cash_closings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_closings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cash_closings_isolation ON cash_closings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
