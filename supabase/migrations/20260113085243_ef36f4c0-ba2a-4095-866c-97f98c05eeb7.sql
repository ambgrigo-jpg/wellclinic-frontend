-- Create table for site statistics
CREATE TABLE public.site_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stat_key TEXT NOT NULL UNIQUE,
  stat_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert initial stats
INSERT INTO public.site_stats (stat_key, stat_value) VALUES 
  ('total_visits', 0),
  ('unique_visitors', 0);

-- Create table for tracking unique visitors by fingerprint
CREATE TABLE public.visitors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_hash TEXT NOT NULL UNIQUE,
  first_visit TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_visit TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  visit_count INTEGER NOT NULL DEFAULT 1
);

-- Enable RLS
ALTER TABLE public.site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read stats (public data)
CREATE POLICY "Anyone can read site stats" 
ON public.site_stats 
FOR SELECT 
USING (true);

-- Allow anyone to read visitors count (for stats)
CREATE POLICY "Anyone can read visitors" 
ON public.visitors 
FOR SELECT 
USING (true);

-- Allow inserts and updates via service role only (edge function)
-- No insert/update policies for anon users - edge function will use service role

-- Create function to increment visit counter
CREATE OR REPLACE FUNCTION public.increment_visit(p_visitor_hash TEXT)
RETURNS TABLE(total_visits BIGINT, unique_visitors BIGINT) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_new_visitor BOOLEAN := false;
BEGIN
  -- Try to insert new visitor or update existing
  INSERT INTO public.visitors (visitor_hash, visit_count)
  VALUES (p_visitor_hash, 1)
  ON CONFLICT (visitor_hash) 
  DO UPDATE SET 
    last_visit = now(),
    visit_count = visitors.visit_count + 1;
  
  -- Check if this was a new visitor
  GET DIAGNOSTICS v_is_new_visitor = ROW_COUNT;
  
  -- Check if visitor was just created (visit_count = 1)
  SELECT (v.visit_count = 1) INTO v_is_new_visitor 
  FROM public.visitors v 
  WHERE v.visitor_hash = p_visitor_hash;
  
  -- Always increment total visits
  UPDATE public.site_stats 
  SET stat_value = stat_value + 1, updated_at = now()
  WHERE stat_key = 'total_visits';
  
  -- Increment unique visitors only if new
  IF v_is_new_visitor THEN
    UPDATE public.site_stats 
    SET stat_value = stat_value + 1, updated_at = now()
    WHERE stat_key = 'unique_visitors';
  END IF;
  
  -- Return current stats
  RETURN QUERY
  SELECT 
    (SELECT s.stat_value FROM public.site_stats s WHERE s.stat_key = 'total_visits'),
    (SELECT s.stat_value FROM public.site_stats s WHERE s.stat_key = 'unique_visitors');
END;
$$;

-- Enable realtime for stats updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_stats;