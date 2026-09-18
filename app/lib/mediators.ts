'use client'

import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { API_BASE } from './config'

// One mediator saved from the Mediator Toolkit. Only the identity is needed
// here: the Simulation Toolkit lists mediators by name exactly as it lists
// agent participants, so the template body is never read.
export type SavedMediator = { id: string; name: string }

/**
 * The user's saved mediators.
 *
 * Mediators live in the same per-user template store the Mediator Toolkit saves
 * through, so saving one there makes it selectable in the Pairings editor.
 * Mirrors `useSavedAgents`, refresh on focus included, so a save made in another
 * tab lands without a reload.
 */
export function useSavedMediators() {
  const [mediators, setMediators] = useState<SavedMediator[]>([])
  const [signedIn, setSignedIn] = useState(false)

  const refresh = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/templates?collection=mediators`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setMediators((data.templates ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })))
    } catch (e) {
      console.warn('useSavedMediators: listing mediators failed:', e)
    }
  }, [])

  useEffect(() => onAuthStateChanged(auth, user => {
    setSignedIn(!!user)
    if (user) refresh()
    else setMediators([])
  }), [refresh])

  useEffect(() => {
    if (!signedIn) return
    const handler = () => refresh()
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [signedIn, refresh])

  return { mediators, signedIn, refresh }
}
