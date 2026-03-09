// src/pages/GnfcCupPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

/* ============================== config ============================== */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const CUP_GID = "784537326"
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${CUP_GID}`

// Fixed columns (0-based indexes)
const COL_MATCHUP_NO = 0 // A
const COL_TEAM = 1 // B
const COL_STATS_START = 2 // C
const COL_STATS_END_EXCL = 12 // up to L (index 11)
const COL_ROUND_TITLE = 3 // D
const COL_LEAGUE = 14 // O

// Group standings block: AL..AW
const COL_GS_START = 37 // AL
const COL_GS_END_EXCL = 49 // AW inclusive -> slice(37,49)
const GROUP_HEADERS = ["Team", "Games", "Wins", "Loses", "Ties", "W%"]

const LEAGUE_KEY = "League"

/* ============================== tiny utils ============================== */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}
function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}
function cell(v) {
  const t = s(v)
  return t || "—"
}
function toNumLoose(v) {
  const t = s(v).replace(/[%,$]/g, "").trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function isEmptyRow(row) {
  return (row || []).every((v) => !s(v))
}
function teamHref(team) {
  const name = s(team)
  if (!name) return "#"
  return `/team/${encodeURIComponent(name)}`
}
function isWeekRoundTitle(v) {
  return norm(v).includes("week")
}
function isLikelyHeaderWord(v) {
  const t = norm(v)
  return (
    t === "team" ||
    t === "teams" ||
    t === "games" ||
    t === "wins" ||
    t === "losses" ||
    t === "loses" ||
    t === "ties" ||
    t === "w%" ||
    t === "pct" ||
    t === "percentage"
  )
}

// Robust CSV parser (quotes, commas, newlines)
function parseCSV(text) {
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
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ",") {
        row.push(cur)
        cur = ""
      } else if (ch === "\n") {
        row.push(cur)
        rows.push(row)
        row = []
        cur = ""
      } else {
        cur += ch
      }
    }
  }

  row.push(cur)
  rows.push(row)
  while (rows.length && isEmptyRow(rows[rows.length - 1])) rows.pop()
  return rows
}

/* ============================== theme tokens ============================== */

const surface = "var(--gnfc-surface)"
const border = "var(--gnfc-border)"
const ink = "var(--gnfc-ink)"
const muted = "var(--gnfc-muted)"
const orange = "var(--gnfc-orange)" // team1
const green = "var(--gnfc-green)" // team2

// tie red
const tieRed = "rgba(220, 38, 38, 0.95)"
const tieRedBg = "rgba(220, 38, 38, 0.10)"
const tieRedBd = "rgba(220, 38, 38, 0.35)"

/* ============================== round UI ============================== */

const roundHeaderBtn = {
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "transparent",
  border: "none",
  cursor: "pointer",
}

const roundPill = {
  display: "inline-flex",
  alignItems: "center",
  height: 22,
  padding: "0 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: 0.2,
  color: ink,
  border: `1px solid ${border}`,
  background: "rgba(10, 122, 114, 0.06)",
  whiteSpace: "nowrap",
}

const subtleCount = {
  color: muted,
  fontWeight: 800,
  fontSize: 13,
  whiteSpace: "nowrap",
}

/* ============================== matchup table styles ============================== */

const thStyle = {
  padding: "8px 8px",
  fontSize: 12,
  letterSpacing: 0.25,
  fontWeight: 900,
  color: muted,
  borderBottom: `1px solid ${border}`,
  whiteSpace: "nowrap",
  background: "rgba(10, 122, 114, 0.06)",
}

const tdStyle = {
  padding: "7px 8px",
  fontSize: 13,
  color: ink,
  borderBottom: `1px solid ${border}`,
  whiteSpace: "nowrap",
}

function rowStyle(idx) {
  return { background: idx % 2 ? "rgba(10, 122, 114, 0.035)" : "transparent" }
}

/* ============================== stat compare & WLT ============================== */

function compareStat(aVal, bVal, key) {
  const k = norm(key)
  const aNum = toNumLoose(aVal)
  const bNum = toNumLoose(bVal)

  if (aNum !== null && bNum !== null) {
    // Turnovers: lower is better
    if (k === "to" || k === "tov" || k.includes("turnover")) {
      if (aNum < bNum) return 1
      if (aNum > bNum) return -1
      return 0
    }
    // Everything else: higher is better
    if (aNum > bNum) return 1
    if (aNum < bNum) return -1
    return 0
  }

  const aS = norm(aVal)
  const bS = norm(bVal)
  if (!aS && !bS) return 0
  if (aS === bS) return 0
  return aS > bS ? 1 : -1
}

// W = cats won by team1, L = cats won by team2, T = ties
function scoreWLT(aCols, bCols, statKeys) {
  let w = 0,
    l = 0,
    t = 0
  for (const k of statKeys) {
    const cmp = compareStat(aCols?.[k], bCols?.[k], k)
    if (cmp === 1) w++
    else if (cmp === -1) l++
    else t++
  }
  return { w, l, t }
}

/* ============================== chips/pills ============================== */

// tone: "a" => team1 wins (orange pill), "b" => team2 wins (green pill), "tie" => red pill, null => LOSER (no enclosure)
function StatChip({ value, tone }) {
  const v = cell(value)

  // LOSER: no enclosure/frame
  if (!tone) {
    return <span style={{ display: "inline-block", fontWeight: 900, fontSize: 13, color: ink }}>{v}</span>
  }

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
    height: 20,
    padding: "0 7px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.15,
    color: ink,
  }

  const team1 = { border: "1px solid rgba(219, 125, 18, 0.55)", background: "rgba(219, 125, 18, 0.14)" }
  const team2 = { border: "1px solid rgba(5, 97, 97, 0.40)", background: "rgba(5, 97, 97, 0.12)" }
  const tie = { border: `1px solid ${tieRedBd}`, background: tieRedBg, color: tieRed }

  const st = tone === "a" ? { ...base, ...team1 } : tone === "b" ? { ...base, ...team2 } : { ...base, ...tie }
  return <span style={st}>{v}</span>
}

// header pills: numbers only
function ScorePill({ value, tone }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    height: 22,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: 0.2,
    lineHeight: 1,
  }

  const team1 = { border: "1px solid rgba(219, 125, 18, 0.55)", background: "rgba(219, 125, 18, 0.14)", color: ink }
  const team2 = { border: "1px solid rgba(5, 97, 97, 0.40)", background: "rgba(5, 97, 97, 0.12)", color: ink }
  const tie = { border: `1px solid ${tieRedBd}`, background: tieRedBg, color: tieRed }

  const st = tone === "team1" ? { ...base, ...team1 } : tone === "team2" ? { ...base, ...team2 } : { ...base, ...tie }
  return <span style={st}>{cell(value)}</span>
}

/* ============================== Matchup Card (accordion) ============================== */

function MatchupCardCup({ matchup, statKeys, matchupNo, open, onToggle }) {
  const aTeam = matchup.a?.team
  const bTeam = matchup.b?.team

  const aName = cell(aTeam)
  const bName = cell(bTeam)

  const aLeague = s(matchup.a?.cols?.[LEAGUE_KEY])
  const bLeague = s(matchup.b?.cols?.[LEAGUE_KEY])

  const { w, l, t } = useMemo(() => scoreWLT(matchup.a?.cols, matchup.b?.cols, statKeys), [matchup, statKeys])

  const matchTag = {
    display: "inline-flex",
    alignItems: "center",
    height: 18,
    padding: "0 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0.2,
    color: ink,
    border: `1px solid ${border}`,
    background: "rgba(10, 122, 114, 0.06)",
    whiteSpace: "nowrap",
  }

  const leagueTag = {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.15,
    color: muted, // same for both
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
          wordBreak: "break-word",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {cell(team)}
      </Link>

      {league ? <span style={leagueTag}>{league}</span> : null}
    </div>
  )

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", border: `1px solid ${border}`, background: surface }}>
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
        {/* Top row: title + pills */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={matchTag}>Matchup {matchupNo}</span>
            <span style={{ color: muted, fontWeight: 950, fontSize: 12, lineHeight: 1 }}>{open ? "–" : "+"} Expand</span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
            <ScorePill value={w} tone="team1" />
            <ScorePill value={l} tone="team2" />
            <ScorePill value={t} tone="tie" />
          </div>
        </div>

        {teamRow(aTeam, aLeague)}
        <div style={{ margin: "4px 0 4px", color: orange, fontWeight: 950, letterSpacing: 0.35, fontSize: 13, lineHeight: 1 }}>
          VS
        </div>
        {teamRow(bTeam, bLeague)}
      </div>

      {open ? (
        <div style={{ borderTop: `1px solid ${border}` }}>
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

/* ============================== page ============================== */

function dedupeByTeam(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const key = norm(r.Team)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export default function GnfcCupPage() {
  const nav = useNavigate()

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [rawStatKeys, setRawStatKeys] = useState([]) // headers from C..L
  const [rounds, setRounds] = useState([])
  const [openRounds, setOpenRounds] = useState({})
  const [openCards, setOpenCards] = useState({})

  const [groupRows, setGroupRows] = useState([]) // {Team, Games, Wins, Loses, Ties, "W%"}
  const [podium, setPodium] = useState({ first: "", second: "" })

  // C..L cats table keys (remove GP and remove "League" if it somehow exists there)
  const statKeys = useMemo(
    () =>
      rawStatKeys.filter((k) => {
        const nk = norm(k)
        if (nk === "gp") return false
        if (nk === norm(LEAGUE_KEY)) return false
        return true
      }),
    [rawStatKeys]
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setErr("")

        const res = await fetch(CSV_URL, { cache: "no-store" })
        if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`)
        const text = await res.text()

        const grid = parseCSV(text)
        if (!grid?.length) throw new Error("CSV is empty")

        // Row 2 (index 1) headers for stats C..L (even if they are not perfect, we trust positions)
        const headerRow = grid[1] || []
        const headersCL = headerRow.slice(COL_STATS_START, COL_STATS_END_EXCL).map(s).filter(Boolean)
        setRawStatKeys(headersCL)

        // --- Parse matchups (with fallback if col A empty) ---
        let currentRound = ""
        const roundMap = new Map() // roundTitle -> Map(matchKey -> { displayNo, order, teams:[] })

        const autoCounterByRound = new Map()
        const maxNumByRound = new Map()
        const pendingTeamsByRound = new Map()

        function ensureRound(roundKey) {
          if (!roundMap.has(roundKey)) roundMap.set(roundKey, new Map())
          if (!autoCounterByRound.has(roundKey)) autoCounterByRound.set(roundKey, 1)
          if (!maxNumByRound.has(roundKey)) maxNumByRound.set(roundKey, 0)
          if (!pendingTeamsByRound.has(roundKey)) pendingTeamsByRound.set(roundKey, [])
        }

        function flushPending(roundKey) {
          const pend = pendingTeamsByRound.get(roundKey) || []
          if (pend.length < 2) return
          pendingTeamsByRound.set(roundKey, [])

          for (let i = 0; i + 1 < pend.length; i += 2) {
            const a = pend[i]
            const b = pend[i + 1]

            const maxNum = maxNumByRound.get(roundKey) || 0
            const nextAuto = autoCounterByRound.get(roundKey) || 1
            const displayNo = maxNum + nextAuto
            autoCounterByRound.set(roundKey, nextAuto + 1)

            const key = `auto_${displayNo}_${i}`
            const mMap = roundMap.get(roundKey)
            if (!mMap.has(key)) mMap.set(key, { displayNo, order: 100000 + displayNo, teams: [] })
            mMap.get(key).teams.push(a, b)
          }

          if (pend.length % 2 === 1) {
            pendingTeamsByRound.get(roundKey).push(pend[pend.length - 1])
          }
        }

        // --- Parse group standings from AL..AW ---
        const gs = []

        for (let i = 2; i < grid.length; i++) {
          const row = grid[i] || []
          if (isEmptyRow(row)) continue

          const colA = s(row[COL_MATCHUP_NO])
          const colB = s(row[COL_TEAM])
          const colD = s(row[COL_ROUND_TITLE])
          const matchupNo = toNumLoose(colA)

          // Round title: col D contains "Week"
          if (colD && isWeekRoundTitle(colD)) {
            if (currentRound) flushPending(currentRound)
            currentRound = colD
            ensureRound(currentRound)
          } else {
            const roundKey = currentRound || "Round"
            ensureRound(roundKey)

            // Build cols from C..L and add League from O
            const statsCL = row.slice(COL_STATS_START, COL_STATS_END_EXCL)
            const cols = {}
            for (let j = 0; j < headersCL.length; j++) {
              const key = s(headersCL[j])
              if (!key) continue
              cols[key] = statsCL[j]
            }
            cols[LEAGUE_KEY] = s(row[COL_LEAGUE])

            // Primary: matchup numbers
            if (matchupNo && colB) {
              flushPending(roundKey)
              maxNumByRound.set(roundKey, Math.max(maxNumByRound.get(roundKey) || 0, matchupNo))

              const mMap = roundMap.get(roundKey)
              const key = `num_${matchupNo}`
              if (!mMap.has(key)) mMap.set(key, { displayNo: matchupNo, order: matchupNo, teams: [] })
              mMap.get(key).teams.push({ team: colB, cols })
            } else if (!matchupNo && colB) {
              // Fallback: pair sequential team rows
              pendingTeamsByRound.get(roundKey).push({ team: colB, cols })
              if (pendingTeamsByRound.get(roundKey).length >= 2) flushPending(roundKey)
            }
          }

          // Group standings row: read AL..AW first 6 fields as Team,Games,Wins,Loses,Ties,W%
          const gsCells = row.slice(COL_GS_START, COL_GS_END_EXCL)
          const team = s(gsCells?.[0])
          if (team && !isLikelyHeaderWord(team)) {
            const rec = {
              Team: team,
              Games: s(gsCells?.[1]),
              Wins: s(gsCells?.[2]),
              Loses: s(gsCells?.[3]),
              Ties: s(gsCells?.[4]),
              "W%": s(gsCells?.[5]),
            }
            // accept if it looks like a real row (at least one numeric-ish field present)
            const hasAny =
              s(rec.Games) || s(rec.Wins) || s(rec.Loses) || s(rec.Ties) || s(rec["W%"])
            if (hasAny) gs.push(rec)
          }
        }

        if (currentRound) flushPending(currentRound)

        const outRounds = Array.from(roundMap.entries()).map(([roundTitle, mMap]) => {
          const matchups = Array.from(mMap.values())
            .sort((a, b) => a.order - b.order)
            .map((m) => ({
              matchupNo: m.displayNo,
              matchup: { a: m.teams?.[0] || null, b: m.teams?.[1] || null },
            }))
          return { roundTitle, matchups }
        })

        // Podium: use last round's last matchup winner (by category W/L/T)
        let first = ""
        let second = ""
        if (outRounds.length && statKeys.length) {
          const lastRound = outRounds[outRounds.length - 1]
          const lastMatch = lastRound?.matchups?.[lastRound.matchups.length - 1]
          const a = lastMatch?.matchup?.a
          const b = lastMatch?.matchup?.b
          if (a?.team && b?.team) {
            const { w, l } = scoreWLT(a?.cols, b?.cols, statKeys)
            if (w > l) {
              first = a.team
              second = b.team
            } else if (l > w) {
              first = b.team
              second = a.team
            }
          }
        }

        if (!alive) return
        setRounds(outRounds)
        if (outRounds.length) setOpenRounds({ [outRounds[0].roundTitle]: true })

        const deduped = dedupeByTeam(gs)
        // sort by W% desc if possible, else leave as-is
        deduped.sort((r1, r2) => {
          const a = toNumLoose(String(r1["W%"]).replace("%", "")) ?? -999
          const b = toNumLoose(String(r2["W%"]).replace("%", "")) ?? -999
          return b - a
        })
        setGroupRows(deduped)

        setPodium({ first, second })
      } catch (e) {
        if (!alive) return
        setErr(String(e?.message || e))
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [statKeys.length]) // statKeys derived from headers; safe trigger

  function toggleRound(title) {
    setOpenRounds((prev) => ({ ...prev, [title]: !prev[title] }))
  }

  function cardKey(roundTitle, matchupNo) {
    return `${roundTitle}__${matchupNo}`
  }

  function toggleCard(roundTitle, matchupNo) {
    const k = cardKey(roundTitle, matchupNo)
    setOpenCards((prev) => ({ ...prev, [k]: !prev[k] }))
  }

  const roundBlocks = useMemo(() => rounds, [rounds])

  return (
    <div style={{ width: "100%", padding: "18px clamp(12px, 2vw, 26px) 40px" }}>
      {/* max 6 columns + responsive downshift */}
      <style>{`
        .cupGrid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(6, minmax(240px, 1fr));
          align-items: start;
        }
        @media (max-width: 1500px) { .cupGrid { grid-template-columns: repeat(5, minmax(240px, 1fr)); } }
        @media (max-width: 1250px) { .cupGrid { grid-template-columns: repeat(4, minmax(240px, 1fr)); } }
        @media (max-width: 1000px) { .cupGrid { grid-template-columns: repeat(3, minmax(240px, 1fr)); } }
        @media (max-width: 760px)  { .cupGrid { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
        @media (max-width: 520px)  { .cupGrid { grid-template-columns: repeat(1, minmax(240px, 1fr)); } }
      `}</style>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 32, fontWeight: 950, letterSpacing: 0.2, color: ink }}>GNFC CUP</div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="badge" onClick={() => nav(-1)}>
            Back
          </button>
          <Link to="/" className="badge" style={{ textDecoration: "none" }}>
            Home
          </Link>
        </div>
      </div>

      {/* ====== TOP: Podium (left) + Group Standings (right) ====== */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          marginBottom: 14,
        }}
      >
        {/* Podium */}
        {/* Podium */}
<div className="card">
  {/* header image */}
  <div style={{ display: "grid", placeItems: "center", marginBottom: 10 }}>
    <img
      src="/gnfccup.jpg"
      alt="GNFC CUP"
      style={{
        width: "100%",
        height: "100%",
        maxWidth: 360,
        objectFit: "cover",
        borderRadius: 14,
        border: `1px solid ${border}`,
        background: "rgba(0,0,0,0.02)",
      }}
    />
    <div style={{ marginTop: 8, fontWeight: 950, letterSpacing: 0.6, color: ink }}>
      GNFC CUP
    </div>
  </div>

  <div style={{ fontWeight: 950, fontSize: 16, color: ink, marginBottom: 8 }}>Final Podium</div>

  <div style={{ display: "grid", gap: 8 }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: `1px solid ${border}`,
        borderRadius: 14,
        padding: "10px 12px",
        background: "rgba(219, 125, 18, 0.10)",
      }}
    >
      <div style={{ fontWeight: 950, color: ink }}>1st</div>
      <div style={{ fontWeight: 950, color: ink }}>{podium.first || "—"}</div>
    </div>

    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: `1px solid ${border}`,
        borderRadius: 14,
        padding: "10px 12px",
        background: "rgba(5, 97, 97, 0.08)",
      }}
    >
      <div style={{ fontWeight: 950, color: ink }}>2nd</div>
      <div style={{ fontWeight: 950, color: ink }}>{podium.second || "—"}</div>
    </div>
  </div>

</div>

        {/* Group standings */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ fontWeight: 950, fontSize: 16, color: ink, marginBottom: 8 }}>Group Standings</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  {GROUP_HEADERS.map((h) => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {(groupRows || []).slice(0, 50).map((r, idx) => (
                  <tr key={`${r.Team}-${idx}`} style={rowStyle(idx)}>
                    <td style={{ ...tdStyle, fontWeight: 950, textAlign: "left"}}>{r.Team}</td>
                    <td style={tdStyle}>{cell(r.Games)}</td>
                    <td style={tdStyle}>{cell(r.Wins)}</td>
                    <td style={tdStyle}>{cell(r.Loses)}</td>
                    <td style={tdStyle}>{cell(r.Ties)}</td>
                    <td style={tdStyle}>{cell(r["W%"])}</td>
                  </tr>
                ))}

                {!groupRows?.length ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, color: muted, fontWeight: 900 }}>
                      No standings found in columns AL–AW.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

        </div>
      </div>

      {/* ====== BODY ====== */}
      {loading ? (
        <div className="card">Loading…</div>
      ) : err ? (
        <div className="card" style={{ border: "1px solid rgba(220, 38, 38, 0.35)", background: "rgba(220, 38, 38, 0.06)" }}>
          <div style={{ fontWeight: 900, color: ink }}>{err}</div>
          <div style={{ marginTop: 8, color: muted, fontSize: 12 }}>
            If the sheet isn’t public, the browser can’t fetch the CSV export.
          </div>
        </div>
      ) : !roundBlocks.length ? (
        <div className="card">No matchups found.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {roundBlocks.map((r) => {
            const open = !!openRounds[r.roundTitle]
            return (
              <div key={r.roundTitle} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <button type="button" onClick={() => toggleRound(r.roundTitle)} style={roundHeaderBtn}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={roundPill}>{r.roundTitle}</span>
                    <span style={subtleCount}>{r.matchups.length} matchups. Click to expand.</span>
                  </div>
                  <span style={{ color: muted, fontWeight: 950, fontSize: 16 }}>{open ? "–" : "+"}</span>
                </button>

                {open ? (
                  <div style={{ borderTop: `1px solid ${border}`, padding: 12 }}>
                    <div className="cupGrid">
                      {r.matchups.map((m) => {
                        const k = cardKey(r.roundTitle, m.matchupNo)
                        const isOpen = !!openCards[k]
                        return (
                          <MatchupCardCup
                            key={`${r.roundTitle}-${m.matchupNo}`}
                            matchupNo={m.matchupNo}
                            matchup={m.matchup}
                            statKeys={statKeys}
                            open={isOpen}
                            onToggle={() => toggleCard(r.roundTitle, m.matchupNo)}
                          />
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}