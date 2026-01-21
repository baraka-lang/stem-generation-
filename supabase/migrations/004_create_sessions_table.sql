/*
  # Create sessions table for storing user session data

  1. New Tables
    - `sessions`
      - `id` (uuid, primary key) - Unique session identifier
      - `user_id` (uuid, foreign key) - References auth.users table
      - `name` (text) - Optional session name
      - `visible_instruments` (text[]) - Array of visible instrument IDs
      - `session_data` (jsonb) - Additional session configuration data
      - `created_at` (timestamptz) - Session creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `sessions` table
    - Add policy for authenticated users to create their own sessions
    - Add policy for authenticated users to read their own sessions
    - Add policy for authenticated users to update their own sessions
    - Add policy for authenticated users to delete their own sessions

  3. Important Notes
    - Sessions are user-specific and cannot be accessed by other users
    - The visible_instruments array stores stem IDs (kick, bass, lead, etc.)
    - Session data is automatically updated via trigger
*/

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text DEFAULT 'Untitled Session',
  visible_instruments text[] DEFAULT ARRAY['kick', 'bass']::text[],
  session_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create trigger for updated_at
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

-- Create index for created_at for sorting
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own sessions
CREATE POLICY "Users can view own sessions"
  ON sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can create their own sessions
CREATE POLICY "Users can create own sessions"
  ON sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own sessions
CREATE POLICY "Users can update own sessions"
  ON sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own sessions
CREATE POLICY "Users can delete own sessions"
  ON sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO authenticated;
