-- migration-safe: Instagram auto-reply. Additive only: three new tables with their own foreign keys and indexes (all created in this migration, so plain CREATE INDEX is safe); no existing table is altered.
CREATE TABLE "instagram_auto_reply_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"credential_id" text,
	"ig_account_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger_type" text DEFAULT 'comment' NOT NULL,
	"media_scope" text NOT NULL,
	"media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_media_armed_at" timestamp with time zone,
	"next_media_id" text,
	"keyword_mode" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_reply_enabled" boolean DEFAULT true NOT NULL,
	"public_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dm_enabled" boolean DEFAULT true NOT NULL,
	"dm_message" jsonb NOT NULL,
	"opening_dm" jsonb,
	"follow_gate" jsonb,
	"handoff_to_agent" boolean DEFAULT false NOT NULL,
	"once_per_user_per_post" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_auto_reply_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"rule_id" text,
	"ig_account_id" text NOT NULL,
	"source_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"media_id" text,
	"from_id" text,
	"from_username" text,
	"text" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"public_reply_id" text,
	"dm_sent" boolean DEFAULT false NOT NULL,
	"dm_stage" text,
	"dm_snapshot" jsonb,
	"error" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_auto_reply_click" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"rule_id" text,
	"button_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_rule" ADD CONSTRAINT "instagram_auto_reply_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_rule" ADD CONSTRAINT "instagram_auto_reply_rule_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_rule" ADD CONSTRAINT "instagram_auto_reply_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_event" ADD CONSTRAINT "instagram_auto_reply_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_event" ADD CONSTRAINT "instagram_auto_reply_event_rule_id_instagram_auto_reply_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."instagram_auto_reply_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_click" ADD CONSTRAINT "instagram_auto_reply_click_event_id_instagram_auto_reply_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."instagram_auto_reply_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_auto_reply_click" ADD CONSTRAINT "instagram_auto_reply_click_rule_id_instagram_auto_reply_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."instagram_auto_reply_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_rule_workspace_idx" ON "instagram_auto_reply_rule" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_rule_account_status_idx" ON "instagram_auto_reply_rule" USING btree ("ig_account_id","status");--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_rule_credential_idx" ON "instagram_auto_reply_rule" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_auto_reply_event_account_source_unique" ON "instagram_auto_reply_event" USING btree ("ig_account_id","source_id");--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_event_rule_media_from_idx" ON "instagram_auto_reply_event" USING btree ("rule_id","media_id","from_id");--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_event_workspace_created_idx" ON "instagram_auto_reply_event" USING btree ("workspace_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_event_from_idx" ON "instagram_auto_reply_event" USING btree ("from_id","ig_account_id","trigger_type","created_at" DESC);--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_click_event_idx" ON "instagram_auto_reply_click" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "instagram_auto_reply_click_rule_idx" ON "instagram_auto_reply_click" USING btree ("rule_id");
