-- Creates row level security policies for the audio storage bucket used by the app.
-- Allows any signed-in user to upload files to the bucket and all clients to read them.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Allow authenticated audio uploads'
  ) then
    create policy "Allow authenticated audio uploads"
      on storage.objects
      for insert
      with check (
        bucket_id = 'audio-files'
        and auth.uid() is not null
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Allow public audio downloads'
  ) then
    create policy "Allow public audio downloads"
      on storage.objects
      for select
      using (
        bucket_id = 'audio-files'
      );
  end if;
end $$;

