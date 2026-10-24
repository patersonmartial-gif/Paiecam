CREATE TYPE "public"."loan_kind" AS ENUM('loan', 'advance');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "loan_kind" NOT NULL,
	"label" text NOT NULL,
	"principal" integer NOT NULL,
	"installment" integer NOT NULL,
	"granted_on" date NOT NULL,
	"start_year" integer NOT NULL,
	"start_month" integer NOT NULL,
	"status" "loan_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "employee_loans_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_loans_label_chk" CHECK (char_length("employee_loans"."label") between 1 and 80),
	CONSTRAINT "employee_loans_principal_chk" CHECK ("employee_loans"."principal" between 1 and 100000000),
	CONSTRAINT "employee_loans_installment_chk" CHECK ("employee_loans"."installment" >= 1 and "employee_loans"."installment" <= "employee_loans"."principal"),
	CONSTRAINT "employee_loans_start_chk" CHECK ("employee_loans"."start_month" between 1 and 12 and "employee_loans"."start_year" between 2020 and 2100),
	CONSTRAINT "employee_loans_cancel_chk" CHECK (("employee_loans"."status" = 'cancelled') = ("employee_loans"."cancelled_at" is not null and "employee_loans"."cancelled_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "loan_repayments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_repayments_loan_period_key" UNIQUE("loan_id","period_id"),
	CONSTRAINT "loan_repayments_amount_chk" CHECK ("loan_repayments"."amount" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pay_variables" DROP CONSTRAINT "pay_variables_key_chk";--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_loans_tenant_employee_idx" ON "employee_loans" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "loan_repayments_tenant_loan_idx" ON "loan_repayments" USING btree ("tenant_id","loan_id");--> statement-breakpoint
ALTER TABLE "pay_variables" ADD CONSTRAINT "pay_variables_key_chk" CHECK ("pay_variables"."key" ~ '^(item:[a-z0-9_]{1,40}|hs:[a-z0-9_]{1,20}|absence|loan_skip:[0-9a-f-]{36})$');