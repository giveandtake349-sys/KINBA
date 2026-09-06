import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kinba.app',
  appName: 'Kinba',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*.supabase.co', '*.onrender.com'],
  }
};

export default config;
