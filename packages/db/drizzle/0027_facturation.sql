CREATE TYPE "public"."invoice_kind" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_mean" AS ENUM('cash', 'orange_money', 'mtn_momo');--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"tenant_id" uuid NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_counters_tenant_id_series_year_pk" PRIMARY KEY("tenant_id","series","year"),
	CONSTRAINT "invoice_counters_series_chk" CHECK ("invoice_counters"."series" in ('F', 'A'))
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "catalog_kind" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_ttc" integer NOT NULL,
	"tax_category" "tax_category" NOT NULL,
	"total_ttc" integer NOT NULL,
	"lots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "invoice_lines_invoice_position_key" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_lines_total_chk" CHECK ("invoice_lines"."total_ttc" = "invoice_lines"."quantity" * "invoice_lines"."unit_price_ttc"),
	CONSTRAINT "invoice_lines_quantity_chk" CHECK ("invoice_lines"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"credited_invoice_id" uuid,
	"patient_name_enc" text,
	"payment_mean" "payment_mean" NOT NULL,
	"payment_reference" text,
	"total_ht" integer NOT NULL,
	"total_tax" integer NOT NULL,
	"total_ttc" integer NOT NULL,
	"taxes" jsonb NOT NULL,
	"rule_used" jsonb NOT NULL,
	"verification_code" text NOT NULL,
	"signature" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	CONSTRAINT "invoices_verification_code_unique" UNIQUE("verification_code"),
	CONSTRAINT "invoices_tenant_number_key" UNIQUE("tenant_id","series","year","number"),
	CONSTRAINT "invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_kind_series_chk" CHECK (("invoices"."kind" = 'invoice' and "invoices"."series" = 'F' and "invoices"."credited_invoice_id" is null)
        or ("invoices"."kind" = 'credit_note' and "invoices"."series" = 'A' and "invoices"."credited_invoice_id" is not null)),
	CONSTRAINT "invoices_totals_chk" CHECK ("invoices"."total_ht" + "invoices"."total_tax" = "invoices"."total_ttc"
        and (("invoices"."kind" = 'invoice' and "invoices"."total_ttc" >= 0) or ("invoices"."kind" = 'credit_note' and "invoices"."total_ttc" <= 0))),
	CONSTRAINT "invoices_cancel_chk" CHECK (("invoices"."status" = 'cancelled') = ("invoices"."cancelled_at" is not null and "invoices"."cancelled_by" is not null and "invoices"."cancel_reason" is not null)),
	CONSTRAINT "invoices_reference_chk" CHECK ("invoices"."payment_mean" = 'cash' or char_length(coalesce("invoices"."payment_reference", '')) between 4 and 40)
);
--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_issued_idx" ON "invoices" USING btree ("tenant_id","issued_at");