CREATE TYPE "public"."declaration_kind" AS ENUM('cnps', 'dgi', 'dipe');--> statement-breakpoint
CREATE TYPE "public"."declaration_status" AS ENUM('generated', 'filed', 'paid');--> statement-breakpoint
CREATE TABLE "declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" "declaration_kind" NOT NULL,
	"amount_due" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" "declaration_status" DEFAULT 'generated' NOT NULL,
	"document_id" uuid NOT NULL,
	"filed_at" date,
	"filing_reference" text,
	"paid_at" date,
	"payment_reference" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declarations_period_kind_key" UNIQUE("period_id","kind"),
	CONSTRAINT "declarations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "declarations_amount_chk" CHECK ("declarations"."amount_due" >= 0),
	CONSTRAINT "declarations_filed_chk" CHECK ("declarations"."status" = 'generated' or ("declarations"."filed_at" is not null and "declarations"."filing_reference" is not null)),
	CONSTRAINT "declarations_paid_chk" CHECK ("declarations"."status" <> 'paid' or "declarations"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "reminder_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"channel" text NOT NULL,
	"recipients" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_deliveries_once_key" UNIQUE("declaration_id","stage","channel"),
	CONSTRAINT "reminder_deliveries_stage_chk" CHECK ("reminder_deliveries"."stage" in ('j-7', 'j-2', 'j0', 'late'))
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "declarations_tenant_due_idx" ON "declarations" USING btree ("tenant_id","due_date");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_id_key" UNIQUE("tenant_id","id");