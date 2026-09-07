import path from 'path'
import fs from 'fs'
import { generate, type Mode } from './generator'
import { MEDIATOR_PRESET } from './config'
import { adminAuth, adminDb } from '../../lib/firebaseAdmin'
import { FieldValue } from 'firebase-admin/firestore'
import { loadTemplate } from './utils'
import { MEDIATOR_DEFAULT, COMPETITION_MEDIATOR } from './config'

const MODES: Mode[] = ['human-human', 'human-agent', 'agent-agent']

function todayInEST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

async function checkAndIncrementQuota(email: string, cohorts: number): Promise<{ allowed: boolean; used: number; limit: number }> {
  const configRef = adminDb.collection('toolkit').doc('config')
  const userRef = adminDb.collection('toolkitDevelopers').doc(email)
  const today = todayInEST()

  return adminDb.runTransaction(async (tx) => {
    const [configSnap, userSnap] = await Promise.all([tx.get(configRef), tx.get(userRef)])
    const limit: number = configSnap.data()?.dailySimLimit ?? 10
    const userData = userSnap.data() ?? {}
    const lastDate: string = userData.simCountDate ?? ''
    const currentCount: number = lastDate === today ? (userData.dailySimCount ?? 0) : 0

    if (currentCount >= limit) return { allowed: false, used: currentCount, limit }

    tx.update(userRef, {
      dailySimCount: currentCount + cohorts,
      simCountDate: today,
      lastSimulationRan: FieldValue.serverTimestamp(),
    })
    return { allowed: true, used: currentCount + cohorts, limit }
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { mediatorTemplate, simulationTemplate, assistantTemplate, mediator = 'template', numAgents, p1 = 'participant-1', p2 = 'participant-2', topic = 'covenant_marriage', mode, numCohorts, numUtterances, action = 'create', idToken } = body as {
    mediatorTemplate?: string
    simulationTemplate?: string
    assistantTemplate?: string
    // Which mediator to run with: the caller's own `mediatorTemplate`, the stock
    // preset, or none at all.
    mediator?: 'template' | 'preset' | 'none'
    numAgents?: string | number
    p1?: string
    p2?: string
    topic?: string
    mode?: Mode
    numCohorts?: string | number
    numUtterances?: string | number
    action?: 'create' | 'simulate'
    idToken?: string
  }

  const parsedCohorts = parseInt(String(numCohorts), 10)
  const cohortCount = Number.isFinite(parsedCohorts) && parsedCohorts >= 1 ? parsedCohorts : undefined

  const parsedUtterances = parseInt(String(numUtterances), 10)
  const utteranceCount = Number.isFinite(parsedUtterances) && parsedUtterances >= 1 ? parsedUtterances : undefined

  const parsedAgents = parseInt(String(numAgents), 10)
  const agentCount = Number.isFinite(parsedAgents) && parsedAgents >= 2 ? parsedAgents : undefined

  let mediatorContent: string | null
  if (mediator === 'none') {
    mediatorContent = null
  } else if (mediator === 'preset') {
    mediatorContent = fs.readFileSync(MEDIATOR_PRESET, 'utf8')
  } else if (mediatorTemplate) {
    mediatorContent = mediatorTemplate
  } else if (assistantTemplate) {
    // The assistant toolkit only lets the user edit the assistant, not the mediator —
    // fall back to the competition mediator content (mirrors what the mediator page's
    // "Load Default" merges client-side) so the experiment still has a working mediator.
    mediatorContent = JSON.stringify({ ...loadTemplate(MEDIATOR_DEFAULT), ...loadTemplate(COMPETITION_MEDIATOR) })
  } else {
    return Response.json({ error: 'mediatorTemplate is required' }, { status: 400 })
  }

  if (!mode || !MODES.includes(mode)) {
    return Response.json({ error: `invalid or missing mode: ${mode}` }, { status: 400 })
  }

  if (action === 'simulate') {
    if (!idToken) return Response.json({ error: 'Authentication required' }, { status: 401 })
    let email: string
    try {
      const decoded = await adminAuth.verifyIdToken(idToken)
      email = decoded.email!
    } catch {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const quota = await checkAndIncrementQuota(email, cohortCount ?? 1)
    if (!quota.allowed) {
      return Response.json({ error: `Daily simulation limit reached (${quota.limit}/day). Resets at midnight EST.` }, { status: 429 })
    }
  }

  // const experimentTemplatePath = path.join(process.cwd(), 'public', 'templates', 'competition', 'experiment.yaml')

  // randomize templates over the 5 topics intead of fixing one
  const topicsDir = path.join(process.cwd(), 'public', 'templates', 'topics')
  // const topics = fs.readdirSync(topicsDir)
  // const chosen = topics.includes(topic) ? topic : topics[Math.floor(Math.random() * topics.length)]
  const topics = ['congestion_pricing', 'covenant_marriage'] // hardcoded 2 for development, used the other 3 as the testing.
  // A simulation template brings its own topic, so it always runs against the
  // dedicated "simulation" template; mediator-toolkit runs keep randomizing.
  const chosen = simulationTemplate ? 'simulation' : topics[Math.floor(Math.random() * topics.length)]
  const experimentTemplatePath = path.join(topicsDir, chosen, 'experiment.yaml')

  try {
    const result = await generate(p1, p2, experimentTemplatePath, mediatorContent, mode, cohortCount, utteranceCount, action, simulationTemplate, agentCount, assistantTemplate)
    return Response.json(result)
  } catch (e) {
    console.error('Error in create-experiment:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
