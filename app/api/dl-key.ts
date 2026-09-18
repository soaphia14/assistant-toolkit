import {readFileSync, existsSync} from 'fs'
import path from 'path'

const KEY = 'DL_API_KEY'

const mask = (v: string) => (v ? `${v.slice(0, 12)}…${v.slice(-4)} (len ${v.length})` : '(empty)')

let dumped = false

/**
 * Returns DL_API_KEY and reports which value is actually in play.
 *
 * TrAuSt's run_locally.sh mints a new key on every start, and sync-dl-key
 * copies it into this repo's .env. But a DL_API_KEY exported in the shell wins
 * over .env in Next, so a stale export keeps the toolkit sending a dead key
 * long after .env is fresh. Say that out loud instead of leaving it to a
 * puzzling "Invalid or expired API key" from the API.
 */
export function resolveDlApiKey(): string {
  const inUse = process.env[KEY] ?? ''

  const dotenvPath = path.join(process.cwd(), '.env')
  const line = existsSync(dotenvPath)
    ? readFileSync(dotenvPath, 'utf8').split('\n').find((l) => l.startsWith(`${KEY}=`))
    : undefined
  const inFile = line ? line.slice(KEY.length + 1).trim() : ''

  if (!dumped) {
    dumped = true
    console.log(`[dl-key] in use: ${mask(inUse)}`)
    console.log(`[dl-key] .env:   ${mask(inFile)}  (${dotenvPath})`)
  }

  if (!inUse) {
    console.warn(`[dl-key] ${KEY} is not set at all.`)
  } else if (inFile && inUse !== inFile) {
    console.warn(
      `[dl-key] MISMATCH: the ${KEY} in use is NOT the one in .env — a shell ` +
        `export is overriding it. Run 'unset ${KEY}' in this terminal, then ` +
        `restart 'npm run dev'.`,
    )
  }

  return inUse
}
