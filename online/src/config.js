// Firebase web config. Fill this in (Firebase console → Project settings →
// Your apps → Web app → SDK setup and configuration → Config) to enable
// online rooms. These values are public by design; security comes from
// database.rules.json. Leave apiKey empty to run in local demo mode.
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  databaseURL: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// Optional: Web Push (FCM) key pair for background notifications.
// Firebase console → Project settings → Cloud Messaging → Web Push certificates.
export const VAPID_KEY = '';

export const FIREBASE_SDK_VERSION = '12.4.0';
