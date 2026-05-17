-- Fix #1: Restrict visitor tracking data to admins only
DROP POLICY IF EXISTS "Anyone can read visitors" ON public.visitors;
DROP POLICY IF EXISTS "Anyone can read site stats" ON public.site_stats;

CREATE POLICY "Admins can read visitors"
ON public.visitors FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can read site stats"
ON public.site_stats FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Fix #2: Add validation trigger for appointment data
CREATE OR REPLACE FUNCTION public.validate_appointment_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate name (1-100 chars, no script tags)
  IF NEW.name IS NULL OR length(trim(NEW.name)) < 1 OR length(NEW.name) > 100 THEN
    RAISE EXCEPTION 'Invalid name: must be 1-100 characters';
  END IF;
  
  IF NEW.name ~* '<script|javascript:|on\w+=' THEN
    RAISE EXCEPTION 'Invalid name: contains prohibited content';
  END IF;
  
  -- Validate phone (10-20 chars, digits and common formatting)
  IF NEW.phone IS NULL OR length(regexp_replace(NEW.phone, '[^0-9]', '', 'g')) < 10 
     OR length(regexp_replace(NEW.phone, '[^0-9]', '', 'g')) > 15 THEN
    RAISE EXCEPTION 'Invalid phone: must contain 10-15 digits';
  END IF;
  
  -- Validate appointment_time format (HH:MM)
  IF NEW.appointment_time !~ '^\d{1,2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid time format';
  END IF;
  
  -- Validate appointment_date is not in past (allow today)
  IF NEW.appointment_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Appointment date cannot be in the past';
  END IF;
  
  -- Sanitize inputs
  NEW.name := trim(NEW.name);
  NEW.phone := trim(NEW.phone);
  NEW.service := NULLIF(trim(COALESCE(NEW.service, '')), '');
  NEW.doctor := NULLIF(trim(COALESCE(NEW.doctor, '')), '');
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_appointment_trigger ON public.appointments;
CREATE TRIGGER validate_appointment_trigger
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_appointment_data();