CREATE TYPE "public"."stock_movement_kind" AS ENUM('reception', 'sale', 'sale_cancelled', 'breakage', 'expired', 'inventory');--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"unit_cost" integer NOT NULL,
	"supplier" text,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" text NOT NULL,
	CONSTRAINT "stock_lots_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_lots_item_lot_expiry_key" UNIQUE("tenant_id","item_id","lot_number","expiry_date"),
	CONSTRAINT "stock_lots_quantity_chk" CHECK ("stock_lots"."quantity_on_hand" >= 0),
	CONSTRAINT "stock_lots_cost_chk" CHECK ("stock_lots"."unit_cost" between 0 and 100000000),
	CONSTRAINT "stock_lots_number_chk" CHECK (char_length("stock_lots"."lot_number") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"invoice_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_chk" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_sign_chk" CHECK (("stock_movements"."kind" in ('reception', 'sale_cancelled') and "stock_movements"."quantity" > 0)
        or ("stock_movements"."kind" in ('sale', 'breakage', 'expired') and "stock_movements"."quantity" < 0)
        or "stock_movements"."kind" = 'inventory'),
	CONSTRAINT "stock_movements_reason_chk" CHECK ("stock_movements"."kind" not in ('breakage', 'expired', 'inventory') or char_length(coalesce("stock_movements"."reason", '')) between 3 and 200)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "expiry_alert_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_lots_item_expiry_idx" ON "stock_lots" USING btree ("tenant_id","item_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_movements_lot_idx" ON "stock_movements" USING btree ("tenant_id","lot_id","created_at");