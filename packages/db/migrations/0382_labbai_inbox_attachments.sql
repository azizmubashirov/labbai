-- migration-safe: Labbai Inbox media. Adds a defaulted jsonb column to inbox_message; no rewrite of existing rows beyond the constant default.
ALTER TABLE "inbox_message" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;
