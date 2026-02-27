// src/pages/DivisionPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTeams } from "../hooks/useTeams"

/* ----------------------------- config ----------------------------- */

// ✅ Put this in .env: VITE_GNFC_SHEET_ID="YOUR_SHEET_ID"
const SHEET_ID = import.meta.env.VITE_GNFC_SHEET_ID || "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"

const GEN_GID_BY_DIV = {
  A: "1782234437",
  B: "248040938",
  "Γ": "393014208"
}

// ✅ Weekly standings sheets
const WK_GID_BY_DIV = {
  A: "559899738", // WkA
  B: "1280251660", // WkB
  "Γ": "387039955" // WkΓ
}

/* ----------------------------- tiny utils ----------------------------- */

function toNum(x) {
  const s = String(x ?? "").replace(/[%,$]/g, "").trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function leagueNumber(leagueRaw) {
  const league = String(leagueRaw ?? "").trim().toUpperCase()
  const m = league.match(/(\d+)/)
  return m ? Number(m[1]) : 9999
}

function cell(v) {
  return String(v ?? "").trim() || "—"
}

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function stripPct(x) {
  // handles "54.3%", "54,3%", "0.543", "0,543"
  const t = String(x ?? "").replace(/[％]/g, "%").trim()
  if (!t) return null
  const y = t.replace(",", ".")
  const m = y.match(/-?\d+(\.\d+)?/)
  if (!m) return null
  let n = Number(m[0])
  if (!Number.isFinite(n)) return null
  if (t.includes("%") && n > 1) n = n / 100
  return n
}

/* ----------------------------- General/Weekly: header rename + hidden columns ---- */

function cleanHeader(h) {
  const x = s(h).replace(/[％]/g, "%")

  if (x.includes("GENERAL STANDINGS GENERAL RANKING") && x.includes("Regular Ranking")) return "Rank"
  if (x.includes("WEEKLY STANDINGS WEEKLY RANKING") && x.includes("Official Ranking")) return "Rank"
  if (x.includes("POINTS SYSTEM") && x.includes("W% points")) return "W% points"

  // ✅ weekly FG% rename
  if (norm(x) === "weekly statistics fg%") return "FG%"
  if (norm(x) === "weekly statistics rankings fg%") return "FG% Rank"

  return x
}

// ✅ Columns to hide (match by normalized header text)
const HIDE_GEN_COLS = new Set([
  "gp",
  "fg%",
  "3p",
  "ft%",
  "pts",
  "reb",
  "ast",
  "st",
  "blk",
  "to",
  "general statistics fg%",
  "general statistics rankings gp"
])

const HIDE_PREFIXES = ["general statistics", "general statistics rankings"]

/* ----------------------------- GViz helpers ----------------------------- */

function gvizExtractJson(text) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("GViz JSON not found in response")
  return JSON.parse(text.slice(start, end + 1))
}

function cellValue(c) {
  if (!c) return ""
  if (c.f != null) return String(c.f)
  if (c.v == null) return ""
  return String(c.v)
}

async function fetchGvizTable({ sheetId, gid, mode = "general" }) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GViz request failed (${res.status})`)
  const text = await res.text()
  const json = gvizExtractJson(text)
  const table = json?.table
  const cols = table?.cols || []
  const rows = table?.rows || []

  const rawHeaders = cols.map(c => s(c?.label) || "")
  const data = rows.map(r => (r?.c || []).map(cellValue))

  const lastNonEmptyCol = (() => {
    let last = rawHeaders.length - 1
    for (; last >= 0; last--) {
      const h = rawHeaders[last]
      const any = data.some(row => s(row?.[last]))
      if (s(h) || any) return last
    }
    return -1
  })()

  const headers0 = rawHeaders.slice(0, lastNonEmptyCol + 1).map(cleanHeader)
  const rows0 = data.map(r => r.slice(0, lastNonEmptyCol + 1))

  const BAD_HEADERS = new Set(["", "—", "-", "–", "— —"])
  function isDashy(v) {
    const x = s(v)
    return x === "" || x === "—" || x === "-" || x === "–"
  }

  const keepIdx = headers0
    .map((h, i) => ({ h, i, nh: norm(h) }))
    .filter(x => {
      if (mode === "general") {
        if (HIDE_GEN_COLS.has(x.nh)) return false
        if (HIDE_PREFIXES.some(p => x.nh.startsWith(p))) return false
      }
      if (BAD_HEADERS.has(s(x.h))) return false
      const colAllDash = rows0.every(r => isDashy(r?.[x.i]))
      if (colAllDash) return false
      return true
    })
    .map(x => x.i)

  const headers = keepIdx.map(i => headers0[i])
  const outRows = rows0.map(r => keepIdx.map(i => r?.[i] ?? ""))

  // ✅ WEEKLY: keep columns only up to the FIRST "TO"
  if (mode === "weekly") {
    const firstToIdx = headers.findIndex(h => norm(h) === "to")
    if (firstToIdx !== -1) {
      const cut = firstToIdx + 1
      return {
        headers: headers.slice(0, cut),
        rows: outRows.map(r => r.slice(0, cut))
      }
    }
  }

  return { headers, rows: outRows }
}

/* ----------------------------- UI helpers ----------------------------- */

function rankPill(v) {
  const raw = String(v ?? "").trim()
  const n = Number(raw)
  if (!Number.isFinite(n)) return cell(v)

  const isGreen = n >= 1 && n <= 6
  const isRed = n === 10 || n === 11 || n === 12

  const style = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 34,
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    color: "#000",
    background: "rgba(203,213,225,0.90)",
    border: "1px solid rgba(0,0,0,0.22)",
    boxShadow: "0 1px 0 rgba(0,0,0,0.10)"
  }

  if (isGreen) style.background = "rgba(34,197,94,0.92)"
  else if (isRed) style.background = "rgba(239,68,68,0.92)"

  return <span style={style}>{n}</span>
}

function TogglePill({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 12px",
        borderRadius: 999,
        border: active ? "1px solid rgba(249,115,22,0.55)" : "1px solid rgba(255,255,255,0.14)",
        background: active ? "rgba(249,115,22,0.18)" : "rgba(255,255,255,0.06)",
        color: "var(--gnfc-text)",
        fontWeight: 900,
        fontSize: 12,
        cursor: "pointer",
        whiteSpace: "nowrap"
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

/* ----------------------------- sorting helpers ----------------------------- */

function parseSortableValue(v) {
  const t = s(v)
  if (!t || t === "—") return { type: "empty", n: null, s: "" }

  // Percent-like
  if (t.includes("%") || /fg%|ft%|w%/i.test(t)) {
    const p = stripPct(t)
    if (p != null) return { type: "num", n: p, s: t }
  }

  // Plain number (including commas)
  const num = Number(t.replace(/,/g, ""))
  if (Number.isFinite(num)) return { type: "num", n: num, s: t }

  return { type: "str", n: null, s: t.toLowerCase() }
}

function SortIcon({ active, dir }) {
  return (
    <span style={{ marginLeft: 6, opacity: active ? 1 : 0.45, fontSize: 12 }}>
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  )
}

/* ----------------------------- component ----------------------------- */

export default function DivisionPage() {
  const navigate = useNavigate()
  const { div } = useParams() // "A" | "B" | "Γ"
  const division = decodeURIComponent(div || "")
  const { loading, error, teams } = useTeams()

  // ✅ standings mode switch
  const [standingsMode, setStandingsMode] = useState("general") // "general" | "weekly"

  // ✅ Standings state (General or Weekly)
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState("")
  const [genHeaders, setGenHeaders] = useState([])
  const [genRows, setGenRows] = useState([])

  const [selectedLeague, setSelectedLeague] = useState("")

  // ✅ sorting state for standings table
  const [sortKey, setSortKey] = useState({ col: -1, dir: "asc" })

  useEffect(() => {
    const gid = standingsMode === "weekly" ? WK_GID_BY_DIV[division] : GEN_GID_BY_DIV[division]

    if (!gid) {
      setGenHeaders([])
      setGenRows([])
      setGenError("")
      return
    }

    let alive = true
    ;(async () => {
      try {
        setGenLoading(true)
        setGenError("")
        const out = await fetchGvizTable({ sheetId: SHEET_ID, gid, mode: standingsMode })
        if (!alive) return
        setGenHeaders(out.headers)
        setGenRows(out.rows)

        // default sort by Rank if present
        const rankIdx = out.headers.findIndex(h => norm(h) === "rank")
        setSortKey(rankIdx !== -1 ? { col: rankIdx, dir: "asc" } : { col: -1, dir: "asc" })
      } catch (e) {
        if (!alive) return
        setGenError(e?.message || "Failed to load standings")
        setGenHeaders([])
        setGenRows([])
      } finally {
        if (alive) setGenLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [division, standingsMode])

  const leagues = useMemo(() => {
    const filtered = teams.filter(t => t.division === division)
    const out = {}
    for (const t of filtered) {
      out[t.league] ||= []
      out[t.league].push(t)
    }

    for (const lg of Object.keys(out)) {
      out[lg].sort((a, b) => {
        const ar = toNum(a.leagueRanking)
        const br = toNum(b.leagueRanking)
        if (ar == null && br == null) return a.team.localeCompare(b.team)
        if (ar == null) return 1
        if (br == null) return -1
        return ar - br
      })
    }

    const leagueKeys = Object.keys(out).sort((a, b) => leagueNumber(a) - leagueNumber(b))
    return { leagueKeys, out, totalTeams: filtered.length }
  }, [teams, division])

  const teamColIdx = useMemo(() => {
    if (!genHeaders?.length) return -1
    const candidates = ["team", "ομαδα", "ομάδα", "club", "squad"]
    const idx = genHeaders.findIndex(h => candidates.includes(norm(h)))
    if (idx !== -1) return idx
    const first = genHeaders.findIndex(h => s(h))
    return first === -1 ? -1 : first
  }, [genHeaders])

  const leagueRankingColIdx = useMemo(() => {
    if (!genHeaders?.length) return -1
    return genHeaders.findIndex(h => norm(h) === "league ranking")
  }, [genHeaders])

  // ✅ sorted rows for standings
  const sortedStandingsRows = useMemo(() => {
    const rows = Array.isArray(genRows) ? [...genRows] : []
    const { col, dir } = sortKey
    if (col == null || col < 0) return rows

    rows.sort((a, b) => {
      const va = parseSortableValue(a?.[col])
      const vb = parseSortableValue(b?.[col])

      // empties last
      if (va.type === "empty" && vb.type === "empty") return 0
      if (va.type === "empty") return 1
      if (vb.type === "empty") return -1

      // numbers first if both numbers
      if (va.type === "num" && vb.type === "num") {
        const d = va.n - vb.n
        return dir === "asc" ? d : -d
      }

      // otherwise string compare
      const d = String(va.s).localeCompare(String(vb.s), undefined, { numeric: true, sensitivity: "base" })
      return dir === "asc" ? d : -d
    })

    return rows
  }, [genRows, sortKey])

  function onHeaderClick(idx) {
    setSortKey(prev => {
      if (prev.col !== idx) return { col: idx, dir: "asc" }
      return { col: idx, dir: prev.dir === "asc" ? "desc" : "asc" }
    })
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <Link to="/" aria-label="Go to homepage" style={{ display: "inline-flex" }}>
            <img src="/gnfc-logo.png" alt="GNFC Logo" style={{ cursor: "pointer" }} />
          </Link>

          <div className="brand-title">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0 }}>Division {division}</h1>

              <select
                value={selectedLeague}
                onChange={(e) => {
                  const next = e.target.value
                  setSelectedLeague(next)
                  navigate(`/league/${encodeURIComponent(next)}`)
                }}
                aria-label="Select league"
                disabled={loading || !leagues.leagueKeys?.length}
                style={leagueSelect}
              >
                <option value="" disabled>
                  Select league…
                </option>

                {leagues.leagueKeys.map(k => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <p>{leagues.totalTeams} teams • sorted by league rank</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              ← Divisions
            </Link>
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && <div className="notice">Loading…</div>}
        {error && <div className="notice">Error: {error}</div>}

        {!loading && !error && (
          <>
            {/* ✅ Standings (General / Weekly) */}
            <div style={{ marginBottom: 18 }}>
              <div
                className="sectionTitle"
                style={{
                  marginTop: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap"
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900 }}>
                    {standingsMode === "weekly" ? "Weekly Standings" : "General Standings"}
                  </span>
                  <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                    {genLoading ? "Loading…" : genRows?.length ? `${genRows.length} teams` : "—"}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <TogglePill active={standingsMode === "general"} onClick={() => setStandingsMode("general")}>
                    General
                  </TogglePill>
                  <TogglePill active={standingsMode === "weekly"} onClick={() => setStandingsMode("weekly")}>
                    Weekly
                  </TogglePill>
                </div>
              </div>

              {genError ? (
                <div className="notice">Error loading standings: {genError}</div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.18)" }}>
                          {(genHeaders?.length ? genHeaders : ["—"]).map((h, i) => {
                            const active = sortKey.col === i
                            return (
                              <th
                                key={i}
                                style={{ ...thStyle, cursor: genHeaders?.length ? "pointer" : "default", userSelect: "none" }}
                                onClick={() => genHeaders?.length && onHeaderClick(i)}
                                title={genHeaders?.length ? "Click to sort" : ""}
                              >
                                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                  {cell(h)}
                                  <SortIcon active={active} dir={sortKey.dir} />
                                </span>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>

                      <tbody>
                        {!genHeaders?.length || !sortedStandingsRows?.length ? (
                          <tr>
                            <td style={tdStyle} colSpan={Math.max(1, genHeaders?.length || 1)}>
                              {genLoading ? "Loading…" : "No standings found."}
                            </td>
                          </tr>
                        ) : (
                          sortedStandingsRows.map((r, idx) => (
                            <tr key={idx} style={rowStyle(idx)}>
                              {genHeaders.map((_, cidx) => {
                                const v = r?.[cidx] ?? ""
                                const isTeam = cidx === teamColIdx
                                return (
                                  <td key={cidx} style={tdStyle}>
                                    {cidx === leagueRankingColIdx ? (
                                      rankPill(v)
                                    ) : isTeam && s(v) ? (
                                      <Link
                                        to={`/team/${encodeURIComponent(s(v))}`}
                                        style={{ textDecoration: "none", color: "inherit", fontWeight: 900 }}
                                        title={`Open team ${s(v)}`}
                                      >
                                        {cell(v)}
                                      </Link>
                                    ) : (
                                      cell(v)
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* ✅ Leagues grid (existing) */}
            <div className="leagueGrid">
              {leagues.leagueKeys.map(league => {
                const list = leagues.out[league] || []

                return (
                  <div key={league}>
                    <div className="sectionTitle" style={{ marginTop: 0 }}>
                      <Link
                        to={`/league/${encodeURIComponent(league)}`}
                        className="badge"
                        style={{ textDecoration: "none" }}
                        title={`Open league ${league}`}
                      >
                        {league}
                      </Link>

                      <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>{list.length} teams</span>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "rgba(0,0,0,0.18)" }}>
                            <th style={thStyleLeague}>Rank</th>
                            <th style={thStyleLeague}>Team</th>
                            <th style={thStyleLeague}>Manager</th>
                          </tr>
                        </thead>

                        <tbody>
                          {list.map((t, idx) => (
                            <tr key={t.team} style={rowStyle(idx)}>
                              <td style={tdStyleLeague}>{cell(t.leagueRanking)}</td>
                              <td style={tdStyleLeague}>
                                <Link
                                  to={`/team/${encodeURIComponent(t.team)}`}
                                  style={{ textDecoration: "none", color: "inherit", fontWeight: 800 }}
                                  title={`Open team ${t.team}`}
                                >
                                  {cell(t.team)}
                                </Link>
                              </td>
                              <td style={tdStyleLeague}>{cell(t.manager)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}

/* ✅ General/Weekly Standings header: wrap + center */
const thStyle = {
  textAlign: "center",
  padding: "10px 10px",
  fontSize: 12,
  color: "var(--gnfc-muted)",
  letterSpacing: 0.3,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  whiteSpace: "normal",
  wordBreak: "normal",
  overflowWrap: "break-word",
  lineHeight: 1.15,
  verticalAlign: "middle"
}

const tdStyle = {
  textAlign: "center",
  padding: "12px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 14,
  whiteSpace: "nowrap"
}

/* ✅ League tables keep original look (no wrap) */
const thStyleLeague = {
  textAlign: "left",
  padding: "12px 12px",
  fontSize: 12,
  color: "var(--gnfc-muted)",
  letterSpacing: 0.3,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  whiteSpace: "nowrap"
}

const leagueSelect = {
  height: 34,
  borderRadius: 999,
  padding: "0 12px",
  fontSize: 13,
  fontWeight: 800,
  color: "var(--gnfc-text)",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  outline: "none",
  cursor: "pointer"
}

const tdStyleLeague = {
  padding: "12px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 14
}

const rowStyle = idx => ({
  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)"
})