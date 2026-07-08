/** @type {{ supabaseUrl: string, supabaseAnonKey: string }} */
export const config = {
  supabaseUrl: 'https://prgvjrhvdpfxjakxusoh.supabase.co',
  supabaseAnonKey: 'sb_publishable_aTHhBdnBW6LhFX-lIUnvGA_NoVFJ2Sd',
}

export function isConfigured() {
  return (
    config.supabaseUrl.startsWith('https://') &&
    !config.supabaseAnonKey.includes('YOUR_')
  )
}
