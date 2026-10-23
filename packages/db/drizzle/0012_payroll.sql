CREATE TYPE "public"."language" AS ENUM('fr', 'en');--> statement-breakpoint
CREATE TYPE "public"."pay_item_kind" AS ENUM('earning', 'in_kind', 'non_taxable_allowance', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."payslip_status" AS ENUM('provisional', 'final');--> statement-breakpoint
CREATE TYPE "public"."pay_period_status" AS ENUM('open', 'calculated', 'validated', 'locked');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payslip_id" uuid,
	"kind" text NOT NULL,
	"language" "language" NOT NULL,
	"issuer_name" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"signature" text NOT NULL,
	"verification_code" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "documents_verification_code_unique" UNIQUE("verification_code")
);
--> statement-breakpoint
CREATE TABLE "pay_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"kind" "pay_item_kind" NOT NULL,
	"subject_to_cnps" boolean NOT NULL,
	"taxable" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_items_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "pay_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "pay_items_code_chk" CHECK ("pay_items"."code" ~ '^[a-z0-9_]{1,40}$'),
	CONSTRAINT "pay_items_flags_chk" CHECK ("pay_items"."kind" in ('earning', 'in_kind') or (not "pay_items"."subject_to_cnps" and not "pay_items"."taxable"))
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "pay_period_status" DEFAULT 'open' NOT NULL,
	"calculated_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"validated_by" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_periods_tenant_month_key" UNIQUE("tenant_id","year","month"),
	CONSTRAINT "pay_periods_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "pay_periods_month_chk" CHECK ("pay_periods"."month" between 1 and 12 and "pay_periods"."year" between 2020 and 2100)
);
--> statement-breakpoint
CREATE TABLE "pay_variables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_variables_period_employee_key_key" UNIQUE("period_id","employee_id","key"),
	CONSTRAINT "pay_variables_key_chk" CHECK ("pay_variables"."key" ~ '^(item:[a-z0-9_]{1,40}|hs:[a-z0-9_]{1,20}|absence)$'),
	CONSTRAINT "pay_variables_value_chk" CHECK ("pay_variables"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payslip_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"section" text NOT NULL,
	"base" integer,
	"rate" integer,
	"amount" integer NOT NULL,
	"rule_code" text,
	"explanation" text NOT NULL,
	CONSTRAINT "payslip_lines_position_key" UNIQUE("payslip_id","position")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "payslip_status" NOT NULL,
	"input" jsonb NOT NULL,
	"employee_snapshot" jsonb NOT NULL,
	"rules_used" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"gross" integer NOT NULL,
	"net_pay" integer NOT NULL,
	"employer_cost" integer NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_period_employee_key" UNIQUE("period_id","employee_id"),
	CONSTRAINT "payslips_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payslip_language" "language" DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_variables" ADD CONSTRAINT "pay_variables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_variables" ADD CONSTRAINT "pay_variables_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_variables" ADD CONSTRAINT "pay_variables_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_tenant_payslip_idx" ON "documents" USING btree ("tenant_id","payslip_id");--> statement-breakpoint
CREATE INDEX "payslips_tenant_employee_idx" ON "payslips" USING btree ("tenant_id","employee_id");