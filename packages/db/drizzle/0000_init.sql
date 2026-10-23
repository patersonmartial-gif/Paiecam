CREATE TABLE "pay_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"value" jsonb NOT NULL,
	"legal_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_rules_period_chk" CHECK ("pay_rules"."valid_to" is null or "pay_rules"."valid_to" >= "pay_rules"."valid_from")
);
--> statement-breakpoint
CREATE INDEX "pay_rules_code_valid_from_idx" ON "pay_rules" USING btree ("code","valid_from");