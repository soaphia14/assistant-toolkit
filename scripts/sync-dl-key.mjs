/**
 * Copies DL_API_KEY from the ConvoArena (TrAuSt) repo's .env into this one's.
 *
 * TrAuSt's run_locally.sh seeds a freshly generated key into the Firestore
 * emulator on every start and writes it to TrAuSt/.env only. The emulator drops
 * the previous session's keys, so without this sync the toolkit keeps sending a
 * dead key and the API answers "Invalid or expired API key".
 *
 * Runs automatically before `npm run dev` (npm's predev hook). It never blocks
 * the dev server: anything missing is a warning, not a failure, so working
 * against production (where DL_API_KEY is set by hand) still boots.
 */
import {readFileSync, writeFileSync, existsSync} from 'fs'
import path from 'path'

const KEY = 'DL_API_KEY'
// Sibling checkout by default; override when the backend lives elsewhere.
const SOURCE = process.env.DL_ENV_PATH ?? path.join(process.cwd(), '..', 'TrAuSt', '.env')
const TARGET = path.join(process.cwd(), '.env')

const warn = (msg) => console.warn(`sync-dl-key: ${msg}; leaving ${KEY} as is`)
const valueOf = (line) => line.slice(KEY.length + 1).trim()

if (!existsSync(SOURCE)) {
  warn(`${SOURCE} not found`)
  process.exit(0)
}
if (!existsSync(TARGET)) {
  warn(`${TARGET} not found`)
  process.exit(0)
}

const sourceLine = readFileSync(SOURCE, 'utf8').split('\n').find((l) => l.startsWith(`${KEY}=`))
if (!sourceLine || !valueOf(sourceLine)) {
  warn(`no ${KEY} in ${SOURCE}`)
  process.exit(0)
}
const apiKey = valueOf(sourceLine)

// Rewrite the one line so the rest of .env (service account, etc.) is untouched.
const lines = readFileSync(TARGET, 'utf8').split('\n')
const idx = lines.findIndex((l) => l.startsWith(`${KEY}=`))

if (idx >= 0 && valueOf(lines[idx]) === apiKey) process.exit(0)

if (idx >= 0) lines[idx] = `${KEY}=${apiKey}`
else lines.push(`${KEY}=${apiKey}`)
writeFileSync(TARGET, lines.join('\n'))

console.log(`sync-dl-key: synced ${KEY} (${apiKey.slice(0, 16)}...) from ${SOURCE}`)
