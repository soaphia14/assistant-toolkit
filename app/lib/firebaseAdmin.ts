import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

if (!getApps().length) {
  // Local dev runs against the Firestore/Auth emulators (see .env) and has no
  // real service account — only load one when actually talking to production.
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST
  if (usingEmulator) {
    initializeApp({ projectId: 'convoarenadev' })
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)
    initializeApp({ credential: cert(serviceAccount) })
  }
}

export const adminDb = getFirestore()
export const adminAuth = getAuth()
