// Cloudflare Pages Function: /api/gnfc-roster?league=A2&team=Team%20Name
import { getDraftLeagueId, normalizeDraftLeagueKey } from "../../src/config/fantraxDraftLeagues.js"

const API_BASE = "https://www.fantrax.com/fxea/general/"
const text = value => String(value ?? "").trim()
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value)
const exactName = value => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ")
const looseName = value => exactName(value).normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "")

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  })
}

async function fetchFantrax(endpoint, params, ttl, context, validate) {
  const url = new URL(endpoint, API_BASE)
  url.search = new URLSearchParams(params).toString()
  const cache = globalThis.caches?.default
  const key = new Request(url.toString())
  if (cache) {
    const cached = await cache.match(key)
    if (cached) return cached.json()
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "GNFC-Draft-Results/1.0" },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Fantrax ${endpoint} returned HTTP ${response.status}.`)
    let data
    try { data = await response.json() }
    catch { throw new Error(`Fantrax ${endpoint} did not return JSON.`) }
    if (!validate(data)) throw new Error(`Fantrax ${endpoint} returned an unexpected response.`)
    if (cache) {
      context.waitUntil(cache.put(key, new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
      })).catch(() => {}))
    }
    return data
  } finally { clearTimeout(timeout) }
}

export function listRosterTeams(rosters) {
  return Object.entries(rosters)
    .filter(([, roster]) => isRecord(roster) && typeof roster.teamName === "string")
    .map(([teamId, roster]) => ({ teamId, teamName: text(roster.teamName) }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName))
}

export function resolveRosterTeam(teams, teamName, teamId = "") {
  if (teamId) return teams.filter(team => team.teamId === teamId)
  const exact = teams.filter(team => exactName(team.teamName) === exactName(teamName))
  if (exact.length) return exact
  const normalized = looseName(teamName)
  return normalized ? teams.filter(team => looseName(team.teamName) === normalized) : []
}

export function normalizeTeamRoster(league, leagueId, selected, response, playerIds) {
  const playerMap = new Map(Object.entries(playerIds)
    .filter(([, player]) => isRecord(player))
    .map(([id, player]) => [text(player.fantraxId || id), player]))
  const roster = response.rosters[selected.teamId]
  if (!Array.isArray(roster?.rosterItems)) throw new Error("Fantrax returned an invalid team roster.")
  const statusOrder = { ACTIVE: 0, RESERVE: 1, INJURED_RESERVE: 2 }
  const statusLabels = { ACTIVE: "Active", RESERVE: "Reserve", INJURED_RESERVE: "IR", MINORS: "Minors" }
  const players = roster.rosterItems
    .filter(item => isRecord(item) && text(item.id))
    .map((item, index) => {
      const playerId = text(item.id)
      const player = playerMap.get(playerId)
      const status = text(item.status)
      return {
        key: `${playerId}-${index}`,
        playerId,
        playerName: text(player?.name) || `Unknown player (${playerId})`,
        nbaTeam: text(player?.team),
        position: text(player?.position),
        slot: text(item.position),
        status,
        statusLabel: statusLabels[status] || status.replace(/_/g, " ").toLowerCase() || "Unspecified",
      }
    })
    .sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) || a.playerName.localeCompare(b.playerName))
  return {
    league,
    leagueId,
    teamId: selected.teamId,
    teamName: selected.teamName,
    period: response.period ?? null,
    players,
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
  if (!leagueId) return json({ error: "A current roster is not configured for this league." }, 404)
  const teamName = text(url.searchParams.get("team"))
  const teamId = text(url.searchParams.get("teamId"))
  if ((!teamName && !teamId) || teamName.length > 250 || teamId.length > 100) {
    return json({ error: "A valid team name or Fantrax team ID is required." }, 400)
  }
  try {
    // Omitting period asks Fantrax for its current/upcoming roster period.
    const rosters = await fetchFantrax("getTeamRosters", { leagueId }, 60, context,
      data => isRecord(data?.rosters))
    const teams = listRosterTeams(rosters.rosters)
    if (!teams.length) return json({ error: "No team rosters are available for this league yet." }, 404)
    const matches = resolveRosterTeam(teams, teamName, teamId)
    if (matches.length !== 1) return json({
      code: "TEAM_SELECTION_REQUIRED",
      error: matches.length > 1
        ? "More than one Fantrax team matches this name. Select the correct team below."
        : "Choose the matching Fantrax team below to load this roster.",
      leagueId,
      teams,
    }, matches.length > 1 ? 409 : 404)
    const players = await fetchFantrax("getPlayerIds", { sport: "NBA" }, 3600, context,
      data => isRecord(data) && Object.values(data).some(player => isRecord(player) && typeof player.name === "string"))
    return json(normalizeTeamRoster(league, leagueId, matches[0], rosters, players))
  } catch (error) {
    const timeout = error?.name === "AbortError"
    return json({ error: timeout ? "Fantrax took too long to respond. Please try again." : error?.message || "Unable to load the current roster." }, timeout ? 504 : 502)
  }
}
