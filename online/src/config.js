// Firebase web config. Fill this in (Firebase console → Project settings →
// Your apps → Web app → SDK setup and configuration → Config) to enable
// online rooms. These values are public by design; security comes from
// database.rules.json. Leave apiKey empty to run in local demo mode.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB8PmT316ne_N_4lc6fP2T-azLztvFTx7o',
  authDomain: 'draft-arena-5045a.firebaseapp.com',
  databaseURL: 'https://draft-arena-5045a-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'draft-arena-5045a',
  storageBucket: 'draft-arena-5045a.firebasestorage.app',
  messagingSenderId: '655396515408',
  appId: '1:655396515408:web:0deab538c4ab43995d6b55',
};

// Optional: Web Push (FCM) key pair for background notifications.
// Firebase console → Project settings → Cloud Messaging → Web Push certificates.
export const VAPID_KEY = '';

export const FIREBASE_SDK_VERSION = '12.4.0';
