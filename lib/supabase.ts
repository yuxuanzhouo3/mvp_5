import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xznbklxpjusvamjpflyh.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmJrbHhwanVzdmFtanBmbHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MTAxMDgsImV4cCI6MjA2ODA4NjEwOH0.YMqUcA-SBnLnoSIkqniKNHJDpsgPdFa60KlIfbjSoUI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Generation {
  id: number
  user_id?: string
  type: 'text' | 'image' | 'audio' | 'video'
  prompt: string
  content: string
  settings: any
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  email?: string
  credits: number
  created_at: string
  updated_at: string
} 