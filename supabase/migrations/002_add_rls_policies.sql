-- Migration: Add Row Level Security policies for stems, stem_sets, session_settings, and related tables
-- Created: 2025-01-XX
-- Note: This migration adds RLS policies to allow authenticated users to manage their own data

-- ============================================
-- SESSION_SETTINGS table policies
-- ============================================

-- Enable RLS on session_settings
alter table public.session_settings enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view own session settings" on public.session_settings;
drop policy if exists "Users can insert own session settings" on public.session_settings;
drop policy if exists "Users can update own session settings" on public.session_settings;
drop policy if exists "Users can delete own session settings" on public.session_settings;

-- Policy: Users can view their own session settings
create policy "Users can view own session settings" 
  on public.session_settings for select 
  using (auth.uid() = user_uuid);

-- Policy: Users can insert their own session settings
create policy "Users can insert own session settings" 
  on public.session_settings for insert 
  with check (auth.uid() = user_uuid);

-- Policy: Users can update their own session settings
create policy "Users can update own session settings" 
  on public.session_settings for update 
  using (auth.uid() = user_uuid)
  with check (auth.uid() = user_uuid);

-- Policy: Users can delete their own session settings
create policy "Users can delete own session settings" 
  on public.session_settings for delete 
  using (auth.uid() = user_uuid);

-- ============================================
-- STEM_SETS table policies
-- ============================================

-- Enable RLS on stem_sets
alter table public.stem_sets enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view own stem sets" on public.stem_sets;
drop policy if exists "Users can insert own stem sets" on public.stem_sets;
drop policy if exists "Users can update own stem sets" on public.stem_sets;
drop policy if exists "Users can delete own stem sets" on public.stem_sets;

-- Policy: Users can view stem sets linked to their session settings
create policy "Users can view own stem sets" 
  on public.stem_sets for select 
  using (
    exists (
      select 1 from public.session_settings
      where session_settings.id = stem_sets.session_setting_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- Policy: Users can insert stem sets linked to their session settings
create policy "Users can insert own stem sets" 
  on public.stem_sets for insert 
  with check (
    exists (
      select 1 from public.session_settings
      where session_settings.id = stem_sets.session_setting_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- Policy: Users can update stem sets linked to their session settings
create policy "Users can update own stem sets" 
  on public.stem_sets for update 
  using (
    exists (
      select 1 from public.session_settings
      where session_settings.id = stem_sets.session_setting_id
      and session_settings.user_uuid = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.session_settings
      where session_settings.id = stem_sets.session_setting_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- Policy: Users can delete stem sets linked to their session settings
create policy "Users can delete own stem sets" 
  on public.stem_sets for delete 
  using (
    exists (
      select 1 from public.session_settings
      where session_settings.id = stem_sets.session_setting_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- ============================================
-- STEMS table policies
-- ============================================

-- Enable RLS on stems
alter table public.stems enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view own stems" on public.stems;
drop policy if exists "Users can insert own stems" on public.stems;
drop policy if exists "Users can update own stems" on public.stems;
drop policy if exists "Users can delete own stems" on public.stems;

-- Policy: Users can view their own stems
create policy "Users can view own stems" 
  on public.stems for select 
  using (auth.uid() = user_id);

-- Policy: Users can insert their own stems
create policy "Users can insert own stems" 
  on public.stems for insert 
  with check (auth.uid() = user_id);

-- Policy: Users can update their own stems
create policy "Users can update own stems" 
  on public.stems for update 
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Policy: Users can delete their own stems
create policy "Users can delete own stems" 
  on public.stems for delete 
  using (auth.uid() = user_id);

-- ============================================
-- STEM_SET_ITEMS table policies
-- ============================================

-- Enable RLS on stem_set_items
alter table public.stem_set_items enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view own stem set items" on public.stem_set_items;
drop policy if exists "Users can insert own stem set items" on public.stem_set_items;
drop policy if exists "Users can update own stem set items" on public.stem_set_items;
drop policy if exists "Users can delete own stem set items" on public.stem_set_items;

-- Policy: Users can view stem set items for their sets
create policy "Users can view own stem set items" 
  on public.stem_set_items for select 
  using (
    exists (
      select 1 from public.stem_sets
      join public.session_settings on session_settings.id = stem_sets.session_setting_id
      where stem_sets.id = stem_set_items.set_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- Policy: Users can insert stem set items for their sets
create policy "Users can insert own stem set items" 
  on public.stem_set_items for insert 
  with check (
    exists (
      select 1 from public.stem_sets
      join public.session_settings on session_settings.id = stem_sets.session_setting_id
      where stem_sets.id = stem_set_items.set_id
      and session_settings.user_uuid = auth.uid()
    )
    and exists (
      select 1 from public.stems
      where stems.id = stem_set_items.stem_id
      and stems.user_id = auth.uid()
    )
  );

-- Policy: Users can update stem set items for their sets
create policy "Users can update own stem set items" 
  on public.stem_set_items for update 
  using (
    exists (
      select 1 from public.stem_sets
      join public.session_settings on session_settings.id = stem_sets.session_setting_id
      where stem_sets.id = stem_set_items.set_id
      and session_settings.user_uuid = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stem_sets
      join public.session_settings on session_settings.id = stem_sets.session_setting_id
      where stem_sets.id = stem_set_items.set_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- Policy: Users can delete stem set items for their sets
create policy "Users can delete own stem set items" 
  on public.stem_set_items for delete 
  using (
    exists (
      select 1 from public.stem_sets
      join public.session_settings on session_settings.id = stem_sets.session_setting_id
      where stem_sets.id = stem_set_items.set_id
      and session_settings.user_uuid = auth.uid()
    )
  );

-- ============================================
-- DOWNLOADS table policies (if needed)
-- ============================================

-- Enable RLS on downloads
alter table public.downloads enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view own downloads" on public.downloads;
drop policy if exists "Users can insert own downloads" on public.downloads;

-- Policy: Users can view their own downloads
create policy "Users can view own downloads" 
  on public.downloads for select 
  using (auth.uid() = user_id);

-- Policy: Users can insert their own downloads
create policy "Users can insert own downloads" 
  on public.downloads for insert 
  with check (auth.uid() = user_id);

-- Grant necessary permissions
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.session_settings to authenticated;
grant select, insert, update, delete on public.stem_sets to authenticated;
grant select, insert, update, delete on public.stems to authenticated;
grant select, insert, update, delete on public.stem_set_items to authenticated;
grant select, insert on public.downloads to authenticated;

