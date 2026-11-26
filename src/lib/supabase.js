import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
let passwordResetInProgress = false

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export function setPasswordResetInProgress(inProgress) {
  passwordResetInProgress = inProgress
}

export function isPasswordResetInProgress() {
  return passwordResetInProgress
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
