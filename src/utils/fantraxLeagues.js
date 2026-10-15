// League membership and IDs come from the ranking spreadsheet's IT tab.
import { RANKING_SHEET_ID, RANKING_GIDS } from "../config/rankingGids"

const CACHE_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15000

export function normalizeLeagueKey(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^Α/, "A")
    .replace(/^Β/, "B")
    .replace(/^G/, "Γ")
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ""
  let quoted = false
  const csv = String(text).replace(/^\uFEFF/, "")

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (!quoted && char === ",") {
      row.push(value)
      value = ""
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && csv[i + 1] === "\n") i++
      row.push(value)
      rows.push(row)
      row = []
      value = ""
    } else {
      value += char
    }
  }

  if (quoted) throw new Error("Invalid CSV in the IT tab")
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  return rows
}

export function parseFantraxLeaguesCsv(text) {
  const rows = parseCsv(text)
  const headerIndex = rows.findIndex(row => {
    const headers = row.map(cell => cell.trim().toLowerCase())
    return headers.includes("league") && headers.includes("code")
  })
  if (headerIndex < 0) throw new Error("The IT tab needs League and Code column headers")

  const headers = rows[headerIndex].map(cell => cell.trim().toLowerCase())
  const leagueColumn = headers.indexOf("league")
  const codeColumn = headers.indexOf("code")
  const byKey = new Map()
  const byId = new Map()

  for (const row of rows.slice(headerIndex + 1)) {
    const key = normalizeLeagueKey(row[leagueColumn])
    // Ignore helper rows and unrelated columns in the IT tab.
    if (!/^[ABΓR][1-9]\d*$/.test(key)) continue

    const leagueId = String(row[codeColumn] ?? "").trim()
    if (!/^[a-z0-9]{16}$/.test(leagueId)) {
      throw new Error(`Invalid Fantrax league ID for ${key} in the IT tab`)
    }
    if (byKey.has(key) && byKey.get(key) !== leagueId) {
      throw new Error(`Conflicting Fantrax IDs for ${key} in the IT tab`)
    }
    if (byId.has(leagueId) && byId.get(leagueId) !== key) {
      throw new Error(`Fantrax ID shared by ${byId.get(leagueId)} and ${key} in the IT tab`)
    }
    byKey.set(key, leagueId)
    byId.set(leagueId, key)
  }

  if (!byKey.size) throw new Error("No Fantrax leagues found in the IT tab")
  return Array.from(byKey, ([key, leagueId]) => ({ key, leagueId }))
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    // Read the body before clearing the timeout, so stalled downloads also stop.
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function cacheRequest(load) {
  let cached
  let expiresAt = 0
  let pending
  return function getCached() {
    if (cached !== undefined && Date.now() < expiresAt) return Promise.resolve(cached)
    if (pending) return pending
    pending = Promise.resolve().then(load).then(value => {
      cached = value
      expiresAt = Date.now() + CACHE_MS
      return value
    }).finally(() => { pending = undefined })
    return pending
  }
}

export const getFantraxLeagues = cacheRequest(async () => {
  if (!RANKING_SHEET_ID || RANKING_GIDS.IT == null) {
    throw new Error("Missing ranking spreadsheet or IT tab configuration")
  }
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(RANKING_SHEET_ID)}/export?format=csv&gid=${encodeURIComponent(RANKING_GIDS.IT)}`
  return parseFantraxLeaguesCsv(await fetchWithTimeout(url))
})

function cleanLeagueDisplayName(value) {
  let text = String(value ?? "")
  try {
    text = decodeURIComponent(escape(text))
  } catch {
    // Keep correctly encoded Unicode text as returned by Fantrax.
  }
  return text.replace(/^GNFC\s*/i, "").replace(/\s*-\s*/g, " - ").trim()
}

export const getFantraxLeagueNames = cacheRequest(async () => {
  const leagues = await getFantraxLeagues()
  const results = await Promise.all(
    leagues.filter(({ key }) => /^[ABΓ]/.test(key)).map(async ({ key, leagueId }) => {
      try {
        const url = `https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}`
        const data = JSON.parse(await fetchWithTimeout(url))
        const name = cleanLeagueDisplayName(data?.leagueName)
        return name ? [key, name] : null
      } catch {
        return null
      }
    })
  )
  const entries = results.filter(Boolean)
  if (!entries.length) throw new Error("Fantrax league names are temporarily unavailable")
  return Object.fromEntries(entries)
})
