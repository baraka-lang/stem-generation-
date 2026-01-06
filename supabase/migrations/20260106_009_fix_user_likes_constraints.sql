-- Fix missing unique constraint on user_likes table
-- This ensures the ON CONFLICT (user_id, audio_key) clause works correctly.

BEGIN;

-- 1. Ensure audio_key is not null for existing records if we want to rely on it (optional, but good practice if it's the main key)
-- UPDATE public.user_likes SET audio_key = 'legacy_' || id WHERE audio_key IS NULL;

-- 2. Add unique constraint on (user_id, audio_key)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_likes_user_id_audio_key_key'
    ) THEN
        -- We use a unique index which supports the ON CONFLICT clause
        ALTER TABLE public.user_likes ADD CONSTRAINT user_likes_user_id_audio_key_key UNIQUE (user_id, audio_key);
    END IF;
END $$;

COMMIT;
