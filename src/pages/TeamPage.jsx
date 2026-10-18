// src/pages/TeamPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTeams } from "../hooks/useTeams"
import { getDraftLeagueId } from "../config/fantraxDraftLeagues"
import { RANKING_SHEET_ID, RANKING_GIDS } from "../config/rankingGids"

/* ----------------------------- sheet sources ----------------------------- */

const GENERAL_SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const GENERAL_GID = "2143242587"

const OVERVIEW_SHEET_ID = "1GGSJSL2aJ2UEXpHGU7NDOdN0CeOHeK0HzuxXOGqOUnA"
const OVERVIEW_GID = "532207451"

const CUP_SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const CUP_GID = "784537326"

const TROPHY_IMAGES = {
  leagueA: "/awards/league-winner-a.webp",
  leagueB: "/awards/league-winner-b.webp",
  leagueG: "/awards/league-winner-g.webp",
  divisionWinner: "/awards/division-winner.webp",
  cl: "/awards/champions-league.webp",
  cup: "/awards/cup.webp",
}

const TROPHY_GRAVITY = {
  divisionWinner: 1,

  championA: 3,
  championsLeague: 4,
  cup: 5,
  leagueWinnerA: 6,
  championB: 7,
  leagueWinnerB: 8,
  championG: 9,
  leagueWinnerG: 20,
}

function csvExportUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

/* ----------------------------- history tabs ----------------------------- */

const HISTORY_YEARS = Object.entries(RANKING_GIDS)
  .filter(([key]) => /^\d{4}$/.test(String(key)))
  .sort((a, b) => Number(b[0]) - Number(a[0]))

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function normalizeLoose(x) {
  return s(x)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

function isJunkKey(k) {
  const key = String(k || "").trim()
  if (!key) return true
  if (key.startsWith("col_")) return true
  if (key.toUpperCase().includes("THE GREEK NBA FANTASY CHAMPIONSHIP GENERAL INFO")) return true
  if (key === "ar") return true
  return false
}

function getFirst(raw, baseKey) {
  const direct = String(raw?.[baseKey] ?? "").trim()
  if (direct) return direct
  for (let i = 2; i <= 6; i++) {
    const v = String(raw?.[`${baseKey}__${i}`] ?? "").trim()
    if (v) return v
  }
  return ""
}

function toRank(v) {
  const x = s(v)
  if (!x) return null
  const n = Number(x.replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? n : null
}

function val(v) {
  const x = s(v)
  return x ? x : "—"
}

function hasLetters(x) {
  return /[A-Za-zΑ-Ωα-ω]/.test(s(x))
}

function looksFilledValue(v) {
  const x = s(v)
  if (!x) return false
  if (["—", "-", "0", "0.0"].includes(x)) return false
  return true
}

function toNumberMaybe(v) {
  const x = s(v).replace(",", ".").replace(/[^\d.-]/g, "")
  if (!x) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function yearsText(years) {
  return years.join(", ")
}

function uniqSortedYears(values) {
  return [...new Set(values.map(Number).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b)
}

function isMissingCupValue(v) {
  const x = norm(v)
  return !x || x === "0" || x === "—" || x === "-"

  
}

function slugifyTeam(name) {
  return s(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-zA-Z0-9Α-Ωα-ω- ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
}

function teamLogoSrc(teamName) {
  return `/logos/${slugifyTeam(teamName)}.webp`
}

/* ----------------------------- scoring helpers ----------------------------- */

function normalizeCupDisplay(value) {
  const x = normalizeLoose(value)
  if (!x) return s(value)

  if (x.includes("winner")) return "Winner"
  if (x === "final" || x.includes(" final ") || x.startsWith("final ")) return "Final"
  if (x.includes("semifinal") || x.includes("semi final") || x.includes("Semifinals") || x.includes("final 4") || x === "4") return "4"
  if (x.includes("quarter") || x.includes("final 8") || x === "8") return "Quarterfinals"
  if (x.includes("round of 16") || x.includes("last 16") || x === "16") return "Last 16"
  if (x.includes("round of 32") || x.includes("last 32") || x === "32") return "Last 32"

  if (x.includes("3rd round") || x.includes("third round") || x.includes("3rd r")) return "3rd Round"
  if (x.includes("2nd round") || x.includes("second round") || x.includes("2nd r")) return "2nd Round"
  if (x.includes("1st round") || x.includes("first round") || x.includes("1st r")) return "1st Round"

  return s(value)
}

function placementScore(value) {
  const x = normalizeLoose(value)
  if (!x) return -1

  // top results
  if (x.includes("winner")) return 100
  if (x.includes("champion")) return 95

  // final
  if (x === "final" || x.includes(" final ") || x.startsWith("final ")) return 90
  if (x.includes("runner up")) return 89

  // semifinal / final 4
  if (x.includes("semifinal")) return 80
  if (x.includes("semifinals")) return 80
  if (x.includes("Semifinals")) return 80
  if (x.includes("semi final")) return 80
  if (x.includes("final 4")) return 80
  if (x === "4") return 80

  // quarterfinal / final 8
  if (x.includes("quarter")) return 70
  if (x.includes("final 8")) return 70
  if (x === "8") return 70

  // round of 16, including forms like "round of 16 - 2"
  if (x.includes("round of 16")) return 60
  if (x.includes("last 16")) return 60
  if (x === "16") return 60

  // round of 32
  if (x.includes("round of 32")) return 50
  if (x.includes("last 32")) return 50
  if (x === "32") return 50

  // qualifying rounds
  if (x.includes("3rd round")) return 40
  if (x.includes("third round")) return 40
  if (x.includes("3rd r")) return 40

  if (x.includes("2nd round")) return 30
  if (x.includes("second round")) return 30
  if (x.includes("2nd r")) return 30

  if (x.includes("1st round")) return 20
  if (x.includes("first round")) return 20
  if (x.includes("1st r")) return 20

  return 0
}

function isRealLeagueWinnerLabel(value) {
  const x = normalizeLoose(value)
  if (!x) return false

  const isPlayoutWinner =
    (x.includes("playout") || x.includes("playouts")) &&
    x.includes("winner")

  if (isPlayoutWinner) return false

  return x.includes("winner") || x.includes("champion")
}

function playoffPlacementScore(value) {
  const x = normalizeLoose(value)
  if (!x) return -1

  if ((x.includes("playout") || x.includes("playouts")) && x.includes("winner")) {
    return -1
  }

  if (x.includes("winner")) return 110
  if (x.includes("champion")) return 100
  if (x === "final" || x.includes(" final")) return 90
  if (x.includes("semi")) return 80
  if (x.includes("quarter")) return 70
  if (x.includes("16")) return 60
  if (x.includes("32")) return 50
  if (x.includes("eliminated")) return 0

  if (x === "1" || x === "1.0" || x === "1.00") return -1

  return -1
}

function bestOfCandidates(candidates, scorer) {
  if (!candidates.length) return null

  return candidates
    .slice()
    .sort((a, b) => {
      const sa = scorer(a)
      const sb = scorer(b)
      if (sb !== sa) return sb - sa
      return Number(b.year) - Number(a.year)
    })[0]
}

/* ----------------------------- csv parser ----------------------------- */

function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ""
  let i = 0
  let inQuotes = false

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }

    if (ch === ",") {
      row.push(cur)
      cur = ""
      i++
      continue
    }

    if (ch === "\n") {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
      i++
      continue
    }

    if (ch === "\r") {
      i++
      continue
    }

    cur += ch
    i++
  }

  row.push(cur)
  rows.push(row)

  while (rows.length && rows[rows.length - 1].every((x) => !s(x))) rows.pop()
  return rows
}

/* ----------------------------- parser helpers ----------------------------- */

function findHeaderRow(rows, maxScan = 10) {
  let headerRowIdx = -1
  let idxTeam = -1

  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const row = rows[r] || []
    const hit = row.findIndex((cell) => norm(cell) === "team")
    if (hit >= 0) {
      headerRowIdx = r
      idxTeam = hit
      break
    }
  }

  return { headerRowIdx, idxTeam }
}

function parseGeneralSheet(rows) {
  if (!rows?.length || rows.length < 2) {
    throw new Error("General sheet CSV is missing rows.")
  }

  const { headerRowIdx, idxTeam } = findHeaderRow(rows, 8)

  if (headerRowIdx < 0 || idxTeam < 0) {
    throw new Error("Could not find Team column in general sheet.")
  }

  const sectionRow = headerRowIdx > 0 ? rows[headerRowIdx - 1] || [] : []
  const headerRow = rows[headerRowIdx] || []
  const colCount = Math.max(sectionRow.length, headerRow.length)

  const sectionByIdx = []
  let currentSection = ""

  for (let i = 0; i < colCount; i++) {
    const sec = s(sectionRow[i])
    if (sec) currentSection = sec
    sectionByIdx[i] = currentSection || "OTHER"
  }

  const cols = Array.from({ length: colCount }, (_, idx) => ({
    idx,
    section: sectionByIdx[idx],
    label: s(headerRow[idx]) || "",
  }))

  const data = rows.slice(headerRowIdx + 1).filter((row) => {
    const team = s(row[idxTeam])
    return team && hasLetters(team)
  })

  return { cols, data, idxTeam }
}

function parseSimpleSheet(rows) {
  if (!rows?.length || rows.length < 2) return null

  const { headerRowIdx, idxTeam } = findHeaderRow(rows, 10)
  if (headerRowIdx < 0 || idxTeam < 0) return null

  const headerRow = rows[headerRowIdx] || []
  const headers = headerRow.map((h) => s(h))
  const data = rows.slice(headerRowIdx + 1).filter((row) => {
    const team = s(row[idxTeam])
    return team && hasLetters(team)
  })

  return { headers, data, idxTeam, headerRowIdx }
}

function parseOverviewGeneralRankings(rows) {
  if (!rows?.length || rows.length < 3) {
    throw new Error("Overview sheet CSV is missing rows.")
  }

  const { headerRowIdx, idxTeam } = findHeaderRow(rows, 10)
  if (headerRowIdx < 0 || idxTeam < 0) {
    throw new Error("Could not find Team column in overview sheet.")
  }

  const top = headerRowIdx > 0 ? rows[headerRowIdx - 1] || [] : []
  const hdr = rows[headerRowIdx] || []
  const colCount = Math.max(top.length, hdr.length)

  const sectionByIdx = []
  let curSection = ""
  for (let i = 0; i < colCount; i++) {
    const t = s(top[i])
    if (t) curSection = t
    sectionByIdx[i] = curSection || "OTHER"
  }

  const cols = Array.from({ length: colCount }, (_, idx) => {
    const section = sectionByIdx[idx]
    const raw = s(hdr[idx])

    let label = raw
    if (idx === idxTeam) label = "Team"
    else if (!label) label = ""

    return { idx, section, label }
  })

  const WANT_RSP = ["Bye Position (1-2)%", "Playoffs Entry (1-6)%", "Average Position", "W%"]

  const rspIdxs = cols
    .filter((c) => c.section === "REGULAR SEASON PERFORMANCE")
    .map((c) => c.idx)
    .filter((i) => i !== idxTeam)

  for (let i = 0; i < rspIdxs.length; i++) {
    if (!cols[rspIdxs[i]].label) {
      cols[rspIdxs[i]].label = WANT_RSP[i] || `REGULAR SEASON PERFORMANCE ${i + 1}`
    }
  }

  const data = rows.slice(headerRowIdx + 1).filter((row) => {
    const team = s(row[idxTeam])
    return team && hasLetters(team)
  })

  const sectionToCols = {}
  sectionToCols["REGULAR SEASON PERFORMANCE"] = []

  for (const name of WANT_RSP) {
    const idx = cols.find((c) => c.section === "REGULAR SEASON PERFORMANCE" && norm(c.label) === norm(name))?.idx
    if (idx != null) sectionToCols["REGULAR SEASON PERFORMANCE"].push(idx)
  }

  return { cols, data, idxTeam, sectionToCols }
}

function findRowForTeam(parsed, teamName) {
  if (!parsed || !teamName) return null

  const targetExact = norm(teamName)
  const targetLoose = normalizeLoose(teamName)

  let hit = parsed.data.find((row) => norm(row[parsed.idxTeam]) === targetExact) || null
  if (hit) return hit

  hit = parsed.data.find((row) => normalizeLoose(row[parsed.idxTeam]) === targetLoose) || null
  if (hit) return hit

  hit =
    parsed.data.find((row) => {
      const candidate = normalizeLoose(row[parsed.idxTeam])
      return candidate.includes(targetLoose) || targetLoose.includes(candidate)
    }) || null

  return hit
}

function findColumnIndexes(headers, labelVariants, { exactOnly = false } = {}) {
  const wanted = labelVariants.map((x) => normalizeLoose(x))

  const exactHits = []
  const fuzzyHits = []

  headers.forEach((header, idx) => {
    const h = normalizeLoose(header)
    if (!h) return

    if (wanted.some((w) => h === w)) {
      exactHits.push(idx)
      return
    }

    if (!exactOnly && wanted.some((w) => h.includes(w))) {
      fuzzyHits.push(idx)
    }
  })

  return [...new Set([...exactHits, ...fuzzyHits])]
}

function getFirstFilledFromLabels(headers, row, labelVariants, options = {}) {
  const indexes = findColumnIndexes(headers, labelVariants, options)
  for (const idx of indexes) {
    const value = s(row[idx])
    if (looksFilledValue(value)) return value
  }
  return ""
}

/* ----------------------------- cup fallback helpers ----------------------------- */

const CUP_COL_TEAM = 1
const CUP_COL_ROUND_TITLE = 3

function cupRoundFromTitle(v) {
  const t = normalizeLoose(v)
  if (!t) return ""

  if (t.includes("qualifying round 1")) return "1st Round"
  if (t.includes("qualification round 1")) return "1st Round"
  if (t.includes("1st round")) return "1st Round"
  if (t.includes("first round")) return "1st Round"

  if (t.includes("qualifying round 2")) return "2nd Round"
  if (t.includes("qualification round 2")) return "2nd Round"
  if (t.includes("2nd round")) return "2nd Round"
  if (t.includes("second round")) return "2nd Round"

  if (t.includes("qualifying round 3")) return "3rd Round"
  if (t.includes("qualification round 3")) return "3rd Round"
  if (t.includes("3rd round")) return "3rd Round"
  if (t.includes("third round")) return "3rd Round"

  if (t.includes("round of 32") || t.includes("last 32")) return "Last 32"
  if (t.includes("round of 16") || t.includes("last 16")) return "Last 16"
  if (t.includes("quarter")) return "Last 8"
  if (t.includes("semi")) return "Semifinals"
  if (t.includes("final")) return "Final"

  if (t.includes("week 1")) return "1st Round"
  if (t.includes("week 2")) return "2nd Round"
  if (t.includes("week 3")) return "3rd Round"
  if (t.includes("week 4")) return "Last 32"
  if (t.includes("week 5")) return "Last 16"
  if (t.includes("week 6")) return "Last 8"
  if (t.includes("week 7")) return "Semifinals"
  if (t.includes("week 8")) return "Final"

  return ""
}

function teamNameMatches(a, b) {
  return normalizeLoose(a) === normalizeLoose(b)
}

function isWinnerRowForTeam(row, teamName) {
  const target = normalizeLoose(teamName)
  const teamCell = normalizeLoose(row[CUP_COL_TEAM])

  if (teamCell !== target) return false
  return row.some((cell, idx) => idx !== CUP_COL_TEAM && normalizeLoose(cell) === "w")
}

function stagePriority(stage) {
  switch (s(stage)) {
    case "1st Round":
      return 1
    case "2nd Round":
      return 2
    case "3rd Round":
      return 3
    case "Last 32":
      return 4
    case "Last 16":
      return 5
    case "Last 8":
      return 6
    case "Semifinals":
      return 7
    case "Final":
      return 8
    case "Winner":
      return 9
    default:
      return 0
  }
}

function findCupFallbackFromRows(rows, teamName) {
  if (!rows?.length || !teamName) return ""

  let currentStage = ""
  const appearances = []

  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] || []).map((x) => s(x))
    if (!row.some((x) => x)) continue

    const roundTitle = s(row[CUP_COL_ROUND_TITLE])
    const parsedStage = cupRoundFromTitle(roundTitle)
    if (parsedStage) {
      currentStage = parsedStage
      continue
    }

    if (!currentStage) continue

    const rowTeam = s(row[CUP_COL_TEAM])
    if (!rowTeam) continue
    if (!teamNameMatches(rowTeam, teamName)) continue

    appearances.push({
      stage: currentStage,
      winner: isWinnerRowForTeam(row, teamName),
    })
  }

  if (!appearances.length) return ""

  const best = appearances
    .slice()
    .sort((a, b) => {
      const av = a.winner && a.stage === "Final" ? stagePriority("Winner") : stagePriority(a.stage)
      const bv = b.winner && b.stage === "Final" ? stagePriority("Winner") : stagePriority(b.stage)
      return bv - av
    })[0]

  if (best.stage === "Final" && best.winner) return "Winner"
  return best.stage
}

/* ----------------------------- icons ----------------------------- */

function AwardTrophy({ type, label, href }) {
  const src = TROPHY_IMAGES[type]

  return (
    <a
      href={href || src || "#"}
      target="_blank"
      rel="noreferrer"
      title={label}
      style={awardTrophyLink}
    >
      <img src={src} alt={label} style={awardTrophyImg} />
    </a>
  )
}

/* ----------------------------- current roster ----------------------------- */

const show = value => value == null || value === "" ? "—" : value
function savedTeam(key) {
  try { return window.localStorage.getItem(key) || "" } catch { return "" }
}
function saveTeam(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch { /* Roster access still works when browser storage is unavailable. */ }
}

function FantraxTeamRoster({ leagueKey, teamName }) {
  const leagueId = getDraftLeagueId(leagueKey)
  const storageKey = `gnfc-roster-team:${leagueId}:${teamName}`
  const [preferredId, setPreferredId] = useState(() => savedTeam(storageKey))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [choices, setChoices] = useState([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!leagueId || !teamName) { setLoading(false); return }
    let alive = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 40000)
    setLoading(true)
    setError("")
    setChoices([])
    setData(null)
    const params = new URLSearchParams({ league: leagueKey, team: teamName })
    if (preferredId) params.set("teamId", preferredId)
    ;(async () => {
      try {
        const response = await fetch(`/api/gnfc-roster?${params}`, { signal: controller.signal, cache: "no-store" })
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The roster service is unavailable. Please try again later.")
        }
        const result = await response.json()
        if (!response.ok) {
          if (alive && result?.code === "TEAM_SELECTION_REQUIRED" && result.leagueId === leagueId && Array.isArray(result.teams)) {
            setChoices(result.teams)
          }
          throw new Error(result?.error || `Roster request failed (${response.status}).`)
        }
        if (result?.leagueId !== leagueId || !Array.isArray(result?.players) || !result.teamId ||
            (preferredId && result.teamId !== preferredId)) {
          throw new Error("The roster service returned unexpected team data.")
        }
        if (alive) setData(result)
      } catch (e) {
        if (alive) setError(e?.name === "AbortError" ? "The roster request timed out. Please try again." : e?.message || "Unable to load this roster.")
      } finally {
        clearTimeout(timeout)
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false; clearTimeout(timeout); controller.abort() }
  }, [leagueKey, leagueId, teamName, preferredId, reload])

  const players = data?.leagueId === leagueId ? data.players : []

  function chooseTeam(teamId) {
    saveTeam(storageKey, teamId)
    setPreferredId(teamId)
  }

  return (
    <section className="card gnfcRoster" aria-label={`${teamName} current roster`}>
      <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 900 }}>Current Roster</h2>

      {!leagueId ? <div className="notice">A current Fantrax roster is not configured for {leagueKey}.</div> : <>
        {loading && <div className="notice" role="status">Loading current roster…</div>}
        {!loading && error && <div className="notice" role="alert">
          <div>{error}</div>
          <div className="gnfcRosterErrorActions">
            <button className="gnfcRosterControl" type="button" onClick={() => setReload(value => value + 1)}>Try again</button>
            {preferredId && <button className="gnfcRosterControl" type="button" onClick={() => chooseTeam("")}>Reset team match</button>}
          </div>
        </div>}
        {!loading && choices.length > 0 && <label className="gnfcRosterMatch">
          Fantrax team in {leagueKey}
          <select className="gnfcRosterControl" value="" onChange={event => chooseTeam(event.target.value)}>
            <option value="" disabled>Select the matching team…</option>
            {choices.map(team => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}
          </select>
          <span style={{ color: "var(--gnfc-muted)", fontSize: 12 }}>Your selection is remembered in this browser.</span>
        </label>}

        {!loading && !error && data && <>
          {players.length === 0 ? <div className="notice">This team has no rostered players for the current lineup period.</div> : <>
            <ul className="gnfcRosterList" role="list" aria-label={`${data.teamName} — current Fantrax roster`}>
              {players.map(player => <li className="gnfcRosterRow" key={player.key}>
                <div className="gnfcRosterName"><span className="gnfcRosterPlayer">{player.playerName}</span><span className="gnfcRosterDetail">{show(player.nbaTeam)}</span></div>
                <div className="gnfcRosterPosition"><span title="Position">{show(player.position)}</span><span className="gnfcRosterDetail">Slot: {show(player.slot)}</span></div>
                <span className={`gnfcRosterStatus ${player.status === "ACTIVE" ? "isActive" : player.status === "INJURED_RESERVE" ? "isIR" : ""}`}>{player.statusLabel}</span>
              </li>)}
            </ul>
          </>}
        </>}
      </>}

      <style>{`
        .gnfcRoster { padding:16px; min-width:0; }
        .gnfcRosterErrorActions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
        .gnfcRosterControl { box-sizing:border-box; max-width:100%; min-width:0; min-height:32px; padding:6px 8px; border-radius:8px; border:1px solid var(--gnfc-border); background:var(--gnfc-surface); color:var(--gnfc-ink); font:inherit; font-size:12px; }
        .gnfcRosterControl:focus-visible { outline:2px solid #db7d12; outline-offset:2px; }
        button.gnfcRosterControl { cursor:pointer; font-weight:800; }
        .gnfcRosterMatch { display:flex; flex-direction:column; gap:4px; min-width:0; margin-top:10px; font-size:11px; font-weight:800; }
        .gnfcRosterList { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
        .gnfcRosterRow { display:grid; grid-template-columns:minmax(0,1fr) 48px 64px; align-items:center; gap:10px; border:1px solid rgba(5,97,97,.35); border-radius:14px; padding:12px; background:rgba(255,255,255,.96); box-shadow:0 4px 12px rgba(5,97,97,.05); }
        .gnfcRosterName { min-width:0; overflow-wrap:anywhere; }
        .gnfcRosterPosition { min-width:0; font-size:12px; color:var(--gnfc-ink); overflow-wrap:anywhere; }
        .gnfcRosterPlayer { display:block; font-size:13px; font-weight:900; line-height:1.3; color:var(--gnfc-muted); }
        .gnfcRosterDetail { display:block; margin-top:2px; color:var(--gnfc-muted); font-size:10px; line-height:1.25; }
        .gnfcRosterStatus { display:inline-block; justify-self:end; padding:3px 5px; border:1px solid rgba(5,97,97,.25); border-radius:999px; background:rgba(128,128,128,.12); color:var(--gnfc-ink); font-size:10px; font-weight:800; white-space:nowrap; }
        .gnfcRosterStatus.isActive { border-color:rgba(0,160,120,.65); background:rgba(0,160,120,.18); color:#168044; }
        .gnfcRosterStatus.isIR { border-color:rgba(220,38,38,.7); background:rgba(220,38,38,.18); color:#dc4545; }
      `}</style>
    </section>
  )
}

/* ----------------------------- main component ----------------------------- */

export default function TeamPage() {
  const navigate = useNavigate()
  const { teamName } = useParams()
  const decodedName = decodeURIComponent(teamName || "")
  const { loading, error, teams } = useTeams()

  const [selectedTeam, setSelectedTeam] = useState("")
  const [generalParsed, setGeneralParsed] = useState(null)
  const [generalError, setGeneralError] = useState("")
  const [historyParsed, setHistoryParsed] = useState([])
  const [historyError, setHistoryError] = useState("")
  const [overviewParsed, setOverviewParsed] = useState(null)
  const [overviewGeneralParsed, setOverviewGeneralParsed] = useState(null)
  const [overviewError, setOverviewError] = useState("")
  const [cupFallbackValue, setCupFallbackValue] = useState("")

  const team = useMemo(() => {
    const needle = norm(decodedName)
    return teams.find((t) => norm(t.team) === needle) || null
  }, [teams, decodedName])

  useEffect(() => {
    setSelectedTeam(team?.team || "")
  }, [team?.team])

  useEffect(() => {
    let alive = true

    async function loadGeneralSheetData() {
      try {
        setGeneralError("")
        const res = await fetch(csvExportUrl(GENERAL_SHEET_ID, GENERAL_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`General sheet fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)
        const parsed = parseGeneralSheet(rows)

        if (alive) setGeneralParsed(parsed)
      } catch (e) {
        if (alive) {
          setGeneralParsed(null)
          setGeneralError(e?.message || String(e))
        }
      }
    }

    loadGeneralSheetData()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function loadHistorySheets() {
      try {
        setHistoryError("")

        const results = await Promise.all(
          HISTORY_YEARS.map(async ([year, gid]) => {
            const res = await fetch(csvExportUrl(RANKING_SHEET_ID, gid))
            const text = await res.text()
            if (!res.ok) throw new Error(`History sheet ${year} fetch failed: ${res.status} ${res.statusText}`)

            const rows = parseCsv(text)
            const parsed = parseSimpleSheet(rows)

            return { year, gid, parsed }
          })
        )

        if (alive) setHistoryParsed(results.filter((x) => x?.parsed))
      } catch (e) {
        if (alive) {
          setHistoryParsed([])
          setHistoryError(e?.message || String(e))
        }
      }
    }

    loadHistorySheets()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function loadOverviewSheet() {
      try {
        setOverviewError("")
        const res = await fetch(csvExportUrl(OVERVIEW_SHEET_ID, OVERVIEW_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`Overview sheet fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)

        const parsedSimple = parseSimpleSheet(rows)
        if (alive) setOverviewParsed(parsedSimple)

        try {
          const parsedGeneral = parseOverviewGeneralRankings(rows)
          if (alive) setOverviewGeneralParsed(parsedGeneral)
        } catch (e) {
          if (alive) {
            setOverviewGeneralParsed(null)
            console.warn("[TeamPage][RSP parse failed]", e?.message || String(e))
          }
        }
      } catch (e) {
        if (alive) {
          setOverviewParsed(null)
          setOverviewGeneralParsed(null)
          setOverviewError(e?.message || String(e))
        }
      }
    }

    loadOverviewSheet()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function loadCupFallback() {
      try {
        setCupFallbackValue("")

        if (!team?.team) return

        const currentCup = getFirst(team.raw, "Cup")
        if (!isMissingCupValue(currentCup)) return

        const res = await fetch(csvExportUrl(CUP_SHEET_ID, CUP_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`Cup sheet fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)
        const fallback = findCupFallbackFromRows(rows, team.team)

        if (alive) setCupFallbackValue(fallback)
      } catch {
        if (alive) setCupFallbackValue("")
      }
    }

    loadCupFallback()

    return () => {
      alive = false
    }
  }, [team])

  const generalRow = useMemo(() => {
    return findRowForTeam(generalParsed, team?.team)
  }, [generalParsed, team?.team])

  const awardsRow = useMemo(() => {
    return findRowForTeam(overviewParsed, team?.team)
  }, [overviewParsed, team?.team])

  const rspRow = useMemo(() => {
    return findRowForTeam(overviewGeneralParsed, team?.team)
  }, [overviewGeneralParsed, team?.team])

  const awardsSummary = useMemo(() => {
  if (!team?.team || !historyParsed.length) return []

  let leagueWinnerA = 0
  let leagueWinnerB = 0
  let leagueWinnerG = 0
  let divisionWinner = 0
  let championsLeague = 0
  let cup = 0

  for (const { parsed } of historyParsed) {
    const row = findRowForTeam(parsed, team.team)
    if (!row) continue

    const playoffs = getFirstFilledFromLabels(parsed.headers, row, ["Playoffs"])
    const league = getFirstFilledFromLabels(parsed.headers, row, ["League"], { exactOnly: true })
    const cl = getFirstFilledFromLabels(parsed.headers, row, ["Champions League"])
    const cupValue = getFirstFilledFromLabels(parsed.headers, row, ["Cup"])

    const playoffsNorm = normalizeLoose(playoffs)
    const leagueNorm = normalizeLoose(league)
    const clNorm = normalizeLoose(cl)
    const cupNorm = normalizeLoose(cupValue)

    const isLeagueWinner = isRealLeagueWinnerLabel(playoffs)
    const isDivisionWinner = playoffsNorm.includes("champion")

    if (isLeagueWinner) {
      if (leagueNorm.startsWith("a")) leagueWinnerA += 1
      else if (leagueNorm.startsWith("b")) leagueWinnerB += 1
      else if (leagueNorm.startsWith("γ") || leagueNorm.startsWith("g")) leagueWinnerG += 1
    }

    if (isDivisionWinner) {
      divisionWinner += 1
    }

    if (clNorm.includes("winner") || clNorm.includes("champion")) {
      championsLeague += 1
    }

    if (cupNorm.includes("winner") || cupNorm.includes("champion")) {
      cup += 1
    }
  }

  return [
    {
      key: "divisionWinner",
      label: "Division Champion",
      count: divisionWinner,
      iconType: "divisionWinner",
    },
    {
      key: "championsLeague",
      label: "Champions League Winner",
      count: championsLeague,
      iconType: "cl",
    },
    {
      key: "cup",
      label: "Cup Winner",
      count: cup,
      iconType: "cup",
    },
    {
      key: "leagueWinnerA",
      label: "League A Winner",
      count: leagueWinnerA,
      iconType: "leagueA",
    },
    {
      key: "leagueWinnerB",
      label: "League B Winner",
      count: leagueWinnerB,
      iconType: "leagueB",
    },
    {
      key: "leagueWinnerG",
      label: "League Γ Winner",
      count: leagueWinnerG,
      iconType: "leagueG",
    },
  ]
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      const ga = TROPHY_GRAVITY[a.key] ?? 999
      const gb = TROPHY_GRAVITY[b.key] ?? 999
      if (ga !== gb) return ga - gb
      return a.label.localeCompare(b.label)
    })
}, [historyParsed, team?.team])

  const regularSeasonPerformance = useMemo(() => {
    if (!overviewGeneralParsed || !rspRow) {
      return {
        byePosition: "",
        playoffsEntry: "",
        averagePosition: "",
        winPct: "",
      }
    }

    const rspCols = overviewGeneralParsed.sectionToCols["REGULAR SEASON PERFORMANCE"] || []
    const byLabel = {}

    for (const colIdx of rspCols) {
      const label = overviewGeneralParsed.cols[colIdx]?.label || ""
      byLabel[label] = s(rspRow[colIdx])
    }

    return {
      byePosition: byLabel["Bye Position (1-2)%"] || "",
      playoffsEntry: byLabel["Playoffs Entry (1-6)%"] || "",
      averagePosition: byLabel["Average Position"] || "",
      winPct: byLabel["W%"] || "",
    }
  }, [overviewGeneralParsed, rspRow])

  const bestPerformance = useMemo(() => {
    if (!team?.team || !historyParsed.length) return []

    const championsLeagueCandidates = []
    const cupCandidates = []
    const playoffsCandidates = []
    const leagueRankingCandidates = []

    for (const { year, parsed } of historyParsed) {
      const row = findRowForTeam(parsed, team.team)
    
      if (!row) continue

      const cl = getFirstFilledFromLabels(parsed.headers, row, ["Champions League"])
const cup = getFirstFilledFromLabels(parsed.headers, row, ["Cup"])
const playoffs = getFirstFilledFromLabels(parsed.headers, row, ["Playoffs"])
const league = getFirstFilledFromLabels(parsed.headers, row, ["League"], { exactOnly: true })
const leagueRanking = getFirstFilledFromLabels(parsed.headers, row, [
  "League Ranking",
  "League Rank",
  "Ranking",
  "League Standing",
  "Standing",
])

if (looksFilledValue(cl)) {
  championsLeagueCandidates.push({
    value: cl,
    year: Number(year),
  })
}

if (looksFilledValue(cup)) {
  cupCandidates.push({
    value: cup,
    year: Number(year),
  })
}

if (looksFilledValue(playoffs)) {
  playoffsCandidates.push({
    value: playoffs,
    year: Number(year),
    league: s(league),
  })
}

const leagueRankingNum = toRank(leagueRanking)
if (leagueRankingNum != null && leagueRankingNum > 0) {
  leagueRankingCandidates.push({
    value: leagueRankingNum,
    year: Number(year),
    league: s(league),
  })
}
    }
    

    const bestChampionsLeague = bestOfCandidates(championsLeagueCandidates, (x) => placementScore(x.value))
    const bestCup = bestOfCandidates(cupCandidates, (x) => placementScore(x.value))
    const bestLeaguePlacement = bestOfCandidates(playoffsCandidates, (x) => playoffPlacementScore(x.value))

    const bestLeagueRankingFallback = leagueRankingCandidates.length
  ? leagueRankingCandidates
      .slice()
      .sort((a, b) => {
        if (a.value !== b.value) return a.value - b.value
        return b.year - a.year
      })[0]
  : null

const bestLeagueWinningEntries = playoffsCandidates
  .filter((x) => isRealLeagueWinnerLabel(x.value))
  .slice()
  .sort((a, b) => a.year - b.year)

const divisionWinningEntries = playoffsCandidates
  .filter((x) => normalizeLoose(x.value).includes("champion"))
  .slice()
  .sort((a, b) => a.year - b.year)

function bestLeaguePlacementDisplay(entry, entries) {
  if (!entry) return ""

  if (isRealLeagueWinnerLabel(entry.value)) {
    const winnerEntries = entries.length ? entries : [entry]
    const parts = winnerEntries.map((x) => {
      const leaguePart = x.league ? `${x.league} ` : ""
      return `${leaguePart}(${x.year})`
    })
    return `Winner - ${parts.join(", ")}`
  }

  return `${entry.value}${entry.league ? ` - ${entry.league}` : ""} (${entry.year})`
}

    return [
      bestChampionsLeague
        ? {
            label: "Best Champions League Placement",
            display: `${bestChampionsLeague.value} (${bestChampionsLeague.year})`,
          }
        : null,

      bestCup
      ? {
          label: "Best Cup Placement",
          display: `${normalizeCupDisplay(bestCup.value)} (${bestCup.year})`,
        }
      : null,

      bestLeaguePlacement
  ? {
      label: "Best League Placement",
      display: bestLeaguePlacementDisplay(bestLeaguePlacement, bestLeagueWinningEntries),
    }
  : bestLeagueRankingFallback
    ? {
        label: "Best League Placement",
        display: `#${bestLeagueRankingFallback.value}${bestLeagueRankingFallback.league ? ` - ${bestLeagueRankingFallback.league}` : ""} (${bestLeagueRankingFallback.year})`,
      }
    : null,

      divisionWinningEntries.length
  ? {
      label: "Best Division",
      display: `Champion - ${divisionWinningEntries
        .map((x) => {
          const leagueText = s(x.league)
          const divisionOnly = leagueText ? leagueText.replace(/\d+$/g, "") : "—"
          return `${divisionOnly} (${x.year})`
        })
        .join(", ")}`,
    }
  : null,
    ].filter(Boolean)
  }, [historyParsed, team?.team])

  const leagueTeams = useMemo(() => {
    const league = s(team?.league)
    if (!league) return []

    return teams
      .filter((t) => s(t.league) === league)
      .slice()
      .sort((a, b) => s(a.team).localeCompare(s(b.team), undefined, { sensitivity: "base" }))
  }, [teams, team?.league])

  const totalTeams = teams.length
  const worst5From = Math.max(1, totalTeams - 4)

  const leagueW = team?.raw ? getFirst(team.raw, "GENERAL PERFORMANCE League W%") : ""

  const currentCupValue = team?.raw
    ? isMissingCupValue(getFirst(team.raw, "Cup"))
      ? cupFallbackValue
      : getFirst(team.raw, "Cup")
    : ""

  const quickRanks = useMemo(() => {
    if (!team?.raw) return []

    const raw = team.raw
    const map = {
      GP: raw["GENERAL STATISTICS RANKINGS GP"],
      "FG%": raw["FG%_2"] ?? raw["FG%"],
      "3P": raw["3P__2"] ?? raw["3P"],
      "FT%": raw["FT%__2"] ?? raw["FT%"],
      PTS: raw["PTS__2"] ?? raw["PTS"],
      REB: raw["REB__2"] ?? raw["REB"],
      AST: raw["AST__2"] ?? raw["AST"],
      ST: raw["ST__2"] ?? raw["ST"],
      BLK: raw["BLK__2"] ?? raw["BLK"],
      TO: raw["TO__2"] ?? raw["TO"],
    }

    const order = ["GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]
    return order.map((k) => ({ key: k, value: map[k] }))
  }, [team])

  const generalPerformanceStats = useMemo(() => {
    if (!team?.raw) return []

    const raw = team.raw
    return [
      { label: "GP", value: raw["GP"] },
      { label: "FG%", value: raw["GENERAL STATISTICS FG%"] ?? raw["FG%"] },
      { label: "3P", value: raw["3P"] },
      { label: "FT%", value: raw["FT%"] },
      { label: "PTS", value: raw["PTS"] },
      { label: "REB", value: raw["REB"] },
      { label: "AST", value: raw["AST"] },
      { label: "ST", value: raw["ST"] },
      { label: "BLK", value: raw["BLK"] },
      { label: "TO", value: raw["TO"] },
    ].filter((x) => !isJunkKey(x.label))
  }, [team])

  const pointsSystemStats = useMemo(() => {
    if (!generalParsed || !generalRow) return []

    const wanted = ["league points", "category adj", "cup", "general standing", "stats winners", "tw", "rw", "extra", "total"]

    const rankLike = new Set(["general standing"])
    const byLabel = new Map()

    parsedLoop: for (const c of generalParsed.cols) {
      const label = s(c.label)
      if (!label) continue

      const cleanLabel = norm(label)
      const cleanSection = norm(c.section)
      const value = s(generalRow[c.idx])
      if (!value) continue

      for (const want of wanted) {
        const fullLabel = norm(`${cleanSection} ${cleanLabel}`)

        if (cleanLabel === want || fullLabel.includes(`points system ${want}`) || fullLabel === want) {
          if (!byLabel.has(want)) {
            byLabel.set(want, {
              label: want === "league points" ? "League Points" : label,
              value,
              rankLike: rankLike.has(want),
            })
          }
          continue parsedLoop
        }
      }
    }

    return wanted.map((key) => byLabel.get(key)).filter(Boolean)
  }, [generalParsed, generalRow])

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />

          <div className="brand-title">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Team Profile</h1>

              <select
                value={selectedTeam}
                onChange={(e) => {
                  const next = e.target.value
                  setSelectedTeam(next)
                  navigate(`/team/${encodeURIComponent(next)}`)
                }}
                aria-label="Select team"
                disabled={loading || !team?.league || !leagueTeams.length}
                style={teamSelect}
              >
                {!selectedTeam ? (
                  <option value="" disabled>
                    Select team…
                  </option>
                ) : null}

                {leagueTeams.map((t) => (
                  <option key={t.team} value={t.team}>
                    {t.team}
                  </option>
                ))}
              </select>

              {team?.league ? (
                <span className="badge" style={{ opacity: 0.9 }}>
                  {team.league}
                </span>
              ) : null}
            </div>

            <p>{decodedName}</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {team?.division && (
              <Link
                to={`/division/${encodeURIComponent(team.division)}`}
                className="badge"
                style={{ textDecoration: "none" }}
              >
                ← Division {team.division}
              </Link>
            )}
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && <div className="notice">Loading…</div>}
        {error && <div className="notice">Error: {error}</div>}

        {!loading && !error && !team && (
          <div className="notice">
            Team not found: <strong>{decodedName}</strong>
          </div>
        )}

        {!loading && !error && team && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 14,
                alignItems: "stretch",
              }}
            >
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
  <img
    src={teamLogoSrc(team.team)}
    alt={`${team.team} logo`}
    style={teamHeaderLogo}
    onError={(e) => {
      e.currentTarget.src = "/logos/_default-logo.webp"
    }}
  />

  <div style={{ minWidth: 0 }}>
    <div
      style={{
        fontSize: 24,
        fontWeight: 1000,
        letterSpacing: 0.3,
        lineHeight: 1.1,
      }}
    >
      {team.team}
    </div>

    <div style={{ marginTop: 6, color: "var(--gnfc-muted)", fontSize: 14 }}>
      Manager:{" "}
      <span style={{ color: "var(--gnfc-text)", fontWeight: 800 }}>
        {team.manager || "—"}
      </span>
    </div>
  </div>
</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <Link
                      to={`/division/${encodeURIComponent(team.division)}`}
                      className="badge"
                      style={{ textDecoration: "none" }}
                    >
                      Division {team.division}
                    </Link>

                    <Link
                      to={`/league/${encodeURIComponent(team.league)}`}
                      className="badge"
                      style={{ textDecoration: "none" }}
                    >
                      {team.league}
                    </Link>
                  </div>
                </div>

                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 16 }}>Current Year</div>

                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  <div style={miniBox}>
                    <div style={miniLabel}>League Ranking</div>
                    <div style={miniValue}>{val(team.leagueRanking)}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>League W%</div>
                    <div style={miniValue}>{val(leagueW)}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>Category Standing</div>
                    <div style={miniValue}>{val(getFirst(team.raw, "Category Standing"))}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>Category Next Season</div>
                    <div style={miniValue}>{val(getFirst(team.raw, "Category Next Season"))}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>Playoffs</div>
                    <div style={miniValue}>{val(getFirst(team.raw, "Playoffs"))}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>Champions League</div>
                    <div style={miniValue}>{val(getFirst(team.raw, "Champions League"))}</div>
                  </div>

                  <div style={miniBox}>
                    <div style={miniLabel}>Cup</div>
                    <div style={miniValue}>{val(currentCupValue)}</div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Awards</div>
                  <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>Career trophy cabinet</div>
                </div>

                {overviewError ? (
                  <div style={messageBoxStyle(12)}>{overviewError}</div>
                ) : awardsSummary.length ? (
                  <div style={awardsSingleBox}>
                    <div style={awardsIconsRow}>
                      {awardsSummary.map((item) => (
                        <div key={item.key} style={awardMiniItem}>
                          <div style={awardMiniTrophiesWrap}>
                            {Array.from({ length: item.count }).map((_, idx) => (
                              <AwardTrophy
                                key={`${item.key}-${idx}`}
                                type={item.iconType}
                                label={item.label}
                                href={TROPHY_IMAGES[item.iconType]}
                              />
                            ))}
                          </div>

                          <div style={awardMiniLabel}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={messageBoxStyle(12)}>No awards found for this team.</div>
                )}

                <div
                  style={{
                    marginTop: 18,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900 }}>All Time Performance</div>
                  <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>Career regular season profile</div>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <div style={rspBox}>
                    <div style={rspValue}>{val(regularSeasonPerformance.byePosition)}</div>
                    <div style={rspLabel}>Bye Position (1-2)%</div>
                  </div>

                  <div style={rspBox}>
                    <div style={rspValue}>{val(regularSeasonPerformance.playoffsEntry)}</div>
                    <div style={rspLabel}>Playoffs Entry (1-6)%</div>
                  </div>

                  <div style={rspBox}>
                    <div style={rspValue}>{val(regularSeasonPerformance.averagePosition)}</div>
                    <div style={rspLabel}>Average Position</div>
                  </div>

                  <div style={rspBox}>
                    <div style={rspValue}>{val(regularSeasonPerformance.winPct)}</div>
                    <div style={rspLabel}>W%</div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 18,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Best Performances</div>
                  <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>Best historical results</div>
                </div>

                {historyError ? (
                  <div style={messageBoxStyle(14)}>{historyError}</div>
                ) : bestPerformance.length ? (
                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {bestPerformance.map((item) => (
                      <div key={item.label} style={miniBox}>
                        <div style={miniLabel}>{item.label}</div>
                        <div style={miniValue}>{item.display}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={messageBoxStyle(14)}>No history data found for this team.</div>
                )}
              </div>
            </div>

            {generalError ? (
              <div className="card" style={{ padding: 16, marginTop: 14 }}>
                <div style={{ fontWeight: 900 }}>Could not load Points System data</div>
                <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>{generalError}</div>
              </div>
            ) : null}

            <div className="gnfcTeamStatsGrid">
              <FantraxTeamRoster
                key={`${team.league}:${team.team}`}
                leagueKey={team.league}
                teamName={team.team}
              />

              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Category Positions</div>
                  <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>Top 5 / Bottom 5</div>
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {quickRanks.map(({ key, value }) => {
                    const r = toRank(value)
                    const isTop5 = r != null && r <= 5
                    const isWorst5 = r != null && r >= worst5From
                    const showBadge = isTop5 || isWorst5

                    const badgeStyle = isTop5
                      ? {
                          borderColor: "rgba(0, 160, 120, 0.65)",
                          background: "rgba(0, 160, 120, 0.18)",
                        }
                      : {
                          borderColor: "rgba(220, 38, 38, 0.70)",
                          background: "rgba(220, 38, 38, 0.18)",
                        }

                    return (
                      <div
                        key={key}
                        style={{
                          border: "1px solid rgba(5, 97, 97, 0.35)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(255,255,255,0.96)",
                          boxShadow: "0 4px 12px rgba(5, 97, 97, 0.05)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{key}</div>

                        {showBadge ? (
                          <span
                            className="badge"
                            style={{
                              ...badgeStyle,
                              fontWeight: 1000,
                              fontSize: 16,
                              padding: "2px 10px",
                              borderRadius: 999,
                              display: "inline-block",
                              lineHeight: 1,
                            }}
                          >
                            #{r ?? "—"}
                          </span>
                        ) : (
                          <div style={{ fontSize: 16, fontWeight: 1000 }}>{r == null ? "—" : `#${r}`}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>General Performance</div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {generalPerformanceStats.map(({ label, value }) => (
                    <div
                      key={label}
                      style={{
                        border: "1px solid rgba(5, 97, 97, 0.35)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(255,255,255,0.96)",
                        boxShadow: "0 4px 12px rgba(5, 97, 97, 0.05)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 1000 }}>{val(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Points System</div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {pointsSystemStats.map(({ label, value, rankLike }) => {
                    const rank = toRank(value)
                    const showTop5 = rankLike && rank != null && rank <= 5

                    return (
                      <div
                        key={label}
                        style={{
                          border: "1px solid rgba(5, 97, 97, 0.35)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(255,255,255,0.96)",
                          boxShadow: "0 4px 12px rgba(5, 97, 97, 0.05)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{label}</div>

                        {showTop5 ? (
                          <span
                            className="badge"
                            style={{
                              borderColor: "rgba(0, 160, 120, 0.65)",
                              background: "rgba(0, 160, 120, 0.18)",
                              fontWeight: 1000,
                              fontSize: 16,
                              padding: "2px 10px",
                              borderRadius: 999,
                              display: "inline-block",
                              lineHeight: 1,
                            }}
                          >
                            #{rank}
                          </span>
                        ) : (
                          <div style={{ fontSize: 16, fontWeight: 1000 }}>{val(value)}</div>
                        )}
                      </div>
                    )
                  })}

                  {!pointsSystemStats.length && !generalError ? (
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(0,0,0,0.12)",
                        color: "var(--gnfc-muted)",
                        fontWeight: 700,
                      }}
                    >
                      No points system data found for this team.
                    </div>
                  ) : null}
                </div>
              </div>

            </div>
          </>
        )}
      </div>
      <style>{`
        .gnfcTeamStatsGrid { margin-top:14px; display:grid; grid-template-columns:minmax(280px,1.2fr) repeat(3,minmax(0,1fr)); gap:14px; align-items:start; }
        .gnfcTeamStatsGrid > * { min-width:0; }
        @media (max-width:1100px) { .gnfcTeamStatsGrid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:680px) { .gnfcTeamStatsGrid { grid-template-columns:minmax(0,1fr); } }
      `}</style>
    </>
  )
}

/* ----------------------------- styles ----------------------------- */

function messageBoxStyle(marginTop = 12) {
  return {
    marginTop,
    border: "1px solid rgba(5, 97, 97, 0.35)",
    borderRadius: 14,
    padding: 12,
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 4px 12px rgba(5, 97, 97, 0.05)",
    color: "var(--gnfc-muted)",
    fontWeight: 700,
  }
}

const teamSelect = {
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "var(--gnfc-text)",
  padding: "0 12px",
  fontWeight: 900,
  outline: "none",
  maxWidth: 280,
}

const miniBox = {
  border: "1px solid rgba(5, 97, 97, 0.35)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(255,255,255,0.96)",
  boxShadow: "0 4px 12px rgba(5, 97, 97, 0.05)",
}

const miniLabel = {
  fontSize: 12,
  color: "var(--gnfc-muted)",
  fontWeight: 800,
  letterSpacing: 0.2,
}

const miniValue = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 1000,
}

const rspBox = {
  border: "1px solid rgba(249,115,22,0.22)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(249,115,22,0.08)",
  textAlign: "center",
}

const rspLabel = {
  marginTop: 6,
  fontSize: 11,
  color: "var(--gnfc-muted)",
  fontWeight: 900,
  lineHeight: 1.15,
}

const rspValue = {
  fontSize: 18,
  fontWeight: 1000,
}

const awardsSingleBox = {
  marginTop: 12,
  border: "2px solid rgba(249, 115, 22, 0.55)",
  borderRadius: 16,
  padding: 14,
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,248,240,0.96))",
  boxShadow: "0 10px 24px rgba(249, 115, 22, 0.10), inset 0 1px 0 rgba(255,255,255,0.85)",
}

const awardsIconsRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 16,
  alignItems: "start",
}

const awardMiniItem = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 8,
}

const awardMiniTrophiesWrap = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 8,
  minHeight: 58,
}

const awardMiniLabel = {
  fontSize: 11,
  color: "#7c2d12",
  fontWeight: 900,
  lineHeight: 1.15,
}

const awardTrophyLink = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  width: 52,
  height: 52,
  borderRadius: 12,
  background: "rgba(255,255,255,0.9)",
  border: "1px solid rgba(249, 115, 22, 0.22)",
  boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
}

const teamHeaderLogo = {
  width: 52,
  height: 52,
  objectFit: "contain",
  borderRadius: 12,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(5, 97, 97, 0.18)",
  boxShadow: "0 4px 10px rgba(5, 97, 97, 0.08)",
  flexShrink: 0,
  padding: 4,
}

const awardTrophyImg = {
  width: 42,
  height: 42,
  objectFit: "contain",
  display: "block",
}
