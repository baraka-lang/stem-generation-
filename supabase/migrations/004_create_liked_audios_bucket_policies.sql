-- Migration: Create liked-audios bucket and RLS policies
-- Created: 2025-12-30
-- Description: Sets up the storage bucket for user likes and applies necessary security policies.

-- 1. Ensure the bucket exists (public by default for easier playback, but policies restrict write access)
insert into storage.buckets (id, name, public)
values ('liked-audios', 'liked-audios', true)
on conflict (id) do nothing;

-- 2. Create RLS policies
do $$
begin
  -- Policy: Allow authenticated users to upload files to liked-audios
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' 
    and tablename = 'objects' 
    and policyname = 'Allow authenticated uploads to liked-audios'
  ) then
    create policy "Allow authenticated uploads to liked-audios"
      on storage.objects for insert
      to authenticated
      with check ( bucket_id = 'liked-audios' );
  end if;

  -- Policy: Allow public download/read access to liked-audios
  -- This is necessary for playback in the UI
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' 
    and tablename = 'objects' 
    and policyname = 'Allow public downloads from liked-audios'
  ) then
    create policy "Allow public downloads from liked-audios"
      on storage.objects for select
      to public
      using ( bucket_id = 'liked-audios' );
  end if;

  -- Policy: Allow users to delete their own files
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' 
    and tablename = 'objects' 
    and policyname = 'Allow users to delete own files in liked-audios'
  ) then
    create policy "Allow users to delete own files in liked-audios"
      on storage.objects for delete
      to authenticated
      using ( bucket_id = 'liked-audios' and auth.uid() = owner );
  end if;

  -- Policy: Allow users to update their own files
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'storage' 
    and tablename = 'objects' 
    and policyname = 'Allow users to update own files in liked-audios'
  ) then
    create policy "Allow users to update own files in liked-audios"
      on storage.objects for update
      to authenticated
      using ( bucket_id = 'liked-audios' and auth.uid() = owner );
  end if;
end $$;
