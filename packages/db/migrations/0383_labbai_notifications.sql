-- migration-safe: Labbai notifications. Additive only: three new enums and three new tables, plus a nullable column (no default, no rewrite) on inbox_conversation for temporary AI pauses.
CREATE TYPE "public"."notification_trigger_direction" AS ENUM('inbound', 'outbound', 'event');--> statement-breakpoint
CREATE TYPE "public"."notification_pause_mode" AS ENUM('none', 'temporary', 'hard');--> statement-breakpoint
CREATE TYPE "public"."notification_event_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD COLUMN "ai_paused_until" timestamp;--> statement-breakpoint
CREATE TABLE "notification_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text,
	"title" text DEFAULT '' NOT NULL,
	"chat_id" text,
	"connect_token" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text,
	"name" text NOT NULL,
	"direction" "notification_trigger_direction" DEFAULT 'inbound' NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"event_key" text,
	"extract_spec" text DEFAULT '' NOT NULL,
	"pause_mode" "notification_pause_mode" DEFAULT 'none' NOT NULL,
	"pause_minutes" integer DEFAULT 15 NOT NULL,
	"auto_resume" boolean DEFAULT true NOT NULL,
	"pause_notice" text DEFAULT '' NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"once_per_conversation" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"trigger_id" text,
	"conversation_id" text,
	"message_id" text,
	"event_key" text,
	"reason" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_event_status" DEFAULT 'pending' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_trigger" ADD CONSTRAINT "notification_trigger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_trigger" ADD CONSTRAINT "notification_trigger_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_trigger_id_notification_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."notification_trigger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_message_id_inbox_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."inbox_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_connect_token_unique" ON "notification_recipient" USING btree ("connect_token");--> statement-breakpoint
CREATE INDEX "notification_recipient_workspace_active_idx" ON "notification_recipient" USING btree ("workspace_id","is_active");--> statement-breakpoint
CREATE INDEX "notification_recipient_chat_idx" ON "notification_recipient" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "notification_trigger_workspace_active_direction_idx" ON "notification_trigger" USING btree ("workspace_id","is_active","direction");--> statement-breakpoint
CREATE INDEX "notification_event_trigger_conversation_fired_idx" ON "notification_event" USING btree ("trigger_id","conversation_id","fired_at");--> statement-breakpoint
CREATE INDEX "notification_event_workspace_fired_idx" ON "notification_event" USING btree ("workspace_id","fired_at");
