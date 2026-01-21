create extension if not exists pgcrypto;

create table if not exists public.user_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stem_id text not null,
  take_index integer not null default -1,
  stem_name text,
  stem_color text,
  bpm integer,
  key_signature text,
  bars integer,
  rating integer not null default 3 check (rating >= 1 and rating <= 5),
  audio_key text,
  unsaved_stem_id uuid references public.unsaved_stems (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stem_id, take_index)
);

create index if not exists idx_user_likes_user_id on public.user_likes (user_id);
create index if not exists idx_user_likes_updated_at on public.user_likes (updated_at);
create index if not exists idx_user_likes_audio_key on public.user_likes (audio_key);

create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp on public.user_likes;
create trigger set_timestamp
before update on public.user_likes
for each row
execute function public.trigger_set_timestamp();

create table if not exists public.unsaved_stems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  stem_name text not null,
  audio_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb,
  is_saved boolean not null default false
);

create index if not exists idx_unsaved_stems_user_id on public.unsaved_stems (user_id);
create index if not exists idx_unsaved_stems_created_at on public.unsaved_stems (created_at);
create index if not exists idx_unsaved_stems_audio_key on public.unsaved_stems (audio_key);

alter table public.user_likes enable row level security;
alter table public.unsaved_stems enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_likes' and policyname = 'user_likes_select_own'
  ) then
    create policy user_likes_select_own
      on public.user_likes
      for select
      using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_likes' and policyname = 'user_likes_insert_own'
  ) then
    create policy user_likes_insert_own
      on public.user_likes
      for insert
      with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_likes' and policyname = 'user_likes_update_own'
  ) then
    create policy user_likes_update_own
      on public.user_likes
      for update
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_likes' and policyname = 'user_likes_delete_own'
  ) then
    create policy user_likes_delete_own
      on public.user_likes
      for delete
      using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'unsaved_stems' and policyname = 'unsaved_stems_public_select'
  ) then
    create policy unsaved_stems_public_select
      on public.unsaved_stems
      for select
      using (user_id = auth.uid() or user_id is null);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'unsaved_stems' and policyname = 'unsaved_stems_anon_insert'
  ) then
    create policy unsaved_stems_anon_insert
      on public.unsaved_stems
      for insert
      to anon
      with check (user_id is null);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'unsaved_stems' and policyname = 'unsaved_stems_auth_insert'
  ) then
    create policy unsaved_stems_auth_insert
      on public.unsaved_stems
      for insert
      to authenticated
      with check (user_id = auth.uid() or user_id is null);
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage' and p.proname = 'create_bucket'
  ) then
    perform storage.create_bucket('unsaved-audios', true);
  else
    if not exists (select 1 from storage.buckets where name = 'unsaved-audios') then
      insert into storage.buckets (id, name, public) values (gen_random_uuid(), 'unsaved-audios', true);
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'unsaved_audios_public_select'
  ) then
    create policy unsaved_audios_public_select
      on storage.objects
      for select
      using (bucket_id = 'unsaved-audios');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'unsaved_audios_anon_insert'
  ) then
    create policy unsaved_audios_anon_insert
      on storage.objects
      for insert
      to anon
      with check (bucket_id = 'unsaved-audios' and name like 'unsaved/%');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'unsaved_audios_auth_insert'
  ) then
    create policy unsaved_audios_auth_insert
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'unsaved-audios' and name like 'unsaved/%');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'unsaved_audios_anon_delete'
  ) then
    create policy unsaved_audios_anon_delete
      on storage.objects
      for delete
      to anon
      using (bucket_id = 'unsaved-audios' and name like 'unsaved/%');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'unsaved_audios_auth_delete'
  ) then
    create policy unsaved_audios_auth_delete
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'unsaved-audios' and name like 'unsaved/%');
  end if;
end $$;
