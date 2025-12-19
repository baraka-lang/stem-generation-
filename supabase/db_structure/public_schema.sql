-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.downloads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  download_type text NOT NULL,
  stem_id uuid,
  set_id uuid,
  file_format text NOT NULL,
  file_size integer,
  download_url text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT downloads_pkey PRIMARY KEY (id),
  CONSTRAINT downloads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT downloads_stem_id_fkey FOREIGN KEY (stem_id) REFERENCES public.stems(id),
  CONSTRAINT downloads_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.stem_sets(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  avatar_url text,
  preferences jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  credits integer NOT NULL DEFAULT 100,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.session_settings (
  session_setting_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid DEFAULT gen_random_uuid(),
  session_name character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  tempo bigint,
  bars bigint,
  root_base character varying,
  selected_accidental character varying,
  mode character varying,
  is_deleted boolean DEFAULT false,
  CONSTRAINT session_settings_pkey PRIMARY KEY (session_setting_id),
  CONSTRAINT session_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.stem_set_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  set_id uuid,
  stem_id uuid,
  position integer,
  volume numeric DEFAULT 1.0,
  muted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stem_set_items_pkey PRIMARY KEY (id),
  CONSTRAINT stem_set_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.stem_sets(id),
  CONSTRAINT stem_set_items_stem_id_fkey FOREIGN KEY (stem_id) REFERENCES public.stems(id)
);
CREATE TABLE public.stem_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  description text,
  tempo integer NOT NULL,
  bars integer NOT NULL,
  key_signature text,
  is_public boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stem_sets_pkey PRIMARY KEY (id),
  CONSTRAINT stem_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.stem_states (
  stem_state_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  state_name character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  stems_snapshot json,
  is_deleted boolean DEFAULT false,
  session_settings_id bigint,
  CONSTRAINT stem_states_pkey PRIMARY KEY (stem_state_id),
  CONSTRAINT stem_states_session_settings_id_fkey FOREIGN KEY (session_settings_id) REFERENCES public.session_settings(session_setting_id)
);
CREATE TABLE public.stems (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  stem_type text NOT NULL,
  prompt text,
  tempo integer NOT NULL,
  bars integer NOT NULL,
  key_signature text,
  generation_tier integer DEFAULT 0,
  validated boolean DEFAULT false,
  audio_data bytea,
  audio_url text,
  file_size integer,
  duration_seconds numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stems_pkey PRIMARY KEY (id),
  CONSTRAINT stems_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  stripe_customer_id text UNIQUE,
  credit_balance integer DEFAULT 0,
  subscription_tier text DEFAULT 'free'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.unsaved_stems (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  stem_name character varying NOT NULL,
  audio_key character varying NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_saved boolean NOT NULL DEFAULT false,
  CONSTRAINT unsaved_stems_pkey PRIMARY KEY (id),
  CONSTRAINT unsaved_stems_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stem_id text NOT NULL,
  take_index integer NOT NULL DEFAULT '-1'::integer,
  stem_name text,
  stem_color text,
  bpm integer,
  key_signature text,
  bars integer,
  rating integer NOT NULL DEFAULT 3 CHECK (rating >= 1 AND rating <= 5),
  audio_key text,
  unsaved_stem_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_likes_pkey PRIMARY KEY (id),
  CONSTRAINT user_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_likes_unsaved_stem_id_fkey FOREIGN KEY (unsaved_stem_id) REFERENCES public.unsaved_stems(id)
);