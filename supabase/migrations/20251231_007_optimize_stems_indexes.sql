-- Optimize queries on public.stems to prevent statement timeouts
-- Adds composite indexes used by application filters and ordering

create index if not exists idx_stems_user_id_is_deleted_created_at
  on public.stems (user_id, is_deleted, created_at desc);

create index if not exists idx_stems_session_setting_id_is_deleted_created_at
  on public.stems (session_setting_id, is_deleted, created_at desc);

