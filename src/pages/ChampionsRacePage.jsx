// src/pages/ChampionsRacePage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

/* ----------------------------- config ----------------------------- */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const GID = "1647785996"
const START_COL = "BI"

const CANON_ORDER = ["FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]
const LEAGUE_KEY = "League"

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

function hasLetters(x) {
  return /[A-Za-zΑ-Ωα-ω]/.test(s(x))
}

function teamHref(teamName) {
  return `/team/${encodeURIComponent(s(teamName))}`
}

function colToIndex(col) {
  let n = 0
  const t = s(col).toUpperCase()
  for (let i = 0; i < t.length; i++) {
    n = n * 26 + (t.charCodeAt(i) - 64)
  }
  return Math.max(0, n - 1)
}

function isRowEmptyArray(arr = []) {
  return !arr.some(v => s(v))
}

function isEmptyRowObj(row) {
  const vals = Object.values(row || {}).map(v => s(v))
  return vals.every(v => !v)
}

function findKeyByNorm(row, wantedNorm) {
  if (!row) return null
  const keys = Object.keys(row)
  return keys.find(k => norm(k) === wantedNorm) || null
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
  let w = 0
  let l = 0
  let t = 0

  for (const k of statKeys) {
    const c = compareStat(aRow?.[k], bRow?.[k], k)
    if (c === 1) w++
    else if (c === -1) l++
    else t++
  }

  return { w, l, t }
}

/* ----------------------------- CSV parsing ----------------------------- */

function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === ",") {
      row.push(cur)
      cur = ""
      continue
    }

    if (ch === "\n") {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
      continue
    }

    if (ch === "\r") continue

    cur += ch
  }

  row.push(cur)
  rows.push(row)

  return rows
}

function csvToObjects(csvRows, headerRowIndex = 1) {
  const headers = (csvRows?.[headerRowIndex] || []).map(h => s(h))
  const outRows = []

  for (let i = headerRowIndex + 1; i < (csvRows || []).length; i++) {
    const r = csvRows[i] || []
    const obj = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c + 1}`
      obj[key] = r[c] != null ? s(r[c]) : ""
    }
    outRows.push(obj)
  }

  return { cols: headers, rows: outRows }
}

/* ----------------------------- champion blocks extraction ----------------------------- */

function isChampionTitleRow(row) {
  const vals = row.map(s).filter(Boolean)
  if (!vals.length) return false

  return vals.some(v => {
    const t = norm(v)
    return t.includes("category champion") || t.includes("champion")
  })
}

function getNonEmptyBounds(row) {
  const idxs = row
    .map((v, i) => (s(v) ? i : -1))
    .filter(i => i >= 0)

  if (!idxs.length) return null
  return { left: idxs[0], right: idxs[idxs.length - 1] }
}

function cleanTitle(title) {
  return s(title)
    .replace(/\s+/g, " ")
    .replace(/\bcategory champion\b/i, "Category Champion")
    .replace(/\bchampion\b/i, "Champion")
}

function isProbablyNumeric(v) {
  const t = s(v).replace(/[%,$]/g, "")
  return !!t && !Number.isNaN(Number(t))
}

function extractBlocksFromCsvRows(csvRows) {
  const startIdx = colToIndex(START_COL)
  const sliced = (csvRows || []).map(r => r.slice(startIdx))
  const blocks = []

  for (let r = 0; r < sliced.length; r++) {
    const row = sliced[r] || []
    if (!isChampionTitleRow(row)) continue

    const titleBounds = getNonEmptyBounds(row)
    if (!titleBounds) continue

    const title = row.slice(titleBounds.left, titleBounds.right + 1).map(s).join(" ").trim()

    const rawRows = []
    let left = Infinity
    let right = -1
    let emptyStreak = 0

    for (let k = r + 1; k < sliced.length; k++) {
      const next = sliced[k] || []

      if (isChampionTitleRow(next)) break

      const bounds = getNonEmptyBounds(next)

      if (!bounds) {
        emptyStreak++
        if (emptyStreak >= 2) break
        continue
      }

      emptyStreak = 0
      left = Math.min(left, bounds.left)
      right = Math.max(right, bounds.right)
      rawRows.push(next)
    }

    if (!rawRows.length || left === Infinity || right < left) continue

    const rows = rawRows.map(rr => rr.slice(left, right + 1).map(cell))

    const colCount = rows[0]?.length || 0
    const keep = Array.from({ length: colCount }, (_, c) =>
      rows.some(row2 => s(row2[c]) && row2[c] !== "—")
    )

    const trimmedRows = rows.map(row2 => row2.filter((_, i) => keep[i]))

    if (trimmedRows.length) {
      const width = trimmedRows[0].length

      blocks.push({
        title: cleanTitle(title || "Champions Race"),
        rows: trimmedRows,
        width,
        teamCol: width >= 2 ? 1 : 0,
      })
    }

    r = Math.max(r, r + rawRows.length)
  }

  return blocks
}

function buildChampionFlatHeaders(width) {
  const defaults = ["#", "Team", "W", "L", "T", "W", "L", "T", "W%", "W", "Cats", "Gen"]
  if (width <= defaults.length) return defaults.slice(0, width)

  const out = [...defaults]
  while (out.length < width) out.push("")
  return out
}

/* ----------------------------- playoffs extraction ----------------------------- */

function normalizeRoundTitle(x) {
  const raw = s(x)
  const n = norm(raw)
  if (!raw) return null

  if (n.includes("semi")) return "SEMIFINALS"
  if (n.includes("3rd") || n.includes("third")) return "3RD PLACE"
  if (n.includes("final") && !n.includes("semi")) return "FINALS"
  if (n.includes("round")) return "1st ROUND"

  return raw
}

function buildPlayoffsSectionsCsv(rows, cols, leagueKey = "") {
  const cleaned = (rows || []).filter(r => !isEmptyRowObj(r))
  if (!cleaned.length) return []

  const sample = cleaned[0]
  const kLeague = findKeyByNorm(sample, "league")
  const teamKey = pickTeamKey(cleaned)
  const leagueNorm = norm(leagueKey)
  const kFG = (cols || []).find(c => norm(c) === "fg%") || "FG%"

  const sections = []
  let currentRound = "1st ROUND"
  let bucket = []

  const flush = () => {
    const pairs = chunkPairs(bucket)
    if (pairs.length) sections.push({ round: currentRound, pairs, teamKey })
    bucket = []
  }

  for (const r of cleaned) {
    const team = s(r?.[teamKey])
    const fgCell = s(r?.[kFG])

    if (!team) {
      if (fgCell && !fgCell.includes("%") && hasLetters(fgCell)) {
        const next = normalizeRoundTitle(fgCell)
        if (next) {
          flush()
          currentRound = next
        }
      }
      continue
    }

    if (kLeague && leagueNorm && norm(r?.[kLeague]) !== leagueNorm) continue
    if (norm(team) === "bye") continue

    bucket.push(r)
  }

  flush()

  const order = ["1st ROUND", "SEMIFINALS", "FINALS", "3RD PLACE"]
  sections.sort((a, b) => order.indexOf(a.round) - order.indexOf(b.round))

  return sections
}

/* ----------------------------- UI bits ----------------------------- */

function ScorePill({ value, tone }) {
  const tones = {
    team1: {
      color: "var(--gnfc-ink)",
      border: "1px solid rgba(216,120,32,0.60)",
      background: "rgba(216,120,32,0.14)",
    },
    team2: {
      color: "var(--gnfc-ink)",
      border: "1px solid rgba(0,96,96,0.60)",
      background: "rgba(0,96,96,0.14)",
    },
    tie: {
      color: "var(--gnfc-ink)",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.06)",
    },
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 950,
        letterSpacing: 0.2,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...tones[tone],
      }}
    >
      {value}
    </span>
  )
}

function StatChip({ value, tone }) {
  if (!tone) {
    return (
      <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: 0.2 }}>
        {cell(value)}
      </span>
    )
  }

  const base = {
    display: "inline-block",
    minWidth: 62,
    textAlign: "center",
    padding: "5px 8px",
    borderRadius: 10,
    fontWeight: 800,
    fontSize: 12,
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

function MatchupCardCupLike({ matchup, statKeys, matchupNo, open, onToggle }) {
  const aTeam = matchup.a?.team
  const bTeam = matchup.b?.team

  const aName = cell(aTeam)
  const bName = cell(bTeam)

  const aLeague = s(matchup.a?.cols?.[LEAGUE_KEY])
  const bLeague = s(matchup.b?.cols?.[LEAGUE_KEY])

  const { w, l, t } = useMemo(
    () => scoreWLT(matchup.a?.cols, matchup.b?.cols, statKeys),
    [matchup, statKeys]
  )

  const matchTag = {
    display: "inline-flex",
    alignItems: "center",
    height: 18,
    padding: "0 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0.2,
    color: "var(--gnfc-ink)",
    border: "1px solid var(--gnfc-border)",
    background: "rgba(10, 122, 114, 0.06)",
    whiteSpace: "nowrap",
  }

  const leagueTag = {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.15,
    color: "var(--gnfc-muted)",
    whiteSpace: "nowrap",
  }

  const teamRow = (team, league) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
      <Link
        to={teamHref(team)}
        className="teamLinkHover"
        style={{
          textDecoration: "none",
          color: "inherit",
          fontWeight: 950,
          fontSize: 13,
          lineHeight: 1.1,
          minWidth: 0,
          maxWidth: "100%",
          whiteSpace: "normal",
          wordBreak: "normal",
          overflowWrap: "normal",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {cell(team)}
      </Link>

      {league ? <span style={leagueTag}>{league}</span> : null}
    </div>
  )

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        border: "1px solid var(--gnfc-border)",
        background: "var(--gnfc-surface)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        style={{ cursor: "pointer", padding: "10px 10px 8px" }}
        title={open ? "Click to collapse" : "Click to expand"}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={matchTag}>Final {matchupNo}</span>
            <span style={{ color: "var(--gnfc-muted)", fontWeight: 950, fontSize: 12, lineHeight: 1 }}>
              {open ? "–" : "+"} Expand
            </span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
            <ScorePill value={w} tone="team1" />
            <ScorePill value={l} tone="team2" />
            <ScorePill value={t} tone="tie" />
          </div>
        </div>

        {teamRow(aTeam, aLeague)}
        <div
          style={{
            margin: "4px 0 4px",
            color: "#db7d12",
            fontWeight: 950,
            letterSpacing: 0.35,
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          VS
        </div>
        {teamRow(bTeam, bLeague)}
      </div>

      {open ? (
        <div style={{ borderTop: "1px solid var(--gnfc-border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Cat</th>
                <th style={{ ...thStyle, textAlign: "center" }}>{aName}</th>
                <th style={{ ...thStyle, textAlign: "center" }}>{bName}</th>
              </tr>
            </thead>

            <tbody>
              {statKeys.map((k, idx) => {
                const aVal = matchup.a?.cols?.[k]
                const bVal = matchup.b?.cols?.[k]
                const cmp = compareStat(aVal, bVal, k)

                const aTone = cmp === 1 ? "a" : cmp === 0 ? "tie" : null
                const bTone = cmp === -1 ? "b" : cmp === 0 ? "tie" : null

                return (
                  <tr key={k} style={rowStyle(idx)}>
                    <td style={{ ...tdStyle, fontWeight: 900 }}>{k}</td>
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
      ) : null}
    </div>
  )
}

function renderTableCell(value, cIdx, block) {
  const v = cell(value)
  const isTeam = cIdx === block.teamCol

  if (isTeam && v !== "—" && !isProbablyNumeric(v)) {
    return (
      <Link
        to={teamHref(v)}
        className="teamLinkHover"
        style={{
          display: "inline-block",
          color: "inherit",
          textDecoration: "none",
          fontWeight: 700,
          whiteSpace: "normal",
          wordBreak: "normal",
          overflowWrap: "normal",
          lineHeight: 1.15,
        }}
      >
        {v}
      </Link>
    )
  }

  return v
}

/* ----------------------------- page ----------------------------- */

export default function ChampionsRacePage() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [csvRows, setCsvRows] = useState([])
  const [playoffsRows, setPlayoffsRows] = useState([])
  const [playoffsCols, setPlayoffsCols] = useState([])
  const [openMatchups, setOpenMatchups] = useState({})

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        setLoading(true)
        setError("")

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const text = await res.text()
        const raw = parseCsv(text)
        const parsed = csvToObjects(raw, 1)

        if (!alive) return

        setCsvRows(raw)
        setPlayoffsCols(parsed.cols || [])
        setPlayoffsRows(parsed.rows || [])
      } catch (e) {
        if (!alive) return
        setError(e?.message || "Failed to load Champions Race data")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const blocks = useMemo(() => extractBlocksFromCsvRows(csvRows), [csvRows])

  const finalsSection = useMemo(() => {
    const cleaned = (playoffsRows || []).filter(r => !isEmptyRowObj(r))
    const sections = buildPlayoffsSectionsCsv(cleaned, playoffsCols, "")
    return sections.find(sec => sec.round === "FINALS") || null
  }, [playoffsRows, playoffsCols])

  const finalsStatKeys = useMemo(() => {
    const firstPairRow = finalsSection?.pairs?.[0]?.[0]
    const sample = firstPairRow || playoffsRows?.[0] || {}
    const keys = Object.keys(sample)
    const tk = finalsSection?.teamKey || pickTeamKey(playoffsRows)

    const detectedStats = keys.filter(k => {
      const nk = norm(k)
      if (k === tk) return false
      if (nk === "league") return false
      if (nk === "result") return false
      if (nk === "score") return false
      if (nk.includes("matchup no")) return false
      if (nk.includes("category h2h")) return false
      if (nk.includes("rank")) return false
      if (nk.includes("regular league")) return false
      return true
    })

    const canonPresent = CANON_ORDER.filter(x => detectedStats.includes(x))
    return canonPresent.length >= 7
      ? CANON_ORDER.filter(x => detectedStats.includes(x))
      : detectedStats
  }, [finalsSection, playoffsRows])

  const finalsMatchups = useMemo(() => {
    return (finalsSection?.pairs || []).map(([a, b]) => ({
      a: {
        team: a?.[finalsSection.teamKey],
        cols: a,
      },
      b: {
        team: b?.[finalsSection.teamKey],
        cols: b,
      },
    }))
  }, [finalsSection])

  function toggleMatchup(idx) {
    setOpenMatchups(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <Link to="/" style={{ display: "inline-flex", textDecoration: "none" }}>
            <img src="/gnfc-logo.png" alt="GNFC Logo" />
          </Link>

          <div className="brand-title">
            <h1 style={{ margin: 0 }}>Champions Race</h1>
            <p>Category champion standings and playoff finals</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button
              type="button"
              className="badge"
              onClick={() => navigate(-1)}
              style={{ cursor: "pointer", border: "none" }}
            >
              ← Back
            </button>

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
            {!blocks.length ? (
              <div className="card">
                <div className="section-title">Champions Race</div>
                <div>No champion tables found starting from column BI.</div>
              </div>
            ) : (
              <>
                <div className="sectionTitle" style={{ marginTop: 0 }}>
                  <span className="badge">Tables</span>
                  <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                    Category champion standings
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                    alignItems: "start",
                    marginBottom: 18,
                  }}
                >
                  {blocks.map((block, idx) => {
                    const headers = ["#", "Team", "W", "L", "T", "W", "L", "T", "W%", "W", "Cats", "Gen"]

                    return (
                      <div className="card" key={`${block.title}-${idx}`} style={{ padding: 0, overflow: "hidden" }}>
                        <div style={cardHeader}>
                          <div className="section-title" style={{ marginBottom: 0 }}>
                            {block.title}
                          </div>

                          <span className="badge" style={{ whiteSpace: "nowrap" }}>
                            {block.rows.length} teams
                          </span>
                        </div>

                        <div style={{ overflowX: "hidden" }}>
  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
    <colgroup>
      <col style={{ width: "7%" }} />
      <col style={{ width: "26%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "6.7%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "7%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "7%" }} />
    </colgroup>

    <thead>
      <tr style={{ background: "rgba(0,0,0,0.22)" }}>
        <th
          rowSpan={2}
          style={{
            ...thStyle,
            textAlign: "left",
            fontWeight: 900,
            fontSize: 10,
            padding: "7px 6px",
            whiteSpace: "nowrap",
          }}
        >
          #
        </th>

        <th
          rowSpan={2}
          style={{
            ...thStyle,
            textAlign: "left",
            fontWeight: 900,
            fontSize: 10,
            padding: "7px 8px",
            whiteSpace: "nowrap",
          }}
        >
          Team
        </th>

        <th
          colSpan={3}
          style={{
            ...thStyle,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 11,
            padding: "7px 6px",
            whiteSpace: "nowrap",
          }}
        >
          Wins
        </th>

        <th
          colSpan={4}
          style={{
            ...thStyle,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 11,
            padding: "7px 6px",
            whiteSpace: "nowrap",
          }}
        >
          Categories
        </th>

        <th
          colSpan={3}
          style={{
            ...thStyle,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 11,
            padding: "7px 6px",
            whiteSpace: "nowrap",
          }}
        >
          vs All teams
        </th>
      </tr>

      <tr style={{ background: "rgba(0,0,0,0.16)" }}>
        {headers.slice(2).map((h, i) => (
          <th
            key={`${block.title}-h-${i}`}
            style={{
              ...thStyle,
              textAlign: "center",
              fontWeight: 900,
              fontSize: 10,
              padding: "7px 6px",
              whiteSpace: "nowrap",
            }}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>

    <tbody>
      {block.rows.map((row, rIdx) => (
        <tr key={`${block.title}-r-${rIdx}`} style={rowStyle(rIdx)}>
          {row.map((v, cIdx) => {
            const isTeam = cIdx === block.teamCol
            const isFirst = cIdx === 0

            return (
              <td
                key={`${block.title}-${rIdx}-${cIdx}`}
                style={{
                  ...tdStyle,
                  textAlign: cIdx <= 1 ? "left" : "center",
                  whiteSpace: isTeam ? "normal" : "nowrap",
                  wordBreak: "normal",
                  overflowWrap: "normal",
                  fontWeight: isTeam || isFirst ? 900 : 700,
                  color: isFirst ? "var(--gnfc-muted)" : undefined,
                  padding: isTeam ? "8px 10px" : "8px 6px",
                  fontSize: 12,
                  verticalAlign: "top",
                }}
              >
                {renderTableCell(v, cIdx, block)}
              </td>
            )
          })}
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

            {!!finalsMatchups.length && (
              <>
                <div className="sectionTitle" style={{ marginTop: 0 }}>
                  <span className="badge">Finals</span>
                  <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                    Playoffs final matchups
                  </span>
                </div>

                <div className="matchupGrid matchupGridCompact">
                  {finalsMatchups.map((matchup, idx) => (
                    <MatchupCardCupLike
                      key={`finals-${idx}`}
                      matchup={matchup}
                      statKeys={finalsStatKeys}
                      matchupNo={idx + 1}
                      open={!!openMatchups[idx]}
                      onToggle={() => toggleMatchup(idx)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <style>{`
        .matchupGrid{
          display:grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 640px){
          .matchupGridCompact{
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (min-width: 960px){
          .matchupGridCompact{
            grid-template-columns: 1fr 1fr 1fr;
          }
        }
        @media (min-width: 1280px){
          .matchupGridCompact{
            grid-template-columns: 1fr 1fr 1fr 1fr;
          }
        }

        .teamLinkHover{
          transition: color .15s ease;
        }
        .teamLinkHover:hover{
          color: #db7d12 !important;
        }
      `}</style>
    </>
  )
}

/* ----------------------------- styles ----------------------------- */

const cardHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.10))",
  flexWrap: "wrap",
}

const thStyle = {
  textAlign: "left",
  padding: "8px 8px",
  fontSize: 11,
  color: "var(--gnfc-muted)",
  letterSpacing: 0.15,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  whiteSpace: "nowrap",
}

const tdStyle = {
  padding: "9px 8px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 12,
}

const rowStyle = idx => ({
  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)",
})