const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = Object.values(config).every(Boolean);
let firebaseServicesPromise;

export async function saveSessionSummary(summary) {
  if (!firebaseReady) throw new Error('Firebase is not configured for this deployment.');
  firebaseServicesPromise ??= Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]).then(([appSdk, authSdk, firestoreSdk]) => {
    const app = appSdk.initializeApp(config);
    return {
      auth: authSdk.getAuth(app),
      db: firestoreSdk.getFirestore(app),
      authSdk,
      firestoreSdk,
    };
  });
  const { auth, db, authSdk, firestoreSdk } = await firebaseServicesPromise;
  const credential = auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user;
  return firestoreSdk.addDoc(firestoreSdk.collection(db, 'users', credential.uid, 'sessions'), {
    ...summary,
    createdAt: firestoreSdk.serverTimestamp(),
  });
}
