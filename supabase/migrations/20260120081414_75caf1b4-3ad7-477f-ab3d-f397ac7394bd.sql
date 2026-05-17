-- Remove the trigger that uses pg_net (not available in Lovable Cloud)
DROP TRIGGER IF EXISTS trigger_notify_new_appointment ON public.appointments;
DROP FUNCTION IF EXISTS public.notify_new_appointment();