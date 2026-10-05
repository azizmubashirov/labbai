-- migration-safe: Labbai CRM link. Additive only: one new enum, three new tables, and a nullable column (no default, no rewrite) on inbox_message for operators who are not Labbai users.
CREATE TYPE "public"."crm_link_provider" AS ENUM('binora');--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "operator_name" text;--> statement-breakpoint
CREATE TABLE "crm_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"provider" "crm_link_provider" NOT NULL,
	"base_url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"callback_key" text NOT NULL,
	"deployed" boolean DEFAULT false NOT NULL,
	"mirror_since" timestamp DEFAULT now() NOT NULL,
	"connected_at" timestamp,
	"remote_channel_name" text,
	"remote_pipeline_name" text,
	"last_error" text,
	"last_error_at" timestamp,
	"last_delivered_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_message_delivery" (
	"link_id" text NOT NULL,
	"message_id" text NOT NULL,
	"outcome" text NOT NULL,
	"remote_key" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_message_delivery_link_id_message_id_pk" PRIMARY KEY("link_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "crm_conversation_sync" (
	"link_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sent_ai_enabled" boolean,
	"sent_ai_paused_until" timestamp,
	"sent_contact_name" text,
	"sent_contact_handle" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_conversation_sync_link_id_conversation_id_pk" PRIMARY KEY("link_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "crm_link" ADD CONSTRAINT "crm_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_link" ADD CONSTRAINT "crm_link_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_link" ADD CONSTRAINT "crm_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_message_delivery" ADD CONSTRAINT "crm_message_delivery_link_id_crm_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."crm_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_message_delivery" ADD CONSTRAINT "crm_message_delivery_message_id_inbox_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."inbox_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversation_sync" ADD CONSTRAINT "crm_conversation_sync_link_id_crm_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."crm_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversation_sync" ADD CONSTRAINT "crm_conversation_sync_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_link_workflow_unique" ON "crm_link" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_link_callback_key_unique" ON "crm_link" USING btree ("callback_key");--> statement-breakpoint
CREATE INDEX "crm_link_workspace_idx" ON "crm_link" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_message_delivery_remote_key_unique" ON "crm_message_delivery" USING btree ("link_id","remote_key") WHERE "crm_message_delivery"."remote_key" IS NOT NULL;
