import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

/**
 * Server-side Supabase client for use in API routes.
 * Uses the anon key with RLS — species data is publicly readable.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
