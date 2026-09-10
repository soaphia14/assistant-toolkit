export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const title = searchParams.get('title')?.trim()
  if (!title) {
    return Response.json({ error: 'title is required' }, { status: 400 })
  }

  try {
    const rawRes = await fetch(`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`)
    const body = rawRes.ok ? await rawRes.text() : ''

    if (!rawRes.ok || !body.trim()) {
      return Response.json({ error: `No Wikipedia article found for "${title}"` }, { status: 404 })
    }

    const link = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=view`
    return Response.json({ title, body, link })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
