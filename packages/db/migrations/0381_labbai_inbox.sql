-- migration-safe: Labbai Inbox. Additive only: new enums and two new tables; no existing table changes.
CREATE TYPE "public"."inbox_channel" AS ENUM('telegram', 'whatsapp', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_author" AS ENUM('customer', 'agent', 'operator');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_status" AS ENUM('received', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "inbox_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel" "inbox_channel" NOT NULL,
	"account_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"contact_name" text,
	"contact_handle" text,
	"workflow_id" text,
	"webhook_id" text,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_preview" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"author" "inbox_message_author" NOT NULL,
	"operator_user_id" text,
	"text" text NOT NULL,
	"external_message_id" text,
	"status" "inbox_message_status" NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversation_thread_unique" ON "inbox_conversation" USING btree ("workspace_id","channel","account_id","external_chat_id");--> statement-breakpoint
CREATE INDEX "inbox_conversation_workspace_recent_idx" ON "inbox_conversation" USING btree ("workspace_id","last_message_at");--> statement-breakpoint
CREATE INDEX "inbox_message_conversation_created_idx" ON "inbox_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_message_external_unique" ON "inbox_message" USING btree ("conversation_id","author","external_message_id") WHERE "inbox_message"."external_message_id" IS NOT NULL;
