import {resolveDlApiKey} from '../dl-key'
import { BASE_URL } from '../create-experiment/config'

const TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'TRANSFER_TIMEOUT',
  'TRANSFER_FAILED',
  'TRANSFER_DECLINED',
  'ATTENTION_TIMEOUT',
  'BOOTED_OUT',
  'DELETED',
])

export async function GET(request: Request) {
  const apiKey = resolveDlApiKey()
  if (!apiKey) return Response.json({ error: 'DL_API_KEY not set' }, { status: 500 })

  const expId = new URL(request.url).searchParams.get('experimentId')
  if (!expId) return Response.json({ error: 'experimentId query param is required' }, { status: 400 })

  const res = await fetch(`${BASE_URL}/experiments/${expId}/export`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  })
  const data = await res.json()
  if (!res.ok) return Response.json(data, { status: res.status })

  const participants = Object.values(data?.participantMap ?? {}) as Array<{ profile?: { currentStatus?: string; currentCohortId?: string } }>
  const allStatuses = participants.map((p) => p?.profile?.currentStatus)
  const completed = allStatuses.length > 0 && allStatuses.every((s) => s !== undefined && TERMINAL_STATUSES.has(s))

  // group statuses by cohort instead of a single flat list
  const statuses: Record<string, (string | undefined)[]> = {}
  for (const p of participants) {
    const cohort = p?.profile?.currentCohortId ?? 'unknown'
    ;(statuses[cohort] ??= []).push(p?.profile?.currentStatus)
  }

  const fieldsOmitted = new Set(['shouldConcede', 'concessionScore', 'concessionScoreReason'])
  const clean = JSON.parse(JSON.stringify(data, (k, v) => fieldsOmitted.has(k) ? undefined : v))

  return Response.json({ completed, statuses, export: clean })

}
