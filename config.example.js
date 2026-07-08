/** @type {{ supabaseUrl: string, supabaseAnonKey: string, defaultClubInviteCode?: string, defaultClubTag?: string }} */
export const config = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_OR_PUBLISHABLE_KEY',
  defaultClubInviteCode: '',
  defaultClubTag: '',
}

export function isConfigured() {
  return (
    config.supabaseUrl.startsWith('https://') &&
    !config.supabaseAnonKey.includes('YOUR_')
  )
}
