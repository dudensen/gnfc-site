// Cloudflare Pages Function: /api/gnfc-draft?league=A2
import { getDraftLeagueId, normalizeDraftLeagueKey } from "../../src/config/fantraxDraftLeagues.js"

const API_BASE = "https://www.fantrax.com/fxea/general/"

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function text(value) {
  return String(value ?? "").trim()
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

async function fetchFantrax(endpoint, params, ttl, context, validate) {
  const url = new URL(endpoint, API_BASE)
  url.search = new URLSearchParams(params).toString()
  const cache = globalThis.caches?.default
  const cacheKey = new Request(url.toString(), { method: "GET" })
  if (cache) {
    const cached = await cache.match(cacheKey)
    if (cached) return cached.json()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "GNFC-Draft-Results/1.0",
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Fantrax ${endpoint} returned HTTP ${response.status}.`)

    let data
    try {
      data = await response.json()
    } catch {
      throw new Error(`Fantrax ${endpoint} did not return JSON.`)
    }
    if (!validate(data)) throw new Error(`Fantrax ${endpoint} returned an unexpected response.`)

    if (cache) {
      const cachedResponse = new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
      })
      context.waitUntil(cache.put(cacheKey, cachedResponse).catch(() => {}))
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

export function normalizeDraftResults(league, leagueId, draft, info, playerIds) {
  const players = new Map()
  for (const [key, player] of Object.entries(playerIds)) {
    if (!isRecord(player)) continue
    players.set(text(player.fantraxId || key), player)
  }

  const picks = (draft.draftPicks || [])
    .filter(pick => isRecord(pick) && text(pick.playerId))
    .map((pick, index) => {
      const playerId = text(pick.playerId)
      const teamId = text(pick.teamId)
      const player = players.get(playerId)
      const team = info.teamInfo[teamId]
      return {
        key: `${text(pick.pick)}-${playerId}-${index}`,
        overall: positiveInteger(pick.pick),
        round: positiveInteger(pick.round),
        pickInRound: positiveInteger(pick.pickInRound),
        playerId,
        playerName: text(player?.name) || `Unknown player (${playerId})`,
        position: text(player?.position),
        nbaTeam: text(player?.team),
        teamId,
        teamName: text(team?.name) || `Unknown team (${teamId || "unassigned"})`,
      }
    })
    .sort((a, b) =>
      (a.overall ?? Infinity) - (b.overall ?? Infinity) ||
      (a.round ?? Infinity) - (b.round ?? Infinity) ||
      (a.pickInRound ?? Infinity) - (b.pickInRound ?? Infinity)
    )

  return {
    league,
    leagueId,
    leagueName: text(info.leagueName) || league,
    draftState: text(draft.draftState),
    draftDate: text(draft.draftDate),
    picks,
    fetchedAt: new Date().toISOString(),
  }
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    const response = json({ error: "Method not allowed." }, 405)
    response.headers.set("Allow", "GET")
    return response
  }

  const url = new URL(context.request.url)
  const league = normalizeDraftLeagueKey(url.searchParams.get("league"))
  const leagueId = getDraftLeagueId(league)
  if (!leagueId) return json({ error: "Draft results are not configured for this league." }, 404)

  try {
    const [draft, info, players] = await Promise.all([
      fetchFantrax("getDraftResults", { leagueId }, 60, context,
        data => isRecord(data) &&
          (Array.isArray(data.draftPicks) ||
            (data.draftPicks == null && typeof data.draftState === "string"))),
      fetchFantrax("getLeagueInfo", { leagueId, excludePlayerInfo: "true" }, 3600, context,
        data => isRecord(data?.teamInfo)),
      fetchFantrax("getPlayerIds", { sport: "NBA" }, 3600, context,
        data => isRecord(data) && Object.values(data).some(player => isRecord(player) && typeof player.name === "string")),
    ])
    return json(normalizeDraftResults(league, leagueId, draft, info, players))
  } catch (error) {
    const timedOut = error?.name === "AbortError"
    return json({
      error: timedOut
        ? "Fantrax took too long to respond. Please try again."
        : error?.message || "Unable to load draft results from Fantrax.",
    }, timedOut ? 504 : 502)
  }
}
