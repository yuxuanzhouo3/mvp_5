"use client";

import {
  createBrowserClient,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAnonKeyFromEnv,
  getSupabaseUrlFromEnv,
} from "@/lib/supabase/env";

let supabaseInstance: SupabaseClient | null = null;

export function createClient() {
  if (typeof window === "undefined") {
    return null as unknown as SupabaseClient;
  }

  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = getSupabaseUrlFromEnv();
  const supabaseAnonKey = getSupabaseAnonKeyFromEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or anon key.");
    return null as unknown as SupabaseClient;
  }

  supabaseInstance = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseInstance;
}

export function resetClient() {
  supabaseInstance = null;
}
