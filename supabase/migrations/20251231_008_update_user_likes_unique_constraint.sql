-- Migration to update the unique constraint on user_likes table
-- This allows multiple takes of the same instrument at the same index to be liked independently.

BEGIN;

-- 1. Add unique constraint on (user_id, audio_key)
-- First check if it already exists to avoid errors
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_likes_user_id_audio_key_key'
    ) THEN
        ALTER TABLE public.user_likes ADD CONSTRAINT user_likes_user_id_audio_key_key UNIQUE (user_id, audio_key);
    END IF;
END $$;

-- 2. Remove the old unique constraint on (user_id, stem_id, take_index)
-- This is necessary to allow multiple generations of the same instrument (same ID/index) with different audio keys.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_likes_user_id_stem_id_take_index_key'
    ) THEN
        ALTER TABLE public.user_likes DROP CONSTRAINT user_likes_user_id_stem_id_take_index_key;
    END IF;
END $$;

COMMIT;
