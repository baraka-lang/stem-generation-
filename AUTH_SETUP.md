# Supabase Authentication Setup Guide

## Overview
This application uses Supabase's built-in authentication system with minimal custom code for optimal security and performance.

## Features Implemented
- ✅ **Supabase Built-in Auth**: Email/password authentication with secure JWT handling
- ✅ **Automatic Session Management**: JWT tokens and refresh handled by Supabase
- ✅ **Minimal Profile Data**: Only essential data (credits) stored in custom table
- ✅ **Password Reset**: Handled entirely by Supabase
- ✅ **Protected Routes**: Authentication guards with automatic redirects
- ✅ **Credits System**: Real-time tracking and deduction for stem generation
- ✅ **User Menu**: Shows email from auth and credits from profile
- ✅ **Automatic Profile Creation**: Database trigger creates profile on signup

## Setup Instructions

### 1. Supabase Project Setup
1. Create a new Supabase project at https://supabase.com
2. Go to Settings > API to get your project URL and anon key
3. Create a `.env` file in the project root:
   ```
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
4. **Important**: Without these environment variables, the app will run in demo mode with authentication disabled

### 2. Database Migration
Run the SQL migration to create the profiles table:
```bash
# If you have Supabase CLI installed:
supabase db push

# Or manually run the SQL in supabase/migrations/001_create_profiles.sql
# in your Supabase SQL editor
```

### 3. Authentication Configuration
In your Supabase dashboard:
1. Go to Authentication > Settings
2. Configure your site URL (e.g., http://localhost:5173 for development)
3. Add redirect URLs if needed
4. Enable email confirmations if desired

## How It Works

### Authentication Flow
1. **Login Page**: Users can sign in with email/password or create new accounts
2. **Protected Routes**: App checks authentication before showing content
3. **User Menu**: Shows credits, account options, and logout functionality
4. **Credits System**: 5 credits deducted per stem generation (starts with 100 credits)

### File Structure
```
src/
├── Auth/
│   ├── index.js          # Core auth functions (signIn, signOut, etc.)
│   ├── userProfile.js    # User profile and credits management
│   ├── loginPage.js      # Login form logic and validation
│   └── authGuard.js      # Route protection and auth state management
├── pages/
│   ├── login-page.html   # Login/signup form UI
│   └── selection-page.html # Genre selection (existing)
└── UI/
    └── userMenu.js       # Updated with auth functionality
```

### Database Schema
```sql
-- Minimal profiles table - only essential data
-- Email and user data managed by Supabase auth.users table
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  credits integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Automatic profile creation trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits)
  values (new.id, 100);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

## Usage

### For Users
1. Visit the app - you'll see the login page if not authenticated
2. Create an account or sign in with existing credentials
3. Start with 100 credits
4. Each stem generation costs 5 credits
5. View credits in the header user menu
6. Use logout button to sign out

### For Developers
- **Minimal Code**: Only essential auth functions in `src/Auth/`
- **Supabase Native**: Uses built-in JWT, sessions, password hashing
- **Credits Only**: Profile table stores only credits, email from auth.users
- **Auto Profile**: Database trigger creates profile automatically
- **No Email Updates**: Email changes not supported (Supabase handles this)

## Security Features
- **Supabase Built-in Security**: JWT tokens, secure password hashing, session management
- **Row Level Security (RLS)**: Users can only access their own profile data
- **Automatic Profile Creation**: Database trigger ensures profile exists
- **Minimal Attack Surface**: Only credits stored in custom table
- **Environment Variables**: Sensitive keys stored securely

## Key Benefits
- **Faster**: Leverages Supabase's optimized auth system
- **More Secure**: Uses Supabase's battle-tested security features
- **Less Code**: Minimal custom authentication logic
- **Better Performance**: Automatic session refresh and caching
- **Easier Maintenance**: Less custom code to maintain and debug

## Troubleshooting

### "Auth session missing!" Error
This error can occur in two scenarios:

#### Scenario 1: Environment Variables Not Configured
If Supabase environment variables are missing, the app will run in demo mode:

1. **Check your `.env` file** exists and contains:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

2. **Restart the development server** after adding environment variables:
   ```bash
   npm run dev
   ```

#### Scenario 2: No Active Session (Normal)
If you see "Auth session missing!" but Supabase is configured, this is **normal behavior** when no user is logged in. The app will:
- Log "No active session found (user not logged in)" instead of an error
- Show the login page
- Allow users to sign in normally

This is expected behavior and not an error that needs fixing.

### Other Common Issues
- **Database not found**: Make sure you've run the migration in your Supabase project
- **CORS errors**: Check your Supabase project settings for allowed origins
- **Email not verified**: Check your email for verification link after signup

## Future Enhancements
- Credit purchase system
- User library/saved sets
- Admin dashboard for credit management
- Social authentication (Google, GitHub, etc.)
- Advanced user preferences
