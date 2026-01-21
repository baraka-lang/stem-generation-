-- Enable RLS
ALTER TABLE public.session_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts (handling various naming conventions)
DROP POLICY IF EXISTS "Enable read access for users based on user_id" ON public.session_settings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.session_settings;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON public.session_settings;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.session_settings;
DROP POLICY IF EXISTS "session_settings_select_policy" ON public.session_settings;
DROP POLICY IF EXISTS "session_settings_insert_policy" ON public.session_settings;
DROP POLICY IF EXISTS "session_settings_update_policy" ON public.session_settings;
DROP POLICY IF EXISTS "session_settings_delete_policy" ON public.session_settings;
DROP POLICY IF EXISTS "session_settings_insert_authenticated" ON public.session_settings;

-- Create comprehensive policies
-- 1. SELECT: Users can only see their own settings
CREATE POLICY "session_settings_select_policy" 
ON public.session_settings 
FOR SELECT 
USING (auth.uid() = user_id);

-- 2. INSERT: Users can insert their own settings
CREATE POLICY "session_settings_insert_policy" 
ON public.session_settings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 3. UPDATE: Users can update their own settings
CREATE POLICY "session_settings_update_policy" 
ON public.session_settings 
FOR UPDATE 
USING (auth.uid() = user_id);

-- 4. DELETE: Users can delete their own settings
CREATE POLICY "session_settings_delete_policy" 
ON public.session_settings 
FOR DELETE 
USING (auth.uid() = user_id);
