// src/pages/LeaguePage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { LEAGUE_GIDS } from "../config/leagueGids"

/* ----------------------------- config ----------------------------- */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const DEFAULT_LEAGUE_KEY = "A2" // fallback if route param missing
const PLAYOUTS_GID = 1944577703
const PLAYOFFS_GID = 1647785996

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function cell(v) {
  return s(v) || "—"
}

function teamHref(teamName) {
  return `/team/${encodeURIComponent(s(teamName))}`
}

/* ----------------------------- GViz parsing ----------------------------- */

function gvizExtractJson(text) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < 0) throw new Error("GViz JSON not found")
  return JSON.parse(text.slice(start, end + 1))
}

function gvizToObjects(gviz) {
  const cols = (gviz?.table?.cols || []).map((c, i) =>
    s(c?.label || c?.id || `col_${i + 1}`)
  )

  const rows = (gviz?.table?.rows || []).map(r => {
    const out = {}
    ;(r?.c || []).forEach((cell, i) => {
      const key = cols[i] || `col_${i + 1}`
      out[key] = cell ? (cell.f ?? cell.v ?? null) : null
    })
    return out
  })

  return { cols, rows }
}

function isEmptyRow(row) {
  const vals = Object.values(row || {}).map(v => s(v))
  return vals.every(v => !v)
}

function isStandingsMarkerRow(row) {
  const values = Object.values(row || {}).map(v => norm(v))
  return values.some(
    v => v.includes("standings before matchup") && v.includes("total statistics")
  )
}

function pickTeamKey(rows) {
  if (!rows?.length) return "Team"
  const keys = Object.keys(rows[0] || {})
  return (
    keys.find(k => norm(k).endsWith(" team")) ||
    keys.find(k => norm(k) === "team") ||
    keys[0] ||
    "Team"
  )
}

function chunkPairs(arr) {
  const out = []
  for (let i = 0; i < arr.length; i += 2) {
    if (arr[i] && arr[i + 1]) out.push([arr[i], arr[i + 1]])
  }
  return out
}

/* ----------------------------- standings parsing (top table) ----------------------------- */

function parseStandingsBeforeMatchup(allRows, cols) {
  if (!Array.isArray(allRows) || !allRows.length) return null
  if (!Array.isArray(cols) || cols.length < 14) return null

  const cleaned = allRows.filter(r => !isEmptyRow(r))
  const markerIdx = cleaned.findIndex(isStandingsMarkerRow)
  if (markerIdx < 0) return null

  const startIdx = markerIdx + 2
  if (startIdx >= cleaned.length) return null

  const need = 16
  if (cols.length < need) return null

  const kRank = cols[0]
  const kTeam = cols[1]
  const kW = cols[2]
  const kL = cols[3]
  const kT = cols[4]
  const kWpct = cols[5]
  const kGP = cols[6]
  const kFG = cols[7]
  const k3P = cols[8]
  const kFT = cols[9]
  const kPTS = cols[10]
  const kREB = cols[11]
  const kAST = cols[12]
  const kST = cols[13]
  const kBLK = cols[14]
  const kTO = cols[15]

  const headers = ["#", "Team", "W", "L", "T", "W%", "GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]

  const rows = []
  for (let i = startIdx; i < cleaned.length && rows.length < 12; i++) {
    const r = cleaned[i]
    const rankRaw = r?.[kRank]
    const teamName = s(r?.[kTeam])

    if (!teamName) break
    if (rankRaw == null || s(rankRaw) === "") break

    rows.push([
      rankRaw,
      teamName,
      r?.[kW],
      r?.[kL],
      r?.[kT],
      r?.[kWpct],
      r?.[kGP],
      r?.[kFG],
      r?.[k3P],
      r?.[kFT],
      r?.[kPTS],
      r?.[kREB],
      r?.[kAST],
      r?.[kST],
      r?.[kBLK],
      r?.[kTO],
    ])
  }

  if (!rows.length) return null
  return { headers, rows }
}

/* ----------------------------- category logic ----------------------------- */

const CANON_ORDER = ["FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]

function parseNumMaybe(v) {
  const str = s(v).replace(/,/g, "")
  if (!str) return null
  if (str.includes("%")) {
    const n = Number(str.replace("%", ""))
    return Number.isFinite(n) ? n : null
  }
  const n = Number(str)
  return Number.isFinite(n) ? n : null
}

function isLowerBetter(statKey) {
  const k = norm(statKey)
  return k === "to" || k.includes("turnover")
}

function compareStat(aVal, bVal, statKey) {
  const a = parseNumMaybe(aVal)
  const b = parseNumMaybe(bVal)

  if (a != null && b != null) {
    if (a === b) return 0
    if (isLowerBetter(statKey)) return a < b ? 1 : -1
    return a > b ? 1 : -1
  }

  const as = norm(aVal)
  const bs = norm(bVal)
  if (!as && !bs) return 0
  if (!as) return -1
  if (!bs) return 1
  if (as === bs) return 0
  return as > bs ? 1 : -1
}

function scoreWLT(aRow, bRow, statKeys) {
  let w = 0,
    l = 0,
    t = 0
  for (const k of statKeys) {
    const c = compareStat(aRow?.[k], bRow?.[k], k)
    if (c === 1) w++
    else if (c === -1) l++
    else t++
  }
  return { w, l, t }
}

/* ----------------------------- helpers (playouts + playoffs) ----------------------------- */

function findKeyByNorm(row, wantedNorm) {
  if (!row) return null
  const keys = Object.keys(row)
  return keys.find(k => norm(k) === wantedNorm) || null
}

/* ----- playouts ----- */

function buildPlayoutPairs(rows, leagueKey) {
  const cleaned = (rows || []).filter(r => !isEmptyRow(r))
  if (!cleaned.length) return []

  const sample = cleaned[0]
  const kLeague = findKeyByNorm(sample, "league")
  const tk = pickTeamKey(cleaned)

  const leagueNorm = norm(leagueKey)

  const filtered = cleaned.filter(r => {
    const teamName = s(r?.[tk])
    if (!teamName) return false
    if (kLeague) return norm(r?.[kLeague]) === leagueNorm
    return true
  })

  return chunkPairs(filtered)
}

function detectStatKeysFromRows(rows, teamKey) {
  if (!rows?.length) return CANON_ORDER
  const sample = rows[0] || {}
  const keys = Object.keys(sample)

  const skip = new Set(
    keys.filter(k => {
      const nk = norm(k)
      if (k === teamKey) return true
      if (nk === "league") return true
      if (nk === "result") return true
      if (nk === "score") return true
      if (nk.includes("matchup no")) return true
      if (nk.includes("category h2h")) return true
      if (nk.includes("rank")) return true
      if (nk.includes("regular league")) return true
      return false
    })
  )

  const detected = keys.filter(k => !skip.has(k))
  const canonPresent = CANON_ORDER.filter(x => detected.includes(x))
  return canonPresent.length >= 7
    ? CANON_ORDER.filter(x => detected.includes(x))
    : detected
}

/* ----- playoffs: round title from merged header in COLS ----- */

function detectRoundFromCols(cols) {
  const joined = norm((cols || []).join(" "))
  if (joined.includes("round 1")) return "Round 1"
  if (joined.includes("semifinals")) return "SEMIFINALS"
  if (joined.includes("finals")) return "FINALS"
  if (joined.includes("3rd place") || joined.includes("third place")) return "3RD PLACE"
  return "PLAYOFFS"
}

function buildPlayoffsSections(rows, cols, leagueKey) {
  const cleaned = (rows || []).filter(r => !isEmptyRow(r))
  if (!cleaned.length) return []

  const sample = cleaned[0]
  const kLeague = findKeyByNorm(sample, "league")
  const teamKey = pickTeamKey(cleaned)

  const leagueNorm = norm(leagueKey)

  const filtered = cleaned.filter(r => {
    const team = s(r?.[teamKey])
    if (!team) return false
    if (norm(team) === "bye") return false
    if (kLeague) return norm(r?.[kLeague]) === leagueNorm
    return true
  })

  const round = detectRoundFromCols(cols)

  return [
    {
      round,
      pairs: chunkPairs(filtered),
      teamKey,
    },
  ]
}

/* ----------------------------- UI components ----------------------------- */

function ScorePill({ label, value, tone }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 26,
    padding: "0 10px",
    minWidth: 44,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
    lineHeight: 1,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.20)",
    boxShadow: "0 6px 14px rgba(0,0,0,0.25)",
  }

  const tones = {
    win: {
      border: "1px solid rgba(216,120,32,0.70)",
      background: "rgba(216,120,32,0.18)",
      color: "var(--gnfc-ink)",
    },
    loss: {
      border: "1px solid rgba(0,96,96,0.70)",
      background: "rgba(0,96,96,0.18)",
      color: "var(--gnfc-ink)",
    },
    tie: {
      border: "1px solid rgba(255,255,255,0.22)",
      background: "rgba(255,255,255,0.10)",
      color: "var(--gnfc-ink)",
    },
  }

  const toneStyle = tones[tone] || {}
  return (
    <span style={{ ...base, ...toneStyle }} title={label}>
      <span style={{ opacity: 0.9 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </span>
  )
}

function StatChip({ value, tone }) {
  if (!tone) {
    return (
      <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: 0.2 }}>
        {cell(value)}
      </span>
    )
  }

  const base = {
    display: "inline-block",
    minWidth: 70,
    textAlign: "center",
    padding: "6px 10px",
    borderRadius: 10,
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: 0.2,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.14)",
  }

  const toneStyle =
    tone === "a"
      ? { border: "1px solid rgba(216,120,32,0.40)", background: "rgba(216,120,32,0.10)" }
      : tone === "b"
      ? { border: "1px solid rgba(0,96,96,0.40)", background: "rgba(0,96,96,0.10)" }
      : tone === "tie"
      ? { border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.03)" }
      : {}

  return <span style={{ ...base, ...toneStyle }}>{cell(value)}</span>
}

function MatchupCard({ a, b, teamKey, statKeys }) {
  const aName = cell(a?.[teamKey])
  const bName = cell(b?.[teamKey])

  const { w, l, t } = useMemo(() => scoreWLT(a, b, statKeys), [a, b, statKeys])

  return (
    <div className="card" style={{ padding: 0, overflow: "visible" }}>
      <div style={matchupHeader}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>
          <Link to={teamHref(aName)} style={teamNameLink}>
            {aName}
          </Link>{" "}
          <span style={{ color: "var(--gnfc-muted)", fontWeight: 700 }}>vs</span>{" "}
          <Link to={teamHref(bName)} style={teamNameLink}>
            {bName}
          </Link>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <ScorePill label="W" value={w} tone="win" />
          <ScorePill label="L" value={l} tone="loss" />
          <ScorePill label="T" value={t} tone="tie" />
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(0,0,0,0.18)" }}>
            <th style={thStyle}>Cat</th>
            <th style={{ ...thStyle, textAlign: "center" }}>{aName}</th>
            <th style={{ ...thStyle, textAlign: "center" }}>{bName}</th>
          </tr>
        </thead>

        <tbody>
          {statKeys.map((k, idx) => {
            const aVal = a?.[k]
            const bVal = b?.[k]
            const cmp = compareStat(aVal, bVal, k)

            const aTone = cmp === 1 ? "a" : cmp === 0 ? "tie" : null
            const bTone = cmp === -1 ? "b" : cmp === 0 ? "tie" : null

            return (
              <tr key={k} style={rowStyle(idx)}>
                <td style={{ ...tdStyle, fontWeight: 900 }}>
                  {k}
                  {isLowerBetter(k) ? (
                    <span style={{ marginLeft: 8, color: "var(--gnfc-muted)", fontWeight: 700, fontSize: 11 }}>
                      (lower)
                    </span>
                  ) : null}
                </td>

                <td style={{ ...tdStyle, textAlign: "center" }}>
                  <StatChip value={aVal} tone={aTone} />
                </td>

                <td style={{ ...tdStyle, textAlign: "center" }}>
                  <StatChip value={bVal} tone={bTone} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------------- page ----------------------------- */

export default function LeaguePage() {
  const { league } = useParams()
  const leagueKey = decodeURIComponent(league || DEFAULT_LEAGUE_KEY)
  const navigate = useNavigate()

  const leagueOptions = useMemo(() => {
    const keys = Object.keys(LEAGUE_GIDS || {})
    const rest = keys.filter(k => k !== leagueKey).sort((a, b) => a.localeCompare(b))
    return [leagueKey, ...rest]
  }, [leagueKey])

  const gid = LEAGUE_GIDS?.[leagueKey] ?? LEAGUE_GIDS?.[DEFAULT_LEAGUE_KEY] ?? 0

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [allRows, setAllRows] = useState([])
  const [cols, setCols] = useState([])

  const [playoutsLoading, setPlayoutsLoading] = useState(true)
  const [playoutsError, setPlayoutsError] = useState("")
  const [playoutsRows, setPlayoutsRows] = useState([])

  const [playoffsLoading, setPlayoffsLoading] = useState(true)
  const [playoffsError, setPlayoffsError] = useState("")
  const [playoffsRows, setPlayoffsRows] = useState([])
  const [playoffsCols, setPlayoffsCols] = useState([])

  const [view, setView] = useState("matchups") // "matchups" | "playouts" | "playoffs"

  // fetch normal league
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setLoading(true)
        setError("")

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`
        const res = await fetch(url)
        const text = await res.text()

        const gviz = gvizExtractJson(text)
        const parsed = gvizToObjects(gviz)

        if (!alive) return
        setCols(parsed.cols || [])
        setAllRows(parsed.rows || [])
      } catch (e) {
        if (!alive) return
        setError(e?.message || "Failed to fetch league data")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [gid])

  // fetch playoffs
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setPlayoffsLoading(true)
        setPlayoffsError("")

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${PLAYOFFS_GID}`
        const res = await fetch(url)
        const text = await res.text()

        const gviz = gvizExtractJson(text)
        const parsed = gvizToObjects(gviz)

        if (!alive) return
        setPlayoffsCols(parsed.cols || [])
        setPlayoffsRows(parsed.rows || [])
      } catch (e) {
        if (!alive) return
        setPlayoffsError(e?.message || "Failed to fetch playoffs data")
      } finally {
        if (!alive) return
        setPlayoffsLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [leagueKey])

  // fetch playouts
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setPlayoutsLoading(true)
        setPlayoutsError("")

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${PLAYOUTS_GID}`
        const res = await fetch(url)
        const text = await res.text()

        const gviz = gvizExtractJson(text)
        const parsed = gvizToObjects(gviz)

        if (!alive) return
        setPlayoutsRows(parsed.rows || [])
      } catch (e) {
        if (!alive) return
        setPlayoutsError(e?.message || "Failed to fetch playouts data")
      } finally {
        if (!alive) return
        setPlayoutsLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [leagueKey])

  const standingsBefore = useMemo(() => parseStandingsBeforeMatchup(allRows, cols), [allRows, cols])

  const { matchups, teamKey, statKeys } = useMemo(() => {
    const cleaned = (allRows || []).filter(r => !isEmptyRow(r))
    const stopIdx = cleaned.findIndex(isStandingsMarkerRow)
    const firstTable = stopIdx >= 0 ? cleaned.slice(0, stopIdx) : cleaned

    const tk = pickTeamKey(firstTable)
    const keys = firstTable.length ? Object.keys(firstTable[0]) : []
    const detectedStats = keys.filter(k => {
      const nk = norm(k)
      if (k === tk) return false
      if (nk.includes("http") || nk.includes("fantrax") || nk.includes("link")) return false
      return true
    })

    const canonPresent = CANON_ORDER.filter(x => detectedStats.includes(x))
    const ordered = canonPresent.length >= 7 ? CANON_ORDER.filter(x => detectedStats.includes(x)) : detectedStats

    return { matchups: chunkPairs(firstTable), teamKey: tk, statKeys: ordered }
  }, [allRows])

  const playoffsSections = useMemo(() => {
    const cleaned = (playoffsRows || []).filter(r => !isEmptyRow(r))
    const sections = buildPlayoffsSections(cleaned, playoffsCols, leagueKey)

    const firstPairRow = sections?.[0]?.pairs?.[0]?.[0]
    const tk = sections?.[0]?.teamKey || pickTeamKey(cleaned)
    const keys = detectStatKeysFromRows(firstPairRow ? [firstPairRow] : cleaned, tk)

    return { sections, teamKey: tk, statKeys: keys }
  }, [playoffsRows, playoffsCols, leagueKey])

  const { playoutPairs, playoutTeamKey, playoutStatKeys } = useMemo(() => {
    const cleaned = (playoutsRows || []).filter(r => !isEmptyRow(r))
    const pairs = buildPlayoutPairs(cleaned, leagueKey)
    const flat = pairs.flat()

    const tk = pickTeamKey(flat.length ? flat : cleaned)
    const stats = detectStatKeysFromRows(flat.length ? flat : cleaned, tk)

    return { playoutPairs: pairs, playoutTeamKey: tk, playoutStatKeys: stats }
  }, [playoutsRows, leagueKey])

  const showingPairs = view === "playouts" ? playoutPairs : matchups
  const showingTeamKey = view === "playouts" ? playoutTeamKey : teamKey
  const showingStatKeys = view === "playouts" ? playoutStatKeys : statKeys

  const showingLoading =
    view === "playouts" ? playoutsLoading : view === "playoffs" ? playoffsLoading : loading

  const showingError =
    view === "playouts" ? playoutsError : view === "playoffs" ? playoffsError : error

  const playoffsCount = playoffsSections.sections.reduce((sum, sec) => sum + sec.pairs.length, 0)

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />
          <div className="brand-title">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0 }}>{leagueKey}</h1>

              <select
                value={leagueKey}
                onChange={(e) => navigate(`/league/${encodeURIComponent(e.target.value)}`)}
                aria-label="Select league"
                style={leagueSelect}
              >
                {leagueOptions.map(k => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <p>Live results • Select other league via the Dropdown Menu above</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              ← Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        {showingLoading && <div className="notice">Loading…</div>}
        {showingError && <div className="notice">Error: {showingError}</div>}

        {!showingLoading && !showingError && (
          <>
            {standingsBefore && (
              <>
                <div className="sectionTitle" style={{ marginTop: 0 }}>
                  <span className="badge">Standings</span>
                  <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                    Before matchup • total statistics
                  </span>
                </div>

                <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.18)" }}>
                          {standingsBefore.headers.map((h, idx) => (
                            <th
                              key={h + idx}
                              style={{
                                ...thStyle,
                                textAlign: idx <= 1 ? "left" : "right",
                                width: idx === 0 ? 56 : idx === 1 ? 260 : "auto",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {standingsBefore.rows.map((r, i) => (
                          <tr key={(r?.[1] ?? "row") + i} style={rowStyle(i)}>
                            {r.map((v, idx) => {
                              const isTeam = idx === 1
                              return (
                                <td
                                  key={idx}
                                  style={{
                                    ...tdStyle,
                                    textAlign: idx <= 1 ? "left" : "right",
                                    fontWeight: idx === 1 ? 900 : 700,
                                    color: idx === 0 ? "var(--gnfc-muted)" : undefined,
                                  }}
                                >
                                  {isTeam ? (
                                    <Link to={teamHref(v)} style={teamLinkInline}>
                                      {cell(v)}
                                    </Link>
                                  ) : (
                                    cell(v)
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div className="sectionTitle" style={{ alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setView("matchups")}
                  style={view === "matchups" ? tabPillActive : tabPillInactive}
                  aria-pressed={view === "matchups"}
                >
                  Matchups
                </button>

                <button
                  type="button"
                  onClick={() => setView("playoffs")}
                  style={view === "playoffs" ? tabPillActive : tabPillInactive}
                  aria-pressed={view === "playoffs"}
                >
                  Playoffs
                </button>

                <button
                  type="button"
                  onClick={() => setView("playouts")}
                  style={view === "playouts" ? tabPillActive : tabPillInactive}
                  aria-pressed={view === "playouts"}
                >
                  Playouts
                </button>
              </div>

              <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                {view === "playoffs"
                  ? `${playoffsCount} matchups`
                  : `${showingPairs.length} matchups • ${showingPairs.length * 2} teams`}
              </span>
            </div>

            {view !== "playoffs" ? (
              <div className="matchupGrid">
                {showingPairs.map(([a, b], idx) => (
                  <MatchupCard
                    key={`${view}-${idx}`}
                    a={a}
                    b={b}
                    teamKey={showingTeamKey}
                    statKeys={showingStatKeys}
                  />
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {playoffsSections.sections.map((sec, sidx) => (
                  <div key={`${sec.round}-${sidx}`}>
                    <div className="sectionTitle" style={{ marginTop: sidx === 0 ? 0 : 10 }}>
                      <span className="badge">{sec.round}</span>
                      <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                        {sec.pairs.length} matchups
                      </span>
                    </div>

                    <div className="matchupGrid">
                      {sec.pairs.map(([a, b], idx) => (
                        <MatchupCard
                          key={`playoffs-${sec.round}-${idx}`}
                          a={a}
                          b={b}
                          teamKey={playoffsSections.teamKey}
                          statKeys={playoffsSections.statKeys}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        .matchupGrid{
          display:grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 860px){
          .matchupGrid{
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (min-width: 1250px){
          .matchupGrid{
            grid-template-columns: 1fr 1fr 1fr;
          }
        }
      `}</style>
    </>
  )
}

/* ----------------------------- styles ----------------------------- */

const matchupHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "14px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.10))",
}

const teamLinkInline = {
  textDecoration: "none",
  color: "var(--gnfc-ink)",
  fontWeight: 900,
}

const thStyle = {
  textAlign: "left",
  padding: "12px 12px",
  fontSize: 12,
  color: "var(--gnfc-muted)",
  letterSpacing: 0.3,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
}

const leagueSelect = {
  height: 32,
  padding: "0 34px 0 10px",
  borderRadius: 10,
  border: "1px solid var(--gnfc-border)",
  background: "var(--gnfc-surface)",
  color: "var(--gnfc-ink)",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: 0.2,
  outline: "none",
  cursor: "pointer",

  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  backgroundImage:
    "linear-gradient(45deg, transparent 50%, var(--gnfc-ink) 50%)," +
    "linear-gradient(135deg, var(--gnfc-ink) 50%, transparent 50%)",
  backgroundPosition: "calc(100% - 16px) 13px, calc(100% - 11px) 13px",
  backgroundSize: "5px 5px, 5px 5px",
  backgroundRepeat: "no-repeat",
}

const tdStyle = {
  padding: "12px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 14,
}

const teamNameLink = {
  color: "inherit",
  textDecoration: "none",
  fontWeight: "inherit",
}

const tabPillActive = {
  cursor: "pointer",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: 0.2,
  border: "1px solid rgba(216,120,32,0.55)",
  background: "rgba(216,120,32,0.12)",
  color: "var(--gnfc-ink)",
}

const tabPillInactive = {
  cursor: "pointer",
  padding: "6px 2px",
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: 0.2,
  border: "none",
  background: "transparent",
  color: "var(--gnfc-muted)",
}

const rowStyle = idx => ({
  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)",
})