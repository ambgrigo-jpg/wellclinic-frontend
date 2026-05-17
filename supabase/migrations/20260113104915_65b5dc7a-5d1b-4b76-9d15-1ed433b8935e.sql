-- Replace increment_visit function with input validation and rate limiting
CREATE OR REPLACE FUNCTION public.increment_visit(p_visitor_hash text)
 RETURNS TABLE(total_visits bigint, unique_visitors bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_new_visitor BOOLEAN := false;
  v_last_visit TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Input validation: must be non-empty, alphanumeric, and reasonable length (1-20 chars)
  IF p_visitor_hash IS NULL OR length(p_visitor_hash) < 1 OR length(p_visitor_hash) > 20 THEN
    RAISE EXCEPTION 'Invalid visitor hash: must be 1-20 characters';
  END IF;
  
  -- Validate alphanumeric only
  IF p_visitor_hash !~ '^[a-zA-Z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid visitor hash: must be alphanumeric';
  END IF;
  
  -- Rate limiting: check if last visit was within 5 seconds for same hash
  SELECT v.last_visit INTO v_last_visit 
  FROM public.visitors v 
  WHERE v.visitor_hash = p_visitor_hash;
  
  IF v_last_visit IS NOT NULL AND (now() - v_last_visit) < interval '5 seconds' THEN
    -- Return current stats without incrementing (rate limited)
    RETURN QUERY
    SELECT 
      (SELECT s.stat_value FROM public.site_stats s WHERE s.stat_key = 'total_visits'),
      (SELECT s.stat_value FROM public.site_stats s WHERE s.stat_key = 'unique_visitors');
    RETURN;
  END IF;
  
  -- Try to insert new visitor or update existing
  INSERT INTO public.visitors (visitor_hash, visit_count)
  VALUES (p_visitor_hash, 1)
  ON CONFLICT (visitor_hash) 
  DO UPDATE SET 
    last_visit = now(),
    visit_count = visitors.visit_count + 1;
  
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
$function$;