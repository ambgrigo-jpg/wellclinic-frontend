-- Fix: Remove public read access to appointments table
-- Appointments contain sensitive patient data (names, phones, medical services)
-- Only INSERT should be allowed for public users to book appointments

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can read appointments" ON public.appointments;

-- The INSERT policy remains to allow appointment booking without auth
-- "Anyone can create appointments" policy is kept