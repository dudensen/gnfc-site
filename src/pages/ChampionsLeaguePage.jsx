// src/pages/ChampionsLeaguePage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { RANKING_SHEET_ID, RANKING_GIDS } from "../config/rankingGids"

/* ----------------------------- config ----------------------------- */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const CHAMPIONS_GID = "2012947819"

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function cell(v) {
  const x = s(v)
  return x ? x : "0"
}

function hasLetters(x) {
  return /[A-Za-zΑ-Ωα-ω]/.test(s(x))
}

/** ✅ REAL CSV export url (better for “Week …” markers / merged cells) */
function exportCsvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

/** fallback gviz (kept as backup) */
function gvizCsvUrl(sheetId, gid) {
  const tq = encodeURIComponent("select *")
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${gid}&tqx=out:csv&tq=${tq}`
}

// Robust CSV parser (quotes/commas/newlines)
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

function teamHref(teamName) {
  return `/team/${encodeURIComponent(s(teamName))}`
}

/* ----------------------------- header prettifier ----------------------------- */

function prettyStatLabel(label) {
  const raw = s(label)
  if (!raw) return raw
  const m = /^\s*([A-Za-z0-9%]+)\s+group\s+\d+\s*\(week\s*\d+\)\s*$/i.exec(raw)
  if (m) return m[1]
  return raw
}

/* ----------------------------- standings parsing (EXISTING TABLE: ColR..ColV) ----------------------------- */
/**
 * Standings exist in columns R..V:
 * - Team in ColR
 * - ColS..V => W L T W%
 *
 * Indices: R=17 S=18 T=19 U=20 V=21
 */
const IDX_R = 17
const IDX_S = 18
const IDX_T = 19
const IDX_U = 20
const IDX_V = 21

function parseStandingsFromRV(csvRows) {
  if (!Array.isArray(csvRows) || csvRows.length < 2) return null

  const out = []
  let started = false
  let emptyStreak = 0

  for (let i = 0; i < csvRows.length; i++) {
    const r = csvRows[i] || []

    const team = s(r[IDX_R])
    const w = s(r[IDX_S])
    const l = s(r[IDX_T])
    const t = s(r[IDX_U])
    const wp = s(r[IDX_V])

    const looksLikeRow = hasLetters(team) && (w || l || t || wp)

    if (!started) {
      if (!looksLikeRow) continue
      started = true
    }

    if (started) {
      if (!looksLikeRow) {
        emptyStreak++
        if (emptyStreak >= 2) break
        continue
      }
      emptyStreak = 0
      out.push({ team, w, l, t, wp })
    }
  }

  return out.length ? out : null
}

/* ----------------------------- matchups parsing (B..O) ----------------------------- */

function sliceBO(row) {
  const out = []
  for (let i = 1; i <= 14; i++) out.push(row?.[i] ?? "")
  return out
}

function isEmptyRowMatchday(row) {
  const a = s(row?.[0])
  const bo = sliceBO(row)
  return !a && bo.every((x) => !s(x))
}

function isNumericMatchupNo(x) {
  return /^\d+$/.test(s(x))
}

/**
 * ✅ Updated: get section titles from Column D (index 3) when it contains "Week".
 * Uses REAL export CSV (see fetch), with a safe fallback to old behavior if no Week titles exist.
 */
function parseChampionsBySections(csvRows) {
  if (!csvRows?.length) throw new Error("Champions League CSV is empty.")
  if (csvRows.length < 2) throw new Error("Champions League CSV missing data rows.")

  // 1) Find the real header row (export CSV can have junk rows before headers)
  function findHeaderIdx(rows, maxScan = 40) {
    const lim = Math.min(rows.length, maxScan)
    for (let i = 0; i < lim; i++) {
      const r = rows[i] || []
      const bo = sliceBO(r).map(s)
      const hasTeam = bo.some((x) => norm(x) === "team")
      const hasAnyStat = bo.some((x) => ["fg%", "ft%", "fg", "ft", "3pt", "reb", "ast", "stl", "blk", "to", "pts", "gp", "score"].includes(norm(x)))
      if (hasTeam && (hasAnyStat || bo.filter(Boolean).length >= 6)) return i
    }
    return 0
  }

  const headerIdx = findHeaderIdx(csvRows, 40)
  const headerRow = csvRows[headerIdx] || []

  // Build column defs from B..O headers (same as before)
  const headersBO = sliceBO(headerRow).map((h) => s(h))
  const colDefs = []
  for (let c = 0; c < headersBO.length; c++) {
    const label = headersBO[c]
    if (!label) continue
    colDefs.push({ key: prettyStatLabel(label), idxBO: c })
  }

  const idxTeamBO = colDefs.find((d) => norm(d.key) === "team")?.idxBO ?? null
  if (idxTeamBO == null) throw new Error("Could not locate Team column in Champions League headers.")

  const isWeekTitle = (row) => /week/i.test(s(row?.[3])) // Column D (index 3)

  const readTeamAndRec = (row) => {
    const bo = sliceBO(row)
    const team = s(bo[idxTeamBO])
    if (!hasLetters(team)) return null

    const rec = {}
    for (const d of colDefs) rec[d.key] = s(bo[d.idxBO])
    return { team, cols: rec, bo }
  }

  // 2) Build sections by Week titles and team rows between them
  const sections = []
  let current = null
  let teamsBuffer = [] // holds {team, cols, bo} until paired

  const flushBufferIntoMatchups = (sec, limitToOneMatch = false) => {
    if (!sec) return
    const ms = sec.matchups || []

    // pair sequentially
    let mNo = ms.length + 1
    for (let i = 0; i + 1 < teamsBuffer.length; i += 2) {
      if (limitToOneMatch && ms.length >= 1) break
      const a = teamsBuffer[i]
      const b = teamsBuffer[i + 1]
      ms.push({
        matchupNo: String(mNo++), // synthetic but stable per section
        a,
        b,
      })
      if (limitToOneMatch) break
    }

    sec.matchups = ms
    teamsBuffer = []
  }

  // helper to detect final round title
  const isFinalTitle = (title) => /final/i.test(s(title))

  // scan rows after headers
  for (let i = headerIdx + 1; i < csvRows.length; i++) {
    const row = csvRows[i] || []

    // New round title?
    if (isWeekTitle(row)) {
      const title = s(row?.[3])

      // flush previous section buffer before starting new
      if (current) {
        // if the previous section was final, enforce 1 match
        flushBufferIntoMatchups(current, isFinalTitle(current.title))
        if (current.matchups.length) sections.push(current)
      }

      current = { title, matchups: [] }
      teamsBuffer = []
      continue
    }

    // If we haven't hit the first Week title yet, ignore rows
    if (!current) continue

    // Collect team rows between titles
    const rec = readTeamAndRec(row)
    if (rec) teamsBuffer.push(rec)
  }

  // flush last section
  if (current) {
    // ✅ if last section is final OR just treat last as final-safe when it’s the end:
    // user said: "there is always ONE match under the final round"
    // We'll enforce ONE match if title contains "final", otherwise keep normal pairing.
    flushBufferIntoMatchups(current, isFinalTitle(current.title))
    if (current.matchups.length) sections.push(current)
  }

  // Extra enforcement: if the LAST section is the final round but somehow has >1 matchup, keep only the first
  if (sections.length) {
    const last = sections[sections.length - 1]
    if (isFinalTitle(last.title) && last.matchups.length > 1) {
      last.matchups = [last.matchups[0]]
    }
  }

  return { colDefs, sections }
}

// Column N is within B..O slice at index 12 (B=0 ... N=12)
const IDX_IN_BO_N = 12

function pickFinalPodium(parsed) {
  if (!parsed?.sections?.length) return null

  // Prefer FINALS section if it exists
  const finalsSec = [...parsed.sections].reverse().find((sec) => /final/i.test(sec.title)) || null

  const sectionsToScan = finalsSec ? [finalsSec] : [...parsed.sections].reverse()

  // "The last 1 1 matchup that does not have a 2 2 below is the final."
  function findFinalMatchupInSection(sec) {
    const ms = sec?.matchups || []
    if (!ms.length) return null

    const ones = []
    for (let i = 0; i < ms.length; i++) {
      if (String(ms[i]?.matchupNo) === "1") ones.push(i)
    }
    if (!ones.length) return null

    for (let k = ones.length - 1; k >= 0; k--) {
      const idx1 = ones[k]
      let hasTwoAfter = false
      for (let j = idx1 + 1; j < ms.length; j++) {
        if (String(ms[j]?.matchupNo) === "2") {
          hasTwoAfter = true
          break
        }
      }
      if (!hasTwoAfter) return ms[idx1]
    }

    return null
  }

  let finalMatch = null
  for (const sec of sectionsToScan) {
    finalMatch = findFinalMatchupInSection(sec)
    if (finalMatch) break
  }

  if (!finalMatch) return null

  const aW = s(finalMatch?.a?.bo?.[IDX_IN_BO_N]).toUpperCase() === "W"
  const bW = s(finalMatch?.b?.bo?.[IDX_IN_BO_N]).toUpperCase() === "W"

  // If no W in col N => match still open => podium must remain empty
  if (!aW && !bW) return null

  const winner = aW ? finalMatch.a?.team : finalMatch.b?.team
  const runnerUp = aW ? finalMatch.b?.team : finalMatch.a?.team

  if (!hasLetters(winner) || !hasLetters(runnerUp)) return null

  return { winner, runnerUp }
}

/* ----------------------------- matchup scoring (W/L/T) ----------------------------- */

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

function scoreWLT(aCols, bCols, statKeys) {
  let w = 0,
    l = 0,
    t = 0
  for (const k of statKeys) {
    const c = compareStat(aCols?.[k], bCols?.[k], k)
    if (c === 1) w++
    else if (c === -1) l++
    else t++
  }
  return { w, l, t }
}

/* ----------------------------- styles (LeaguePage feel) ----------------------------- */

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

  return (
    <span style={{ ...base, ...(tones[tone] || {}) }}>
      {label} {value}
    </span>
  )
}

function StatChip({ value, tone }) {
  if (!tone) return <span style={{ fontWeight: 900, fontSize: 13 }}>{cell(value)}</span>

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

const matchupHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.10))",
}

const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 12,
  color: "var(--gnfc-muted)",
  letterSpacing: 0.3,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
}

const tdStyle = {
  padding: "9px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 13,
}

const rowStyle = (idx) => ({
  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)",
})

function MatchupCardCL({ matchup, statKeys, leagueKey }) {
  const [open, setOpen] = useState(false)

  const aTeam = matchup.a?.team
  const bTeam = matchup.b?.team

  const aLeague = leagueKey ? s(matchup.a?.cols?.[leagueKey]) : ""
  const bLeague = leagueKey ? s(matchup.b?.cols?.[leagueKey]) : ""

  const { w, l, t } = useMemo(
    () => scoreWLT(matchup.a?.cols, matchup.b?.cols, statKeys),
    [matchup, statKeys]
  )

  const headerBtn = {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
  }

  const topRow = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  }

  const leaguePill = {
    display: "inline-flex",
    alignItems: "center",
    height: 18,
    padding: "0 8px",
    marginLeft: 8,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0.2,
    color: "var(--gnfc-muted)",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    lineHeight: 1,
    verticalAlign: "middle",
    transform: "translateY(-1px)",
    whiteSpace: "nowrap",
  }

  const teamLine = (team, league) => (
    <div style={{ fontWeight: 950, fontSize: 15, lineHeight: 1.15 }}>
      <Link to={teamHref(team)} className="teamLinkHover" style={{ textDecoration: "none", color: "inherit" }}>
        {cell(team)}
      </Link>
      {league ? <span style={leaguePill}>{league}</span> : null}
    </div>
  )

  const vsBlock = {
    margin: "6px 0 5px",
    color: "#db7d12",
    fontWeight: 1000,
    letterSpacing: 0.8,
    fontSize: 16,
    lineHeight: 1,
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* ✅ Accordion Header */}
      <button type="button" onClick={() => setOpen((v) => !v)} style={headerBtn} aria-expanded={open}>
        {/* Row 1: only W/L/T on the right */}
        <div style={topRow}>
          <ScorePill label="W" value={w} tone="win" />
          <ScorePill label="L" value={l} tone="loss" />
          <ScorePill label="T" value={t} tone="tie" />
          <span style={{ fontWeight: 900, color: "var(--gnfc-muted)", marginLeft: 2 }}>{open ? "▲" : "▼"}</span>
        </div>

        {/* Row 2: full-width matchup title */}
        <div style={{ marginTop: 10 }}>
          {teamLine(aTeam, aLeague)}
          <div style={vsBlock}>VS</div>
          {teamLine(bTeam, bLeague)}
        </div>
      </button>

      {/* ✅ Expanded stats */}
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.18)" }}>
                <th style={thStyle}>Cat</th>
                <th style={{ ...thStyle, textAlign: "center" }}>{cell(aTeam)}</th>
                <th style={{ ...thStyle, textAlign: "center" }}>{cell(bTeam)}</th>
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
      )}
    </div>
  )
}

/* ----------------------------- Past Years (Champions League column) ----------------------------- */

function headerFingerprint(h) {
  return norm(h).replace(/[^a-z0-9α-ω]/g, "")
}

function findHeaderRow(rows, maxScan = 12) {
  const limit = Math.min(rows.length, maxScan)
  let best = { rowIdx: 0, score: -1 }

  for (let r = 0; r < limit; r++) {
    const row = rows[r] || []
    let score = 0

    for (let c = 0; c < row.length; c++) {
      const fp = headerFingerprint(row[c])
      if (!fp) continue
      if (fp === "team" || fp.includes("team")) score += 3
      if (fp === "playoffs" || fp.includes("playoffs")) score += 2
      if (fp.includes("champ") && fp.includes("league")) score += 2
      if (fp === "championsleague") score += 4
    }

    if (score > best.score) best = { rowIdx: r, score }
  }

  return best.rowIdx
}

function findColIndex(headerRow, predicate) {
  for (let i = 0; i < headerRow.length; i++) {
    if (predicate(headerRow[i], i)) return i
  }
  return -1
}

function findColIndexJoined(headerRow, predicateJoined, maxSpan = 3) {
  for (let i = 0; i < headerRow.length; i++) {
    let acc = ""
    for (let span = 1; span <= maxSpan && i + span - 1 < headerRow.length; span++) {
      const piece = s(headerRow[i + span - 1])
      acc = acc ? `${acc} ${piece}` : piece
      if (predicateJoined(acc, i, span)) return i
    }
  }
  return -1
}

function parsePastChampionsLeagueResults(csvRows) {
  if (!Array.isArray(csvRows) || csvRows.length < 2) return null

  const hdrIdx = findHeaderRow(csvRows, 12)
  const header = csvRows[hdrIdx] || []
  const dataStart = hdrIdx + 1

  let idxTeam = findColIndex(header, (h) => {
    const fp = headerFingerprint(h)
    return fp === "team" || fp.includes("team")
  })

  let idxCL = findColIndex(header, (h) => headerFingerprint(h) === "championsleague")
  if (idxCL < 0) {
    idxCL = findColIndex(header, (h) => {
      const fp = headerFingerprint(h)
      return fp.includes("champ") && fp.includes("league")
    })
  }
  if (idxCL < 0) {
    idxCL = findColIndexJoined(
      header,
      (joined) => {
        const fp = headerFingerprint(joined)
        return fp === "championsleague" || (fp.includes("champ") && fp.includes("league"))
      },
      3
    )
  }

  // fallback: after Playoffs
  if (idxCL < 0) {
    let idxPlayoffs = findColIndex(header, (h) => {
      const fp = headerFingerprint(h)
      return fp === "playoffs" || fp.includes("playoffs")
    })
    if (idxPlayoffs < 0) {
      idxPlayoffs = findColIndexJoined(
        header,
        (joined) => {
          const fp = headerFingerprint(joined)
          return fp === "playoffs" || fp.includes("playoffs")
        },
        3
      )
    }
    if (idxPlayoffs >= 0 && idxPlayoffs + 1 < header.length) idxCL = idxPlayoffs + 1
  }

  if (idxTeam < 0 || idxCL < 0) return null

  const buckets = {
    Champion: [],
    Final: [],
    Semifinal: [],
    "8": [],
    Groupstage: [],
  }

  let emptyStreak = 0
  for (let i = dataStart; i < csvRows.length; i++) {
    const r = csvRows[i] || []
    const team = s(r[idxTeam])
    const valRaw = s(r[idxCL])

    const looksEmpty = !team && !valRaw
    if (looksEmpty) {
      emptyStreak++
      if (emptyStreak >= 5) break
      continue
    }
    emptyStreak = 0

    if (!hasLetters(team) || !valRaw) continue

    const v = norm(valRaw)
    if (v === "champion") buckets.Champion.push(team)
    else if (v === "final") buckets.Final.push(team)
    else if (v === "semifinal" || v === "semifinals") buckets.Semifinal.push(team)
    else if (v === "8") buckets["8"].push(team)
    else if (v === "groupstage" || v === "group stage" || v === "group-stage") buckets.Groupstage.push(team)
  }

  return buckets
}

function PastYearsCLBox({ years, year, setYear, loading, err, buckets }) {
  const selectStyle = {
    width: "100%",
    height: 34,
    borderRadius: 12,
    padding: "0 10px",
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.10)",
    color: "var(--gnfc-ink)",
    outline: "none",
  }

  const labelMap = {
    Champion: "Champion",
    Final: "Runner-up",
    Semifinal: "Semifinal",
    "8": "Final 8",
    Groupstage: "Groupstage",
  }

  const order = ["Champion", "Final", "Semifinal", "8", "Groupstage"]

  const pillStyle = (rawKey) => {
    const isChampion = rawKey === "Champion"
    if (isChampion) {
      return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 22,
        padding: "0 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 950,
        letterSpacing: 0.25,
        whiteSpace: "nowrap",
        color: "var(--gnfc-muted)",
        border: "1px solid rgba(216,120,32,0.55)",
        background: "rgba(216,120,32,0.14)",
      }
    }
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: 22,
      padding: "0 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 950,
      letterSpacing: 0.25,
      whiteSpace: "nowrap",
      color: "var(--gnfc-muted)",
      border: "1px solid rgba(10,122,114,0.45)",
      background: "rgba(10,122,114,0.10)",
    }
  }

  const headerRow = {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 12,
    padding: "8px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    color: "var(--gnfc-muted)",
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: 0.25,
  }

  const row = {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 12,
    padding: "10px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    alignItems: "start",
  }

  const teamWrap = {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 12px",
    fontWeight: 950,
    lineHeight: 1.25,
  }

  const teamLink = {
    textDecoration: "none",
    color: "inherit",
    padding: "2px 0",
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 950, letterSpacing: 0.35, color: "var(--gnfc-muted)" }}>
        Past years (from “Champions League” column)
      </div>

      <div style={{ height: 8 }} />

      <select value={year || ""} onChange={(e) => setYear(e.target.value)} style={selectStyle}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <div style={{ height: 10 }} />

      {loading ? (
        <div style={{ color: "var(--gnfc-muted)", fontWeight: 900 }}>Loading…</div>
      ) : err ? (
        <div style={{ color: "var(--gnfc-muted)", fontWeight: 900 }}>{err}</div>
      ) : buckets ? (
        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}
        >
          <div style={headerRow}>
            <div>Stage</div>
            <div>Teams</div>
          </div>

          {order.map((rawKey, i) => {
            const label = labelMap[rawKey] || rawKey
            const teams = buckets?.[rawKey] || []

            return (
              <div
                key={rawKey}
                style={{
                  ...row,
                  background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={pillStyle(rawKey)}>{label}</span>
                </div>

                <div style={teamWrap}>
                  {teams.length ? (
                    teams.map((t) => (
                      <Link key={`${rawKey}-${t}`} to={teamHref(t)} className="teamLinkHover" style={teamLink}>
                        {cell(t)}
                      </Link>
                    ))
                  ) : (
                    <span style={{ color: "var(--gnfc-muted)", fontWeight: 900 }}>—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ color: "var(--gnfc-muted)", fontWeight: 900 }}>
          Could not find “Team” + “Champions League” columns in that year.
        </div>
      )}
    </div>
  )
}

/* ----------------------------- podium + standings UI ----------------------------- */

function Podium({ podium, pastYears, pastYear, setPastYear, pastLoading, pastErr, pastBuckets }) {
  const winner = podium?.winner || ""
  const runnerUp = podium?.runnerUp || ""

  return (
    <div className="card" style={{ padding: 16, height: "100%" }}>
      <div style={{ fontSize: 16, fontWeight: 950, letterSpacing: 0.6, textTransform: "uppercase" }}>Podium</div>
      <div style={{ height: 10 }} />

      {!winner || !runnerUp ? (
        <div
          style={{
            padding: "14px 12px",
            borderRadius: 14,
            border: "1px dashed rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.06)",
            color: "var(--gnfc-muted)",
            fontWeight: 900,
            lineHeight: 1.25,
          }}
        >
          Podium will appear when the FINAL is finished.
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(216,120,32,0.35)",
              background: "rgba(216,120,32,0.10)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--gnfc-muted)", fontWeight: 900, letterSpacing: 0.4 }}>WINNER</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 950, lineHeight: 1.15 }}>
              <Link to={teamHref(winner)} className="teamLinkHover" style={{ textDecoration: "none", color: "inherit" }}>
                {cell(winner)}
              </Link>
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--gnfc-muted)", fontWeight: 900, letterSpacing: 0.4 }}>RUNNER-UP</div>
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 950, lineHeight: 1.15 }}>
              <Link
                to={teamHref(runnerUp)}
                className="teamLinkHover"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {cell(runnerUp)}
              </Link>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--gnfc-muted)" }}>
        Source: FINAL result (winner row has “W” in column N).
      </div>

      {pastYears?.length ? (
        <PastYearsCLBox years={pastYears} year={pastYear} setYear={setPastYear} loading={pastLoading} err={pastErr} buckets={pastBuckets} />
      ) : null}
    </div>
  )
}

function GroupStandingsTable({ rows }) {
  const headers = ["#", "Team", "W", "L", "T", "W%"]

  return (
    <div>
      <div
        className="sectionTitle"
        style={{
          marginTop: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingLeft: 2,
        }}
      >
        <span className="badge">Standings</span>
        <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>Before matchup • total statistics</span>
      </div>

      <div style={{ height: 10 }} />

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.18)" }}>
                {headers.map((h, idx) => (
                  <th
                    key={h}
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
              {rows.map((r, i) => (
                <tr key={`${r.team}-${i}`} style={rowStyle(i)}>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "left",
                      fontWeight: 900,
                      color: "var(--gnfc-muted)",
                      width: 56,
                    }}
                  >
                    {i + 1}
                  </td>

                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 950 }}>
                    <Link to={teamHref(r.team)} className="teamLinkHover" style={{ textDecoration: "none", color: "inherit" }}>
                      {cell(r.team)}
                    </Link>
                  </td>

                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{cell(r.w)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{cell(r.l)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{cell(r.t)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{cell(r.wp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 10, color: "var(--gnfc-muted)", fontSize: 12 }}></div>
    </div>
  )
}

/* ----------------------------- page ----------------------------- */

export default function ChampionsLeaguePage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [parsed, setParsed] = useState(null)
  const [standings, setStandings] = useState([])
  const [openSection, setOpenSection] = useState(null)

  // past years
  const pastYears = useMemo(() => {
    return Object.keys(RANKING_GIDS || {})
      .filter((k) => /^\d{4}$/.test(k))
      .sort((a, b) => Number(b) - Number(a))
  }, [])

  const [pastYear, setPastYear] = useState(() => pastYears?.[0] || "")
  const [pastLoading, setPastLoading] = useState(false)
  const [pastErr, setPastErr] = useState("")
  const [pastBuckets, setPastBuckets] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setErr("")

        // ✅ Use CSV export (and fallback to gviz if needed)
        const url = exportCsvUrl(SHEET_ID, CHAMPIONS_GID)
        let res = await fetch(url)
        let text = await res.text()

        if (!res.ok) {
          res = await fetch(gvizCsvUrl(SHEET_ID, CHAMPIONS_GID))
          text = await res.text()
          if (!res.ok) throw new Error(`Champions League fetch failed: ${res.status} ${res.statusText}`)
        }

        const rows = parseCsv(text)

        const st = parseStandingsFromRV(rows) || []
        const p = parseChampionsBySections(rows)

        if (!alive) return
        setStandings(st)
        setParsed(p)
      } catch (e) {
        if (!alive) return
        setErr(e?.message || String(e))
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => (alive = false)
  }, [])

  useEffect(() => {
    if (!parsed?.sections?.length) return
    setOpenSection((prev) => (prev == null ? parsed.sections[0].title : prev))
  }, [parsed])

  // fetch past-year CL results from ranking sheet (export CSV)
  useEffect(() => {
    if (!pastYear) return
    const gid = RANKING_GIDS?.[pastYear]
    if (!gid) {
      setPastBuckets(null)
      setPastErr(`Missing gid for year ${pastYear}`)
      return
    }

    let alive = true
    ;(async () => {
      try {
        setPastLoading(true)
        setPastErr("")
        setPastBuckets(null)

        let res = await fetch(exportCsvUrl(RANKING_SHEET_ID, gid))
        let text = await res.text()

        if (!res.ok) {
          res = await fetch(gvizCsvUrl(RANKING_SHEET_ID, gid))
          text = await res.text()
          if (!res.ok) throw new Error(`Year ${pastYear} fetch failed: ${res.status} ${res.statusText}`)
        }

        const rows = parseCsv(text)
        const buckets = parsePastChampionsLeagueResults(rows)

        if (!alive) return
        setPastBuckets(buckets)
      } catch (e) {
        if (!alive) return
        setPastErr(e?.message || String(e))
        setPastBuckets(null)
      } finally {
        if (!alive) return
        setPastLoading(false)
      }
    })()

    return () => (alive = false)
  }, [pastYear])

  const leagueColKey = useMemo(() => parsed?.colDefs?.find((d) => norm(d.key) === "league")?.key || null, [parsed])

  // exclude Team, League, Score, GP from matchup scoring
  const statKeysForMatchup = useMemo(() => {
    const keys = (parsed?.colDefs || []).map((d) => d.key)
    return keys.filter((k) => {
      const nk = norm(k)
      if (nk === "team") return false
      if (nk === "league") return false
      if (nk === "score") return false
      if (nk === "gp") return false
      return true
    })
  }, [parsed])

  const podium = useMemo(() => pickFinalPodium(parsed), [parsed])

  return (
    <>
      {/* Header: logo always goes home + right buttons Back/Home */}
      <div className="topbar">
        <div className="brand">
          <Link to="/" style={{ display: "inline-flex", alignItems: "center" }}>
            <img src="/gnfc-logo.png" alt="GNFC Logo" style={{ cursor: "pointer" }} />
          </Link>

          <div className="brand-title">
            <h1>Champions League</h1>
            <p>Standings • Matchups</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Link to={-1} className="badge" style={{ textDecoration: "none" }}>
              Back
            </Link>
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && (
          <div className="card" style={{ padding: 16, color: "var(--gnfc-muted)" }}>
            Loading Champions League…
          </div>
        )}

        {!loading && err && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900 }}>Could not load Champions League</div>
            <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>{err}</div>
          </div>
        )}

        {!loading && !err && parsed && (
          <>
            {/* Podium + Group Standings side-by-side */}
            <div className="clTopGrid">
              <Podium
                podium={podium}
                pastYears={pastYears}
                pastYear={pastYear}
                setPastYear={setPastYear}
                pastLoading={pastLoading}
                pastErr={pastErr}
                pastBuckets={pastBuckets}
              />
              {standings?.length ? (
                <GroupStandingsTable rows={standings} />
              ) : (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 900 }}>Group Standings not found</div>
                  <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>
                    Expected existing standings in ColR–ColV (Team in R).
                  </div>
                </div>
              )}
            </div>

            <div style={{ height: 14 }} />

            {/* Matchdays accordion */}
            {parsed.sections.map((sec) => {
              const isOpen = openSection === sec.title

              return (
                <div key={sec.title} style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setOpenSection(isOpen ? null : sec.title)}
                    className="card"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: 14,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                    aria-expanded={isOpen}
                  >
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase" }}>
                        {sec.title}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--gnfc-muted)" }}>
                        {sec.matchups.length} matchups
                      </div>
                    </div>

                    <div style={{ fontWeight: 900, color: "var(--gnfc-muted)", fontSize: 16 }}>{isOpen ? "▲" : "▼"}</div>
                  </button>

                  {isOpen && (
                    <div className="matchupGrid" style={{ marginTop: 12 }}>
                      {sec.matchups.map((m, idx) => (
                        <MatchupCardCL
                          key={`${sec.title}-${m.matchupNo}-${idx}`}
                          matchup={m}
                          statKeys={statKeysForMatchup}
                          leagueKey={leagueColKey}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            <style>{`
              .teamLinkHover{
                transition: color .15s ease;
              }
              .teamLinkHover:hover{
                color: #db7d12 !important;
              }

              /* Podium + standings layout */
              .clTopGrid{
                display: grid;
                grid-template-columns: 1fr;
                gap: 14px;
                align-items: stretch;
              }
              @media (min-width: 980px){
                .clTopGrid{
                  grid-template-columns: 0.9fr 1.6fr;
                }
              }

              /* Match cards: 4 per row on large screens */
              .matchupGrid{
                display:grid;
                grid-template-columns: 1fr;
                gap: 12px;
              }
              @media (min-width: 760px){
                .matchupGrid{ grid-template-columns: 1fr 1fr; }
              }
              @media (min-width: 1060px){
                .matchupGrid{ grid-template-columns: 1fr 1fr 1fr; }
              }
              @media (min-width: 1400px){
                .matchupGrid{ grid-template-columns: 1fr 1fr 1fr 1fr; }
              }
            `}</style>
          </>
        )}
      </div>
    </>
  )
}