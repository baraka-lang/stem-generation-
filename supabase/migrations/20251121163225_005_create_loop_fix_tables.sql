/*
  # Create loop fix analytics and caching tables

  1. New Tables
    - `loop_fix_cache`
      - Stores Gemini analysis results for reuse
      - Keyed by audio content hash

    - `loop_fix_analytics`
      - Tracks performance metrics and quality scores
      - Used for monitoring and optimization

    - `loop_fix_feedback`
      - Optional user feedback on loop quality
      - Helps improve the system over time

  2. Security
    - Enable RLS on all tables
    - Service role can read/write all data
    - Authenticated users can read cache (for their requests)
    - Authenticated users can write feedback

  3. Indexes
    - Hash lookups for cache retrieval
    - Timestamp indexes for analytics queries
    - Stem type indexes for performance analysis
*/

-- Create function to update updated_at timestamp if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Loop Fix Cache Table
CREATE TABLE IF NOT EXISTS loop_fix_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_hash text NOT NULL UNIQUE,
  audio_duration_seconds numeric NOT NULL,
  target_bpm integer NOT NULL,
  bars integer NOT NULL,
  stem_type text,
  model_used text NOT NULL,
  detected_bpm numeric NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  downbeat_frames integer[],
  beat_frames integer[],
  transient_frames integer[],
  suggested_start_frame integer NOT NULL,
  seam_frame integer NOT NULL,
  analysis_metadata jsonb DEFAULT '{}'::jsonb,
  quality_score integer CHECK (quality_score >= 0 AND quality_score <= 100),
  hit_count integer DEFAULT 0,
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Loop Fix Analytics Table
CREATE TABLE IF NOT EXISTS loop_fix_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid,
  request_id text,
  stem_type text NOT NULL,
  target_bpm integer NOT NULL,
  bars integer NOT NULL,
  audio_duration_seconds numeric,
  audio_size_bytes integer,
  model_used text NOT NULL,
  gemini_used boolean NOT NULL DEFAULT false,
  cache_hit boolean NOT NULL DEFAULT false,
  detected_bpm numeric,
  confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
  stretch_ratio numeric,
  gemini_call_ms integer,
  wsola_process_ms integer,
  total_process_ms integer NOT NULL,
  quality_score integer CHECK (quality_score >= 0 AND quality_score <= 100),
  error_occurred boolean NOT NULL DEFAULT false,
  error_message text,
  fallback_used boolean NOT NULL DEFAULT false,
  estimated_cost_usd numeric(10, 6),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Loop Fix Feedback Table
CREATE TABLE IF NOT EXISTS loop_fix_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analytics_id uuid REFERENCES loop_fix_analytics(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  quality_issues text[],
  comments text,
  stem_type text NOT NULL,
  model_used text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS loop_fix_cache_audio_hash_idx ON loop_fix_cache(audio_hash);
CREATE INDEX IF NOT EXISTS loop_fix_cache_target_bpm_idx ON loop_fix_cache(target_bpm);
CREATE INDEX IF NOT EXISTS loop_fix_cache_stem_type_idx ON loop_fix_cache(stem_type);
CREATE INDEX IF NOT EXISTS loop_fix_cache_last_used_idx ON loop_fix_cache(last_used_at DESC);

CREATE INDEX IF NOT EXISTS loop_fix_analytics_user_id_idx ON loop_fix_analytics(user_id);
CREATE INDEX IF NOT EXISTS loop_fix_analytics_stem_type_idx ON loop_fix_analytics(stem_type);
CREATE INDEX IF NOT EXISTS loop_fix_analytics_model_used_idx ON loop_fix_analytics(model_used);
CREATE INDEX IF NOT EXISTS loop_fix_analytics_created_at_idx ON loop_fix_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS loop_fix_analytics_error_idx ON loop_fix_analytics(error_occurred) WHERE error_occurred = true;

CREATE INDEX IF NOT EXISTS loop_fix_feedback_user_id_idx ON loop_fix_feedback(user_id);
CREATE INDEX IF NOT EXISTS loop_fix_feedback_stem_type_idx ON loop_fix_feedback(stem_type);
CREATE INDEX IF NOT EXISTS loop_fix_feedback_rating_idx ON loop_fix_feedback(rating);

-- Create triggers
CREATE TRIGGER update_loop_fix_cache_updated_at
  BEFORE UPDATE ON loop_fix_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE loop_fix_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_fix_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_fix_feedback ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Service role can manage cache"
  ON loop_fix_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read cache"
  ON loop_fix_cache FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can write analytics"
  ON loop_fix_analytics FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "Users can view own analytics"
  ON loop_fix_analytics FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create feedback"
  ON loop_fix_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own feedback"
  ON loop_fix_feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT ON loop_fix_cache TO authenticated;
GRANT ALL ON loop_fix_cache TO service_role;
GRANT SELECT ON loop_fix_analytics TO authenticated;
GRANT INSERT ON loop_fix_analytics TO service_role;
GRANT SELECT, INSERT ON loop_fix_feedback TO authenticated;

-- Helper functions
CREATE OR REPLACE FUNCTION increment_cache_hit_count(cache_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE loop_fix_cache
  SET hit_count = hit_count + 1, last_used_at = now()
  WHERE id = cache_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_old_cache_entries()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM loop_fix_cache
  WHERE created_at < now() - interval '30 days' AND hit_count < 5;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
