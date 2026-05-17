-- Enable realtime for appointments table to support live notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;