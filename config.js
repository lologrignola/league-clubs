/** @type {{ supabaseUrl: string, supabaseAnonKey: string, defaultClubInviteCode?: string, defaultClubTag?: string }} */
export const config = {
  supabaseUrl: 'https://prgvjrhvdpfxjakxusoh.supabase.co',
  supabaseAnonKey: 'sb_publishable_aTHhBdnBW6LhFX-lIUnvGA_NoVFJ2Sd',
  defaultClubInviteCode: 'LEAGCLUB',
  defaultClubTag: 'LEAGC',
}

export function isConfigured() {
  return (
    config.supabaseUrl.startsWith('https://') &&
    !config.supabaseAnonKey.includes('YOUR_')
  )
}
