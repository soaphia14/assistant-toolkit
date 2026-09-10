import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../../lib/firebaseAdmin'
import { DUPLICATE_NAME_ERROR, isAllowedCollection, templatesRef, verifyEmail } from './_lib'

// GET /api/templates?collection=mediators — list all saved templates for the user
export async function GET(req: Request) {
  const email = await verifyEmail(req)
  if (!email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const collection = new URL(req.url).searchParams.get('collection')
  if (!isAllowedCollection(collection)) return Response.json({ error: 'invalid collection' }, { status: 400 })

  const snap = await templatesRef(email, collection).orderBy('updatedAt', 'desc').get()

  const templates = snap.docs.map(d => ({
    id: d.id,
    name: d.data().name as string,
    updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() ?? null,
  }))

  return Response.json({ templates, count: templates.length })
}

// POST /api/templates — create a new template (name must be unique within the collection)
export async function POST(req: Request) {
  const email = await verifyEmail(req)
  if (!email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { collection, name, content } = await req.json().catch(() => ({})) as {
    collection?: string; name?: string; content?: string
  }
  if (!isAllowedCollection(collection)) return Response.json({ error: 'invalid collection' }, { status: 400 })
  const trimmedName = name?.trim()
  if (!trimmedName) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!content) return Response.json({ error: 'content is required' }, { status: 400 })

  const ref = templatesRef(email, collection)

  try {
    const result = await adminDb.runTransaction(async (t) => {
      const dup = await t.get(ref.where('name', '==', trimmedName).limit(1))
      if (!dup.empty) throw new Error(DUPLICATE_NAME_ERROR)

      const docRef = ref.doc()
      const now = FieldValue.serverTimestamp()
      t.set(docRef, { name: trimmedName, content, createdAt: now, updatedAt: now })
      t.set(docRef.collection('history').doc(), { content, savedAt: now })
      return { id: docRef.id }
    })

    return Response.json({ id: result.id, name: trimmedName }, { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message === DUPLICATE_NAME_ERROR) {
      return Response.json(
        { error: DUPLICATE_NAME_ERROR, message: `A template named "${trimmedName}" already exists.` },
        { status: 409 },
      )
    }
    throw e
  }
}

// PATCH /api/templates — save content and/or rename an existing template
export async function PATCH(req: Request) {
  const email = await verifyEmail(req)
  if (!email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { collection, id, name, content } = await req.json().catch(() => ({})) as {
    collection?: string; id?: string; name?: string; content?: string
  }
  if (!isAllowedCollection(collection)) return Response.json({ error: 'invalid collection' }, { status: 400 })
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const trimmedName = name?.trim()
  if (name !== undefined && !trimmedName) return Response.json({ error: 'name cannot be empty' }, { status: 400 })
  if (trimmedName === undefined && content === undefined) {
    return Response.json({ error: 'name or content is required' }, { status: 400 })
  }

  const ref = templatesRef(email, collection)
  const docRef = ref.doc(id)

  try {
    await adminDb.runTransaction(async (t) => {
      const snap = await t.get(docRef)
      if (!snap.exists) throw new Error('not_found')

      const now = FieldValue.serverTimestamp()
      const update: Record<string, unknown> = { updatedAt: now }

      if (trimmedName !== undefined && trimmedName !== snap.data()!.name) {
        const dup = await t.get(ref.where('name', '==', trimmedName).limit(1))
        if (!dup.empty && dup.docs[0].id !== id) throw new Error(DUPLICATE_NAME_ERROR)
        update.name = trimmedName
      }
      if (content !== undefined) {
        update.content = content
        t.set(docRef.collection('history').doc(), { content, savedAt: now })
      }

      t.update(docRef, update)
    })

    return Response.json({ id, name: trimmedName, saved: true })
  } catch (e) {
    if (e instanceof Error && e.message === DUPLICATE_NAME_ERROR) {
      return Response.json(
        { error: DUPLICATE_NAME_ERROR, message: `A template named "${trimmedName}" already exists.` },
        { status: 409 },
      )
    }
    if (e instanceof Error && e.message === 'not_found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

// DELETE /api/templates?collection=mediators&id=... — delete a saved template
export async function DELETE(req: Request) {
  const email = await verifyEmail(req)
  if (!email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const collection = url.searchParams.get('collection')
  const id = url.searchParams.get('id')
  if (!isAllowedCollection(collection)) return Response.json({ error: 'invalid collection' }, { status: 400 })
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  await templatesRef(email, collection).doc(id).delete()

  return Response.json({ deleted: true })
}
