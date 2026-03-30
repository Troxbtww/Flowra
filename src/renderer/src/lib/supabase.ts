import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://cmwjppiqngrsaywnscbu.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtd2pwcGlxbmdyc2F5d25zY2J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDk3NjMsImV4cCI6MjA5MDI4NTc2M30.IIXTomUuKfIfPV1_Ml83NwQY8bC_2ps5Tr-x0alrlo0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
