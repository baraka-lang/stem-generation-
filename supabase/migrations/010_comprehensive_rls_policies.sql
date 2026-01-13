-- Comprehensive RLS Policies for all tables
-- Based on public_schema.sql definitions

-- 1. PROFILES Table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2. STEMS Table
ALTER TABLE public.stems ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own stems" ON public.stems;

CREATE POLICY "Users can manage own stems" ON public.stems
FOR ALL USING (user_id = auth.uid() OR user_id IS NULL) WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- 3. SESSION_SETTINGS Table
ALTER TABLE public.session_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own session settings" ON public.session_settings;

CREATE POLICY "Users can manage own session settings" ON public.session_settings
FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. DOWNLOADS Table
ALTER TABLE public.downloads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own downloads" ON public.downloads;

CREATE POLICY "Users can manage own downloads" ON public.downloads
FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5. SUBSCRIPTIONS Table
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;

CREATE POLICY "Users can view own subscription" ON public.subscriptions
FOR SELECT USING (user_id = auth.uid());

-- 6. STEM_STATES / STEM_SET_ITEMS (Linked Access)
ALTER TABLE public.stem_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own stem states" ON public.stem_states;

CREATE POLICY "Users can manage own stem states" ON public.stem_states
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.session_settings
    WHERE session_settings.session_setting_id = stem_states.session_settings_id
    AND session_settings.user_id = auth.uid()
  )
);

ALTER TABLE public.stem_set_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own set items" ON public.stem_set_items;

CREATE POLICY "Users can manage own set items" ON public.stem_set_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.stems
    WHERE stems.id = stem_set_items.stem_id
    AND stems.user_id = auth.uid()
  )
);

-- 7. USER_LIKES Table (Already updated in app logic, but hardening here)
ALTER TABLE public.user_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own likes" ON public.user_likes;

CREATE POLICY "Users can manage own likes" ON public.user_likes
FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 8. UNSAVED_STEMS Table (Permissive for Generation)
ALTER TABLE public.unsaved_stems ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "unsaved_stems_permissive_policy" ON public.unsaved_stems;

CREATE POLICY "unsaved_stems_permissive_policy" ON public.unsaved_stems
FOR ALL USING (user_id = auth.uid() OR user_id IS NULL) WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- 9. PERMISSIONS
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO anon;
