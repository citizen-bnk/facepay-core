CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"justification" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"tenant_id" text,
	"object_ref" text NOT NULL,
	"before_hash" text,
	"after_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "biometric_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"modality" text NOT NULL,
	"legal_basis" text DEFAULT 'explicit_consent' NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"model" text NOT NULL,
	"serial" text NOT NULL,
	"certificate_ref" text NOT NULL,
	"firmware" text NOT NULL,
	"health" text DEFAULT 'healthy' NOT NULL,
	"connection" text DEFAULT 'online' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"visibility" text DEFAULT 'catalog' NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"status" text DEFAULT 'healthy' NOT NULL,
	"error_rate_bp" integer DEFAULT 0 NOT NULL,
	"key_rotated_at" timestamp with time zone,
	"last_event_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"version" text NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "metrics_key_scope_pk" PRIMARY KEY("key","scope")
);
--> statement-breakpoint
CREATE TABLE "payment_instruments" (
	"token_ref" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"type" text NOT NULL,
	"masked_display" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"holder_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text,
	"payer_id" text,
	"channel" text DEFAULT 'face' NOT NULL,
	"created_by" text,
	"provider_ref" text,
	"provider_confirmed" boolean DEFAULT false NOT NULL,
	"decline_code" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"holder_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"available_balance_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ZAR' NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"maker_id" text NOT NULL,
	"checker_id" text,
	"decision_note" text,
	"provider_ref" text,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlement_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"provider" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"gross_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ZAR' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"payout_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"provider_ref" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"legal_entity_ref" text,
	"onboarding_state" text DEFAULT 'active' NOT NULL,
	"settlement_provider_ref" text,
	"policy_id" text,
	"category" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"customer_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"channel" text NOT NULL,
	"provider_ref" text,
	"result_code" text,
	"settlement_batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"contact_ref" text,
	"verification_state" text DEFAULT 'verified' NOT NULL,
	"consent_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"modality" text NOT NULL,
	"subject_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"tenant_id" text NOT NULL,
	"payment_intent_id" text,
	"challenge_ref" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"failure_code" text,
	"vendor_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_merchant_id_tenants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instruments" ADD CONSTRAINT "payment_instruments_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_tenants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_merchant_id_tenants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_batch_id_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_tenants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_merchant_idem" ON "payment_intents" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_intents_merchant_idx" ON "payment_intents" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_customer_idx" ON "transactions" USING btree ("customer_id","created_at");