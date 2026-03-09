// src/pages/RivalriesPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

/* ============================== config ============================== */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const RIVALRIES_GID = "1596230240"
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${RIVALRIES_GID}`

// Fixed columns (0-based indexes)
const COL_MATCHUP_NO = 0 // A
const COL_TEAM = 1 // B
const COL_STATS_START = 2 // C
const COL_STATS_END_EXCL = 12 // up to L (index 11)
const COL_ROUND_TITLE = 3 // D
const COL_LEAGUE = 14 // O

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
function isLikelyRoundTitle(v) {
  const t = norm(v)
  return t.includes("week") || t.includes("round") || t.includes("matchday")
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
const orange = "var(--gnfc-orange)"
const green = "var(--gnfc-green)"

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

function StatChip({ value, tone }) {
  const v = cell(value)

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

/* ============================== Matchup Card ============================== */

function MatchupCardRivalry({ matchup, statKeys, matchupNo, open, onToggle }) {
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
    color: muted,
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

export default function RivalriesPage() {
  const nav = useNavigate()

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [rawStatKeys, setRawStatKeys] = useState([])
  const [rounds, setRounds] = useState([])
  const [openRounds, setOpenRounds] = useState({})
  const [openCards, setOpenCards] = useState({})

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

        const headerRow = grid[1] || []
        const headersCL = headerRow.slice(COL_STATS_START, COL_STATS_END_EXCL).map(s).filter(Boolean)
        setRawStatKeys(headersCL)

        let currentRound = ""
        const roundMap = new Map()

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

        for (let i = 2; i < grid.length; i++) {
          const row = grid[i] || []
          if (isEmptyRow(row)) continue

          const colA = s(row[COL_MATCHUP_NO])
          const colB = s(row[COL_TEAM])
          const colD = s(row[COL_ROUND_TITLE])
          const matchupNo = toNumLoose(colA)

          if (colD && isLikelyRoundTitle(colD)) {
            if (currentRound) flushPending(currentRound)
            currentRound = colD
            ensureRound(currentRound)
            continue
          }

          const roundKey = currentRound || "Rivalries"
          ensureRound(roundKey)

          const statsCL = row.slice(COL_STATS_START, COL_STATS_END_EXCL)
          const cols = {}
          for (let j = 0; j < headersCL.length; j++) {
            const key = s(headersCL[j])
            if (!key) continue
            cols[key] = statsCL[j]
          }
          cols[LEAGUE_KEY] = s(row[COL_LEAGUE])

          if (matchupNo && colB) {
            flushPending(roundKey)
            maxNumByRound.set(roundKey, Math.max(maxNumByRound.get(roundKey) || 0, matchupNo))

            const mMap = roundMap.get(roundKey)
            const key = `num_${matchupNo}`
            if (!mMap.has(key)) mMap.set(key, { displayNo: matchupNo, order: matchupNo, teams: [] })
            mMap.get(key).teams.push({ team: colB, cols })
          } else if (!matchupNo && colB) {
            pendingTeamsByRound.get(roundKey).push({ team: colB, cols })
            if (pendingTeamsByRound.get(roundKey).length >= 2) flushPending(roundKey)
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

        if (!alive) return
        setRounds(outRounds)
        if (outRounds.length) setOpenRounds({ [outRounds[0].roundTitle]: true })
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
  }, [])

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
      <style>{`
        .rivalriesGrid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(6, minmax(240px, 1fr));
          align-items: start;
        }
        @media (max-width: 1500px) { .rivalriesGrid { grid-template-columns: repeat(5, minmax(240px, 1fr)); } }
        @media (max-width: 1250px) { .rivalriesGrid { grid-template-columns: repeat(4, minmax(240px, 1fr)); } }
        @media (max-width: 1000px) { .rivalriesGrid { grid-template-columns: repeat(3, minmax(240px, 1fr)); } }
        @media (max-width: 760px)  { .rivalriesGrid { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
        @media (max-width: 520px)  { .rivalriesGrid { grid-template-columns: repeat(1, minmax(240px, 1fr)); } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <img
            src="/rivalries.png"
            alt="Rivalries"
            style={{
              width: 92,
              height: 92,
              objectFit: "cover",
              borderRadius: 14,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.02)",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 32, fontWeight: 950, letterSpacing: 0.2, color: ink }}>Rivalries</div>
            <div style={{ color: muted, fontSize: 13, fontWeight: 800 }}>Historic head-to-head matchups</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="badge" onClick={() => nav(-1)}>
            Back
          </button>
          <Link to="/" className="badge" style={{ textDecoration: "none" }}>
            Home
          </Link>
        </div>
      </div>

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
                    <div className="rivalriesGrid">
                      {r.matchups.map((m) => {
                        const k = cardKey(r.roundTitle, m.matchupNo)
                        const isOpen = !!openCards[k]
                        return (
                          <MatchupCardRivalry
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