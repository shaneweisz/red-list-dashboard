import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Server-side Supabase client for use in API routes.
 * Uses the anon key with RLS — species data is publicly readable.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
