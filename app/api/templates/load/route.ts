import { isAllowedCollection, templatesRef, verifyEmail } from '../_lib'

// GET /api/templates/load?collection=mediators&id=... — load one saved template's content
export async function GET(req: Request) {
  const email = await verifyEmail(req)
  if (!email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const collection = url.searchParams.get('collection')
  const id = url.searchParams.get('id')
  if (!isAllowedCollection(collection)) return Response.json({ error: 'invalid collection' }, { status: 400 })
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  const snap = await templatesRef(email, collection).doc(id).get()
  if (!snap.exists) return Response.json({ error: 'Not found' }, { status: 404 })

  const data = snap.data()!
  return Response.json({ id: snap.id, name: data.name, content: data.content })
}
