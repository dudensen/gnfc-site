// src/pages/Home.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

/* ----------------------------- config ----------------------------- */

const SHEET_ID = "1GGSJSL2aJ2UEXpHGU7NDOdN0CeOHeK0HzuxXOGqOUnA"
const GROUPS_GID = "1712497869"
const ALL_GID = "532207451"

const ORANGE = "#f97316"
const HASH_COLOR = "#0a7a72"

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

function toNumberLoose(x) {
  const t = s(x).replace(/\s/g, "").replace(",", ".")
  if (!t) return null
  const n = Number(t.replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : null
}

function formatPointsTrunc2(x) {
  const n = toNumberLoose(x)
  if (n == null) return "—"
  const trunc = Math.trunc(n * 100) / 100
  return trunc.toFixed(2)
}

function looksLikeGroupLabel(x) {
  const t = norm(x)
  return /^\d+(st|nd|rd|th)$/.test(t)
}

function teamHref(teamName) {
  return `/team/${encodeURIComponent(s(teamName))}`
}

function toggleDir(prevDir) {
  return prevDir === "asc" ? "desc" : "asc"
}

function cmpSmart(a, b) {
  const clean = (v) => s(v).replace(/[\s\u00A0]+/g, "")

  const raRaw = clean(a)
  const rbRaw = clean(b)

  const isDashA = raRaw === "—" || raRaw === "-" || raRaw === "–"
  const isDashB = rbRaw === "—" || rbRaw === "-" || rbRaw === "–"

  // Treat dash placeholders as numeric zero for comparisons
  const ra = isDashA ? "0" : raRaw
  const rb = isDashB ? "0" : rbRaw

  // Blank always last
  const aBlank = !ra
  const bBlank = !rb
  if (aBlank && bBlank) return 0
  if (aBlank) return 1
  if (bBlank) return -1

  // Numeric detection
  const na = toNumberLoose(ra)
  const nb = toNumberLoose(rb)
  const aNum = na != null
  const bNum = nb != null

  // Numeric always before text
  if (aNum && !bNum) return -1
  if (!aNum && bNum) return 1

  // Both numeric
  if (aNum && bNum) {
    const diff = na - nb
    if (diff !== 0) return diff

    // ✅ Tie-break: if both evaluate to 0, put real 0 before dash
    if (na === 0 && nb === 0 && isDashA !== isDashB) {
      return isDashA ? 1 : -1
    }

    return 0
  }

  // Both text
  return ra.localeCompare(rb, undefined, { sensitivity: "base" })
}

function sortRowsStable(rows, getVal, dir) {
  const mul = dir === "asc" ? 1 : -1
  return rows
    .map((r, idx) => ({ r, idx }))
    .sort((x, y) => {
      const c = cmpSmart(getVal(x.r), getVal(y.r))
      if (c !== 0) return c * mul
      return x.idx - y.idx
    })
    .map((x) => x.r)
}

/* ----------------------------- CSV helpers ----------------------------- */

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

/* ----------------------------- Groups parsing (existing) ----------------------------- */

function findHeaderIndex(headers, predicate) {
  for (let i = 0; i < headers.length; i++) {
    if (predicate(norm(headers[i]))) return i
  }
  return -1
}

function findAllHeaderIndices(headers, predicate) {
  const out = []
  for (let i = 0; i < headers.length; i++) {
    if (predicate(norm(headers[i]))) out.push(i)
  }
  return out
}

function findChampionsLeagueStart(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || []
    if (r.some((c) => norm(c) === "champions league")) return i
  }
  return -1
}

function pickBestPointsIndex(rows, teamIdx, managerIdx, pointsCandidates, stopRowIdx) {
  const end = stopRowIdx > 0 ? Math.min(stopRowIdx, rows.length) : rows.length
  const sample = rows.slice(1, Math.min(end, 75))
  let best = null

  for (const pIdx of pointsCandidates) {
    let sum = 0
    let cnt = 0

    for (const r of sample) {
      const team = s(r[teamIdx])
      const mgr = s(r[managerIdx])
      if (!hasLetters(team) || !hasLetters(mgr)) continue

      const n = toNumberLoose(r[pIdx])
      if (n == null) continue

      sum += n
      cnt++
    }

    if (cnt < 6) continue
    const avg = sum / cnt
    if (!best || avg > best.avg) best = { pIdx, avg, cnt }
  }

  return best?.pIdx ?? -1
}

function buildGroupsTablesFromCsvRows(rows, stopRowIdx) {
  const headers = rows[0] || []

  const groupIdx = findHeaderIndex(headers, (h) => h === "group")
  const rankIdx = findHeaderIndex(headers, (h) => h === "rank")
  if (groupIdx < 0 || rankIdx < 0) throw new Error("Could not find Group/Rank headers in Groups CSV.")

  const teamAIdx = findHeaderIndex(headers, (h) => h.includes("category a") && h.includes("team"))
  const teamBIdx = findHeaderIndex(headers, (h) => h.includes("category b") && h.includes("team"))
  const teamGIdx =
    findHeaderIndex(headers, (h) => h.includes("category") && h.includes("γ") && h.includes("team")) ||
    findHeaderIndex(headers, (h) => h.includes("category") && h.includes("t") && h.includes("team")) ||
    findHeaderIndex(headers, (h) => h.includes("category") && h.includes("g") && h.includes("team"))

  if (teamAIdx < 0 || teamBIdx < 0 || teamGIdx < 0) throw new Error("Could not find Category Team headers in Groups CSV.")

  const managerAIdx = teamAIdx + 1
  const managerBIdx = teamBIdx + 1
  const managerGIdx = teamGIdx + 1

  const pointsCols = findAllHeaderIndices(headers, (h) => h === "points")
  if (!pointsCols.length) throw new Error("Could not find any Points columns in Groups CSV.")

  const pointsA = pickBestPointsIndex(rows, teamAIdx, managerAIdx, pointsCols.filter((x) => x > managerAIdx), stopRowIdx)
  const pointsB = pickBestPointsIndex(rows, teamBIdx, managerBIdx, pointsCols.filter((x) => x > managerBIdx), stopRowIdx)
  const pointsG = pickBestPointsIndex(
    rows,
    teamGIdx,
    managerGIdx,
    pointsCols.filter((x) => x > managerGIdx),
    stopRowIdx
  )

  function readBlock(title, teamIdx, managerIdx, pointsIdx, opts = {}) {
    const out = []
    let currentGroup = ""
    const end = stopRowIdx > 0 ? Math.min(stopRowIdx, rows.length) : rows.length

    for (let i = 1; i < end; i++) {
      const r = rows[i] || []
      const g = s(r[groupIdx])
      if (looksLikeGroupLabel(g)) currentGroup = g

      const rank = s(r[rankIdx])
      const team = s(r[teamIdx])
      const manager = s(r[managerIdx])
      const pointsRaw = s(r[pointsIdx])

      if (!team && !manager && !pointsRaw && !g) continue
      if (!hasLetters(team) || !hasLetters(manager)) continue

      const ptsNum = toNumberLoose(pointsRaw)
      if (!opts.allowMissingPoints && ptsNum == null) continue

      out.push({
        group: currentGroup,
        rank,
        team,
        manager,
        pointsRaw: ptsNum == null ? "" : pointsRaw,
      })
    }

    return { title, rows: out }
  }

  return [
    readBlock("CATEGORY A", teamAIdx, managerAIdx, pointsA, { allowMissingPoints: false }),
    readBlock("CATEGORY B", teamBIdx, managerBIdx, pointsB, { allowMissingPoints: false }),
    readBlock("CATEGORY Γ", teamGIdx, managerGIdx, pointsG, { allowMissingPoints: true }),
  ]
}

function parseChampionsLeagueTable(rows, startIdx) {
  if (startIdx < 0) return null

  const headers = rows[0] || []
  const rankIdx = findHeaderIndex(headers, (h) => h === "rank")
  const teamAIdx = findHeaderIndex(headers, (h) => h.includes("category a") && h.includes("team"))
  const managerAIdx = teamAIdx >= 0 ? teamAIdx + 1 : -1
  if (rankIdx < 0 || teamAIdx < 0 || managerAIdx < 0) return null

  const out = []
  let emptyStreak = 0

  for (let i = startIdx + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const seed = s(r[rankIdx])
    const team = s(r[teamAIdx])
    const manager = s(r[managerAIdx])

    const allEmpty = r.every((x) => !s(x))
    if (allEmpty) {
      emptyStreak++
      if (emptyStreak >= 8) break
      continue
    }
    emptyStreak = 0

    if (!hasLetters(team) || !hasLetters(manager)) continue
    out.push({ seed, team, manager })
  }

  return out.length ? { title: "CHAMPIONS LEAGUE", rows: out } : null
}

function groupByGroupLabel(rows) {
  const map = new Map()
  for (const r of rows) {
    const g = s(r.group) || "—"
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(r)
  }
  const keys = Array.from(map.keys())
  keys.sort((a, b) => {
    const ma = /^(\d+)/.exec(a)
    const mb = /^(\d+)/.exec(b)
    const na = ma ? Number(ma[1]) : 999
    const nb = mb ? Number(mb[1]) : 999
    return na - nb
  })
  return keys.map((k) => ({ group: k, rows: map.get(k) }))
}

/* ----------------------------- General Rankings parsing (All sheet) ----------------------------- */
/**
 * IMPORTANT:
 * - Do NOT touch GENERAL RANKING and REGULAR SEASON PERFORMANCE mapping logic.
 * - Fix POINTS SYSTEM mapping to correctly pick season columns + totals based on data shape,
 *   future-proof when new season is inserted and everything shifts.
 */
function parseGeneralRankings(rows) {
  if (!rows?.length || rows.length < 3) throw new Error("General Rankings CSV is missing rows.")

  const top = rows[0] || [] // section headers (merged)
  const hdr = rows[1] || [] // column headers (many blanks)
  const colCount = Math.max(top.length, hdr.length)

  // Fill-forward section names from merged row0 (still ok to keep)
  const sectionByIdx = []
  let curSection = ""
  for (let i = 0; i < colCount; i++) {
    const t = s(top[i])
    if (t) curSection = t
    sectionByIdx[i] = curSection || "OTHER"
  }

  // Stable columns
  const idxRank = 0
  const idxTeam = hdr.findIndex((x) => norm(x) === "team")
  if (idxTeam < 0) throw new Error("Could not find Team column in All CSV.")

  // Data rows (real teams)
  const data = []
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] || []
    const team = s(row[idxTeam])
    if (!team || !hasLetters(team)) continue
    data.push(row)
  }

  // Column metadata
  const cols = Array.from({ length: colCount }, (_, idx) => {
    const section = sectionByIdx[idx]
    const raw = s(hdr[idx])

    let label = raw
    if (idx === idxRank) label = "#"
    else if (idx === idxTeam) label = "Team"
    else if (!label) label = "" // fill later

    return { idx, section, label }
  })

  const WANT = {
    "GENERAL RANKING": { fixed: ["Manager"], includeYearCols: true },
    "POINTS SYSTEM": { fixed: ["Total", "League points", "Extra", "Total 3Y"] },
    AWARDS: {
      fixed: [
        "Total Trophies",
        "Champion A",
        "League Winner A",
        "Final A",
        "Champions League",
        "Cup",
        "Regular Season",
        "Champion B",
        "League Winner B",
        "Champion Γ",
        "League Winner Γ",
      ],
    },
    "REGULAR SEASON PERFORMANCE": { fixed: ["Bye Position (1-2)%", "Playoffs Entry (1-6)%", "Average Position", "W%"] },
  }

  const KNOWN = Object.keys(WANT)

  // ----------------- GENERAL RANKING (DO NOT TOUCH) -----------------
  const yearIdxs = []
  for (let i = 0; i < colCount; i++) {
    const lab = s(hdr[i])
    if (!/^\d{4}$/.test(lab)) continue
    if (sectionByIdx[i] === "GENERAL RANKING") yearIdxs.push(i)
  }
  yearIdxs.sort((a, b) => Number(s(hdr[b])) - Number(s(hdr[a]))) // newest->oldest
  const years = yearIdxs.map((i) => Number(s(hdr[i])))
  const latestYear = years.length ? Math.max(...years) : null

  const idx2020 = hdr.findIndex((x) => s(x) === "2020")
  if (idx2020 < 0) throw new Error("Could not find the '2020' column in All CSV.")

  // ----------------- Separator logic (empty column) -----------------
  function isSeparatorCol(colIdx) {
    const sample = data.slice(0, 220)
    if (!sample.length) return false
    let empty = 0
    for (const r of sample) if (!s(r[colIdx])) empty++
    const emptyRatio = empty / sample.length
    return emptyRatio >= 0.9
  }

  function findNextSeparator(fromIdx) {
    for (let i = fromIdx; i < colCount; i++) {
      if (i === idxTeam || i === idxRank) continue
      if (isSeparatorCol(i)) return i
    }
    return -1
  }

  const sepAfter2020 = findNextSeparator(idx2020 + 1)
  const startPS = idx2020 + 2

  if (sepAfter2020 !== idx2020 + 1) {
    console.log("[All] Expected separator at 2020+1, found at:", sepAfter2020)
  }

  const sepAfterPS = findNextSeparator(startPS)
  if (sepAfterPS < 0) throw new Error("Could not find the separator column after POINTS SYSTEM block.")

  // POINTS SYSTEM block columns are [startPS .. sepAfterPS-1]
  const psBlock = []
  for (let i = startPS; i < sepAfterPS; i++) psBlock.push(i)
  if (psBlock.length < 4) throw new Error("POINTS SYSTEM block too small (expected at least 4 totals columns).")

  const psSeasons = psBlock.slice(0, -4)
  const psTotals = psBlock.slice(-4)

  if (latestYear != null) {
    for (let k = 0; k < psSeasons.length; k++) {
      const start = latestYear - 2 - k
      const end = latestYear - 1 - k
      cols[psSeasons[k]].label = `${start}-${end}`
    }
  } else {
    for (let k = 0; k < psSeasons.length; k++) cols[psSeasons[k]].label = `Season ${k + 1}`
  }

  cols[psTotals[0]].label = "Total"
  cols[psTotals[1]].label = "League points"
  cols[psTotals[2]].label = "Extra"
  cols[psTotals[3]].label = "Total 3Y"

  // ----------------- AWARDS (FIX: take EXACT next 11 columns after separator) -----------------
  const awardsStart = sepAfterPS + 1
  const AWARDS_COUNT = 11

  const awardsBlock = []
  for (let i = awardsStart; i < Math.min(colCount, awardsStart + AWARDS_COUNT); i++) awardsBlock.push(i)

  for (let i = 0; i < awardsBlock.length; i++) {
    const idx = awardsBlock[i]
    cols[idx].label = WANT.AWARDS.fixed[i] || `AWARDS ${i + 1}`
  }

  // ----------------- REGULAR SEASON PERFORMANCE labels (DO NOT TOUCH behavior) -----------------
  const rspIdxs = cols
    .filter((c) => c.section === "REGULAR SEASON PERFORMANCE")
    .map((c) => c.idx)
    .filter((i) => i !== idxRank && i !== idxTeam)

  for (let i = 0; i < rspIdxs.length; i++) {
    if (!cols[rspIdxs[i]].label) {
      cols[rspIdxs[i]].label = WANT["REGULAR SEASON PERFORMANCE"].fixed[i] || `REGULAR SEASON PERFORMANCE ${i + 1}`
    }
  }

  // Fill any remaining blanks
  const counter = {}
  for (const c of cols) {
    if (c.label) continue
    const sec = c.section || "OTHER"
    counter[sec] = (counter[sec] || 0) + 1
    c.label = `${sec} ${counter[sec]}`
  }

  const sectionToCols = {}

  // GENERAL RANKING: Manager + YYYY
  sectionToCols["GENERAL RANKING"] = []
  const idxManager = hdr.findIndex((x) => norm(x) === "manager")
  if (idxManager >= 0 && sectionByIdx[idxManager] === "GENERAL RANKING") {
    sectionToCols["GENERAL RANKING"].push(idxManager)
  }
  for (const i of yearIdxs) sectionToCols["GENERAL RANKING"].push(i)

  // POINTS SYSTEM: seasons + totals
  sectionToCols["POINTS SYSTEM"] = [...psSeasons, ...psTotals]

  // AWARDS: derived block
  sectionToCols.AWARDS = awardsBlock

  // RSP: fixed list by label match
  sectionToCols["REGULAR SEASON PERFORMANCE"] = []
  for (const name of WANT["REGULAR SEASON PERFORMANCE"].fixed) {
    const idx = cols.find((c) => c.section === "REGULAR SEASON PERFORMANCE" && norm(c.label) === norm(name))?.idx
    if (idx != null) sectionToCols["REGULAR SEASON PERFORMANCE"].push(idx)
  }

  console.log("[All] idx2020:", idx2020, "startPS:", startPS, "sepAfterPS:", sepAfterPS)
  console.log("[All] psSeasons:", psSeasons.map((i) => cols[i].label), "psTotals:", psTotals.map((i) => cols[i].label))
  console.log("[All] awardsStart:", awardsStart, "awardsCols:", awardsBlock.length)

  return { cols, data, idxRank, idxTeam, knownSections: KNOWN, sectionToCols }
}

/* ----------------------------- UI bits ----------------------------- */

function BigNavCard({ to, title, subtitle }) {
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div
        className="card"
        style={{
          padding: 22,
          minHeight: 170,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderColor: "rgba(216,120,32,0.45)",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 900 }}>{title}</div>
        <div style={{ marginTop: 10, color: "var(--gnfc-muted)", fontSize: 14 }}>{subtitle}</div>
        <div style={{ marginTop: 18 }}>
          <span className="badge">Enter</span>
        </div>
      </div>
    </Link>
  )
}

function DivisionButton({ to, title, subtitle }) {
  return <BigNavCard to={to} title={title} subtitle={subtitle} />
}

function Tabs({ value, onChange }) {
  const pill = (active) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "7px 12px",
    borderRadius: 999,
    border: `1px solid rgba(249,115,22,${active ? 0.75 : 0.45})`,
    background: active ? "rgba(249,115,22,0.14)" : "rgba(249,115,22,0.06)",
    color: "rgba(15,23,42,0.95)",
    fontWeight: 900,
    letterSpacing: 0.3,
    cursor: "pointer",
    userSelect: "none",
    textDecoration: "none",
  })

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button type="button" style={pill(value === "groups")} onClick={() => onChange("groups")}>
        Groups
      </button>

      <button type="button" style={pill(value === "general")} onClick={() => onChange("general")}>
        General Rankings
      </button>
    </div>
  )
}

/* ----- Tables ----- */

function CategoryTable({ title, rows }) {
  const hasRank = rows.some((r) => s(r.rank))
  const grouped = useMemo(() => groupByGroupLabel(rows), [rows])

  const tableStyle = { width: "100%", fontSize: 13, lineHeight: 1.15 }
  const thStyle = { fontSize: 12, letterSpacing: 0.3 }
  const tdStyle = { paddingTop: 6, paddingBottom: 6 }
  const hashColW = 34

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>{rows.length} teams</div>
      </div>

      <div style={{ height: 10 }} />

      {grouped.map((g) => (
        <div key={g.group} style={{ marginTop: 8 }}>
          <div
            style={{
              textAlign: "center",
              fontWeight: 950,
              textTransform: "uppercase",
              letterSpacing: 1.1,
              color: "var(--gnfc-muted)",
              padding: "10px 0 8px 0",
              fontSize: 12,
            }}
          >
            {g.group} Group
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table" style={tableStyle}>
              <thead>
                <tr>
                  {hasRank && (
                    <th
                      style={{
                        ...thStyle,
                        width: hashColW,
                        textAlign: "left",
                        color: HASH_COLOR,
                        paddingLeft: 6,
                        paddingRight: 6,
                      }}
                    >
                      #
                    </th>
                  )}
                  <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
                  <th style={{ ...thStyle, textAlign: "left" }}>Manager</th>
                  <th style={{ ...thStyle, width: 84, textAlign: "right" }}>Points</th>
                </tr>
              </thead>

              <tbody>
                {g.rows.map((r, idx) => (
                  <tr key={`${g.group}-${idx}`}>
                    {hasRank && (
                      <td
                        style={{
                          ...tdStyle,
                          width: hashColW,
                          textAlign: "left",
                          fontWeight: 900,
                          color: HASH_COLOR,
                          paddingLeft: 6,
                          paddingRight: 6,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cell(r.rank)}
                      </td>
                    )}
                    <td style={{ ...tdStyle, fontWeight: 800, textAlign: "left" }}>
                      <Link className="teamLink" to={teamHref(r.team)} style={{ lineHeight: 1.15 }}>
                        {cell(r.team)}
                      </Link>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "left" }}>{cell(r.manager)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {s(r.pointsRaw) ? formatPointsTrunc2(r.pointsRaw) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ height: 8 }} />
        </div>
      ))}
    </div>
  )
}

function ChampionsLeagueTable({ title, rows }) {
  const tableStyle = { width: "100%", fontSize: 13, lineHeight: 1.15 }
  const thStyle = { fontSize: 12, letterSpacing: 0.3 }
  const tdStyle = { paddingTop: 6, paddingBottom: 6 }
  const hashColW = 34

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>{rows.length} teams</div>
      </div>

      <div style={{ height: 10 }} />

      <div style={{ overflowX: "auto" }}>
        <table className="table" style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: hashColW, textAlign: "left", color: HASH_COLOR, paddingLeft: 6, paddingRight: 6 }}>
                #
              </th>
              <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Manager</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td
                  style={{
                    ...tdStyle,
                    width: hashColW,
                    textAlign: "left",
                    fontWeight: 900,
                    color: HASH_COLOR,
                    paddingLeft: 6,
                    paddingRight: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {cell(r.seed)}
                </td>
                <td style={{ ...tdStyle, fontWeight: 800, textAlign: "left" }}>
                  <Link className="teamLink" to={teamHref(r.team)} style={{ lineHeight: 1.15 }}>
                    {cell(r.team)}
                  </Link>
                </td>
                <td style={{ ...tdStyle, textAlign: "left" }}>{cell(r.manager)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GeneralRankingsTable({ parsed, view, onViewChange }) {
  const { cols, data, idxRank, idxTeam, knownSections, sectionToCols } = parsed

  const selectedCols = sectionToCols[view] || []
  const renderCols = [idxRank, idxTeam, ...selectedCols]

  const [sort, setSort] = useState({ colIdx: idxRank, dir: "asc" })

  const sortedData = useMemo(() => {
    return sortRowsStable(
      data,
      (row) => {
        const v = row?.[sort.colIdx]
        return s(v) ? v : "0"
      },
      sort.dir
    )
  }, [data, sort])

  const wRank = 34
  const wTeam = 220

  const isRSP = view === "REGULAR SEASON PERFORMANCE"
  const shouldWrapHeader = (colIdx) => isRSP && colIdx !== idxRank && colIdx !== idxTeam
  const isManagerCol = (colIdx) => norm(cols?.[colIdx]?.label) === "manager"

  const selectStyle = {
    padding: "7px 12px",
    borderRadius: 999,
    border: "1px solid rgba(249,115,22,0.55)",
    background: "rgba(249,115,22,0.08)",
    color: "rgba(15,23,42,0.95)",
    fontWeight: 900,
    letterSpacing: 0.3,
    outline: "none",
  }

  const stickyBg = "transparent"

  const thBase = {
    fontSize: 12,
    letterSpacing: 0.3,
    textAlign: "left",
    background: "transparent",
    position: "sticky",
    top: 0,
    zIndex: 1,
    cursor: "pointer",
    userSelect: "none",
  }

  const tdBase = {
    fontSize: 13,
    lineHeight: 1.15,
    paddingTop: 6,
    paddingBottom: 6,
    verticalAlign: "top",
  }

  function thStyleFor(i) {
    const isRank = i === idxRank
    const isTeam = i === idxTeam
    const wrap = shouldWrapHeader(i)

    const sticky =
      isRank ? { left: 0, zIndex: 3, background: stickyBg } : isTeam ? { left: wRank, zIndex: 3, background: stickyBg } : {}

    return {
      ...thBase,
      ...(isRank
        ? {
            width: wRank,
            color: HASH_COLOR,
            paddingLeft: 6,
            paddingRight: 6,
            whiteSpace: "normal",
            overflowWrap: "normal",
            wordBreak: "normal",
            maxWidth: wRank,
          }
        : {}),
      ...(isTeam ? { width: wTeam, whiteSpace: "normal", overflowWrap: "normal", wordBreak: "normal", maxWidth: wTeam } : {}),
      ...(isManagerCol(i) ? { whiteSpace: "normal", overflowWrap: "normal", wordBreak: "normal", maxWidth: 160 } : {}),
      ...(wrap
        ? {
            whiteSpace: "normal",
            lineHeight: 1.1,
            overflowWrap: "normal",
            wordBreak: "normal",
            hyphens: "auto",
            maxWidth: 92,
            minWidth: 72,
            overflow: "hidden",
          }
        : { whiteSpace: "nowrap" }),
      ...sticky,
    }
  }

  function tdStyleFor(i) {
    const isRank = i === idxRank
    const isTeam = i === idxTeam

    const sticky =
      isRank ? { position: "sticky", left: 0, zIndex: 2, background: stickyBg } : isTeam ? { position: "sticky", left: wRank, zIndex: 2, background: stickyBg } : {}

    return {
      ...tdBase,
      ...(isRank
        ? {
            width: wRank,
            fontWeight: 900,
            color: HASH_COLOR,
            whiteSpace: "normal",
            overflowWrap: "normal",
            wordBreak: "normal",
            paddingLeft: 6,
            paddingRight: 6,
            maxWidth: wRank,
          }
        : {}),
      ...(isTeam
        ? {
            width: wTeam,
            fontWeight: 800,
            whiteSpace: "normal",
            overflowWrap: "normal",
            wordBreak: "normal",
            maxWidth: wTeam,
          }
        : {}),
      ...(isManagerCol(i) ? { whiteSpace: "normal", overflowWrap: "normal", wordBreak: "normal", maxWidth: 160 } : {}),
      ...sticky,
    }
  }

  function onSort(colIdx) {
    setSort((prev) => (prev.colIdx === colIdx ? { colIdx, dir: toggleDir(prev.dir) } : { colIdx, dir: "asc" }))
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase" }}>General Rankings</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--gnfc-muted)" }}>View: {view}</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>{data.length} teams</div>

          <select value={view} onChange={(e) => onViewChange(e.target.value)} style={selectStyle} aria-label="General Rankings section">
            {knownSections.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ height: 10 }} />

      <div style={{ overflowX: "auto" }}>
        <table
          className="table"
          style={{
            width: "100%",
            fontSize: 13,
            lineHeight: 1.15,
            tableLayout: isRSP ? "fixed" : "auto",
          }}
        >
          <thead>
            <tr>
              {renderCols.map((i) => (
                <th key={i} style={thStyleFor(i)} onClick={() => onSort(i)} title="Sort">
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                    <span style={{ minWidth: 0 }}>{cols[i]?.label || `Col ${i + 1}`}</span>

                    {sort.colIdx === i && (
                      <span style={{ fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}>
                        {sort.dir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedData.map((row, ridx) => (
              <tr key={ridx}>
                {renderCols.map((i) => {
                  const v = row[i]
                  if (i === idxTeam) {
                    return (
                      <td key={i} style={tdStyleFor(i)}>
                        <Link className="teamLink" to={teamHref(v)} style={{ lineHeight: 1.15, display: "inline" }}>
                          {cell(v)}
                        </Link>
                      </td>
                    )
                  }
                  return (
                    <td key={i} style={tdStyleFor(i)}>
                      {cell(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, color: "var(--gnfc-muted)", fontSize: 12 }}>Source: All</div>
    </div>
  )
}

/* ----------------------------- page ----------------------------- */

export default function Home() {
  const [tab, setTab] = useState("groups")
  const [generalView, setGeneralView] = useState("GENERAL RANKING")

  const [loadingGroups, setLoadingGroups] = useState(true)
  const [errGroups, setErrGroups] = useState("")
  const [groupTables, setGroupTables] = useState([])
  const [clTable, setClTable] = useState(null)

  const [loadingAll, setLoadingAll] = useState(true)
  const [errAll, setErrAll] = useState("")
  const [general, setGeneral] = useState(null)

  // Fetch Groups
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoadingGroups(true)
        setErrGroups("")
        const res = await fetch(gvizCsvUrl(SHEET_ID, GROUPS_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`Groups fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)
        const clStart = findChampionsLeagueStart(rows)
        const tables = buildGroupsTablesFromCsvRows(rows, clStart)
        const cl = parseChampionsLeagueTable(rows, clStart)

        if (alive) {
          setGroupTables(tables)
          setClTable(cl)
        }
      } catch (e) {
        if (alive) setErrGroups(e?.message || String(e))
      } finally {
        if (alive) setLoadingGroups(false)
      }
    })()
    return () => (alive = false)
  }, [])

  // Fetch All (General Rankings)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoadingAll(true)
        setErrAll("")
        const res = await fetch(gvizCsvUrl(SHEET_ID, ALL_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`All fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)
        const parsed = parseGeneralRankings(rows)

        if (alive) setGeneral(parsed)
      } catch (e) {
        if (alive) setErrAll(e?.message || String(e))
      } finally {
        if (alive) setLoadingAll(false)
      }
    })()
    return () => (alive = false)
  }, [])

  const gridStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 14,
      marginTop: 14,
      alignItems: "start",
    }),
    []
  )

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />
          <div className="brand-title">
            <h1>The Greek NBA Fantasy Championship</h1>
            <p>Choose a division • Rankings</p>
          </div>
        </div>
      </div>

      <div className="container">
        {/* Divisions always visible */}
        <div className="divisionGrid sideBySideDivisions">
          <DivisionButton to="/division/A" title="Division A" subtitle="leagues A1, A2, A3, A4" />
          <DivisionButton
            to="/division/B"
            title="Division B"
            subtitle="leagues B1, B2, B3, B4"
          />
          <DivisionButton to="/division/Γ" title="Division Γ" subtitle="leagues Γ1, Γ2, Γ3..." />
        </div>

        {/* ✅ Big boxes under divisions */}
        {/* ✅ Big boxes under divisions */}
        <div className="divisionGrid sideBySideExtras" style={{ marginTop: 14 }}>
          <BigNavCard
            to="/champions-league"
            title="Champions League"
            subtitle="Matchups • Winners • Standings • History"
          />
          <BigNavCard
            to="/cup"
            title="GNFC Cup"
            subtitle="Cup bracket • Matchups • Podium"
          />
          <BigNavCard
            to="/championsrace"
            title="Champions Race"
            subtitle="Standings • Matchups • Race overview"
          />
          <BigNavCard
            to="/history"
            title="History"
            subtitle="Trophies • Placements • Past Seasons & Records"
          />
        </div>

        {/* Tabs below (only groups/general now) */}
        <div style={{ marginTop: 14 }}>
          <Tabs value={tab} onChange={setTab} />
        </div>

        <div style={{ height: 14 }} />

        {tab === "groups" && (
          <>
            {loadingGroups && (
              <div className="card" style={{ padding: 16, color: "var(--gnfc-muted)" }}>
                Loading groups…
              </div>
            )}

            {!loadingGroups && errGroups && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900 }}>Could not load Groups</div>
                <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>{errGroups}</div>
              </div>
            )}

            {!loadingGroups && !errGroups && (
              <>
                <div className="groupsGrid" style={gridStyle}>
                  {groupTables.map((t) => (
                    <CategoryTable key={t.title} title={t.title} rows={t.rows} />
                  ))}
                  {clTable ? <ChampionsLeagueTable title={clTable.title} rows={clTable.rows} /> : <div />}
                </div>

                <style>{`
                  .teamLink{ color: inherit; text-decoration: none; }
                  .teamLink:hover{ color: ${ORANGE}; text-decoration: underline; text-underline-offset: 3px; }

                  .sideBySideDivisions{
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 14px;
                  }

                  .sideBySideExtras{
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 14px;
                  }

                  @media (max-width: 1100px){
                    .sideBySideDivisions{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    .sideBySideExtras{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    .groupsGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                  }
                  @media (max-width: 720px){
                    .sideBySideDivisions{ grid-template-columns: 1fr; }
                    .sideBySideExtras{ grid-template-columns: 1fr; }
                    .groupsGrid{ grid-template-columns: 1fr !important; }
                  }
                `}</style>
              </>
            )}
          </>
        )}

        {tab === "general" && (
          <>
            {loadingAll && (
              <div className="card" style={{ padding: 16, color: "var(--gnfc-muted)" }}>
                Loading general rankings…
              </div>
            )}

            {!loadingAll && errAll && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900 }}>Could not load General Rankings</div>
                <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>{errAll}</div>
              </div>
            )}

            {!loadingAll && !errAll && general && (
              <>
                <GeneralRankingsTable parsed={general} view={generalView} onViewChange={setGeneralView} />

                <style>{`
                  .teamLink{ color: inherit; text-decoration: none; }
                  .teamLink:hover{ color: ${ORANGE}; text-decoration: underline; text-underline-offset: 3px; }

                  .sideBySideDivisions{
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 14px;
                  }
                  .sideBySideExtras{
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 14px;
                  }

                  @media (max-width: 1100px){
                    .sideBySideDivisions{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    .sideBySideExtras{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
                  }
                  @media (max-width: 720px){
                    .sideBySideDivisions{ grid-template-columns: 1fr; }
                    .sideBySideExtras{ grid-template-columns: 1fr; }
                  }

                  /* ✅ Mobile tightening: allow wrap ONLY on spaces (not letters) */
                  @media (max-width: 520px){
                    .table th{ font-size: 11px; }

                    /* # column */
                    .table th:nth-child(1),
                    .table td:nth-child(1){
                      width: 28px !important;
                      max-width: 28px !important;
                      white-space: normal !important;
                      overflow-wrap: normal !important;
                      word-break: normal !important;
                      hyphens: auto;
                    }

                    /* Team column */
                    .table th:nth-child(2),
                    .table td:nth-child(2){
                      width: 150px !important;
                      max-width: 150px !important;
                      white-space: normal !important;
                      overflow-wrap: normal !important;
                      word-break: normal !important;
                      hyphens: auto;
                    }

                    /* Manager column */
                    .table th:nth-child(3),
                    .table td:nth-child(3){
                      width: 140px !important;
                      max-width: 140px !important;
                      white-space: normal !important;
                      overflow-wrap: normal !important;
                      word-break: normal !important;
                      hyphens: auto;
                    }
                  }
                `}</style>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}