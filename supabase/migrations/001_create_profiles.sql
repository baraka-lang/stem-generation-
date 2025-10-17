-- Migration: Create minimal profiles table for credits tracking only
-- Created: 2025-01-14
-- Note: Email and user data managed by Supabase auth.users table

-- Create minimal profiles table - only essential data
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  credits integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Create updated_at trigger function
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger to automatically update updated_at
create trigger update_profiles_updated_at
  before update on profiles
  for each row
  execute function update_updated_at_column();

-- Enable Row Level Security (RLS)
alter table profiles enable row level security;

-- Create RLS policies

-- Policy: Users can view their own profile
create policy "Users can view own profile" 
  on profiles for select 
  using (auth.uid() = id);

-- Policy: Users can update their own profile
create policy "Users can update own profile" 
  on profiles for update 
  using (auth.uid() = id);

-- Policy: Users can insert their own profile
create policy "Users can insert own profile" 
  on profiles for insert 
  with check (auth.uid() = id);

-- Create function to automatically create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits)
  values (new.id, 100);
  return new;
end;
$$ language plpgsql security definer;

-- Create trigger to automatically create profile when user signs up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create index for better performance
create index if not exists profiles_credits_idx on profiles(credits);

-- Grant necessary permissions
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.profiles to anon;
