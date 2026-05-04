// ─── Supabase Client Configuration ───────────────────────────
// Replace these with your actual Supabase project credentials
// Found in: Supabase Dashboard → Settings → API

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bmcbsrgzorktizgkhilw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtY2Jzcmd6b3JrdGl6Z2toaWx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDkzOTQsImV4cCI6MjA5MzQyNTM5NH0.6V2IAnyKEV20wsyLEuebFv-vfCNhCETZopQOsS-jx1I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
