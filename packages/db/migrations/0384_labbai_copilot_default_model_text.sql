-- Labbai: the copilot model picker offers every Cloudflare model (OpenAI, Anthropic, Google,
-- Workers AI), more than the 16 labels of the legacy `local_copilot_default_model` enum, so
-- `local_copilot_user_access.default_model` now stores the picker id itself as text.
-- The enum type is left in place (nothing reads it after this migration).
-- migration-safe: the default is re-set to the same value two statements below; old code never relies on the column default (rows come from the trigger, which is replaced here too).
ALTER TABLE "local_copilot_user_access" ALTER COLUMN "default_model" DROP DEFAULT;--> statement-breakpoint
-- migration-safe: enum to text widening. Every existing label converts 1:1; the code deployed before this one still works (it writes legacy labels, which are valid text, and maps any value it does not know to its default on read). One row per user, so the rewrite lock is brief.
ALTER TABLE "local_copilot_user_access" ALTER COLUMN "default_model" SET DATA TYPE text USING "default_model"::text;--> statement-breakpoint
ALTER TABLE "local_copilot_user_access" ALTER COLUMN "default_model" SET DEFAULT 'openai';--> statement-breakpoint
CREATE OR REPLACE FUNCTION insert_local_copilot_user_access()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO local_copilot_user_access (id, user_id, email, has_access, local_only, default_model)
  VALUES (gen_random_uuid(), NEW.id, NEW.email, true, true, 'openai')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
