CREATE TYPE "public"."catalog_kind" AS ENUM('service', 'medicine');--> statement-breakpoint
CREATE TYPE "public"."tax_category" AS ENUM('standard', 'exempt');--> statement-breakpoint
ALTER TYPE "public"."invite_role" ADD VALUE 'cashier';--> statement-breakpoint
ALTER TYPE "public"."invite_role" ADD VALUE 'stock_manager';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'cashier';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'stock_manager';--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "catalog_kind" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"form" text,
	"dosage" text,
	"unit" text,
	"tax_category" "tax_category" NOT NULL,
	"alert_threshold" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "catalog_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "catalog_items_code_chk" CHECK ("catalog_items"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
	CONSTRAINT "catalog_items_name_chk" CHECK (char_length("catalog_items"."name") between 1 and 120),
	CONSTRAINT "catalog_items_threshold_chk" CHECK ("catalog_items"."alert_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price_ttc" integer NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by" text NOT NULL,
	CONSTRAINT "catalog_prices_amount_chk" CHECK ("catalog_prices"."price_ttc" between 0 and 100000000)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_prices" ADD CONSTRAINT "catalog_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_prices" ADD CONSTRAINT "catalog_prices_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_prices_item_idx" ON "catalog_prices" USING btree ("tenant_id","item_id","valid_from");