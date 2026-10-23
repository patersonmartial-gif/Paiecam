CREATE TYPE "public"."rule_status" AS ENUM('draft', 'validated');--> statement-breakpoint
ALTER TABLE "pay_rules" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD COLUMN "status" "rule_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_code_valid_from_key" UNIQUE("code","valid_from");--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_validation_chk" CHECK (("pay_rules"."status" = 'validated') = ("pay_rules"."validated_by" is not null and "pay_rules"."validated_at" is not null));