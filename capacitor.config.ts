import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aichat.webui',
  appName: 'AI Chat',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    // For debugging: uncomment to enable live reload from dev server
    // url: 'http://192.168.1.X:5173',
    // cleartext: true
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000'
  }
};

export default config;
