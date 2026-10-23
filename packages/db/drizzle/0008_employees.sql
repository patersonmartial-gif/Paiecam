CREATE TYPE "public"."contract_type" AS ENUM('cdi', 'cdd');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('single', 'married', 'divorced', 'widowed');--> statement-breakpoint
CREATE TYPE "public"."mobile_operator" AS ENUM('orange', 'mtn');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'mobile_money', 'cash');--> statement-breakpoint
CREATE TABLE "employee_bank_details" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"iban_enc" text,
	"iban_last4" text,
	"mobile_operator" "mobile_operator",
	"mobile_number_enc" text,
	"mobile_number_last4" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_bank_details_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "employee_bank_details_mobile_chk" CHECK (("employee_bank_details"."mobile_number_enc" is null) = ("employee_bank_details"."mobile_operator" is null))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matricule" text NOT NULL,
	"last_name" text NOT NULL,
	"first_names" text NOT NULL,
	"birth_date" date NOT NULL,
	"cnps_number_enc" text,
	"cnps_number_index" text,
	"cnps_number_last4" text,
	"hire_date" date NOT NULL,
	"end_date" date,
	"contract_type" "contract_type" NOT NULL,
	"job_title" text NOT NULL,
	"category" text NOT NULL,
	"echelon" text NOT NULL,
	"base_salary" integer NOT NULL,
	"marital_status" "marital_status" NOT NULL,
	"children_count" integer DEFAULT 0 NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_tenant_matricule_key" UNIQUE("tenant_id","matricule"),
	CONSTRAINT "employees_base_salary_chk" CHECK ("employees"."base_salary" >= 0),
	CONSTRAINT "employees_children_chk" CHECK ("employees"."children_count" between 0 and 30),
	CONSTRAINT "employees_dates_chk" CHECK ("employees"."hire_date" > "employees"."birth_date"),
	CONSTRAINT "employees_end_date_chk" CHECK ("employees"."end_date" is null or "employees"."end_date" >= "employees"."hire_date"),
	CONSTRAINT "employees_cnps_consistency_chk" CHECK (("employees"."cnps_number_enc" is null) = ("employees"."cnps_number_index" is null))
);
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_bank_details_tenant_idx" ON "employee_bank_details" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_cnps_key" ON "employees" USING btree ("tenant_id","cnps_number_index") WHERE "employees"."cnps_number_index" is not null;--> statement-breakpoint
CREATE INDEX "employees_tenant_name_idx" ON "employees" USING btree ("tenant_id","last_name");