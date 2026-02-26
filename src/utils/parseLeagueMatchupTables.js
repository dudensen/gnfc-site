// src/utils/parseLeagueMatchupTables.js

function s(x) {
  return String(x ?? "")
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ") // nbsp
    .trim()
}

function canonHeader(h) {
  // Normalize common weird characters from Sheets
  return s(h)
    .replace(/[％]/g, "%") // full-width percent
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

function isEmptyRow(row) {
  return !row || row.every((c) => !s(c))
}

function rowText(row) {
  return row.map(s).join(" ").toUpperCase()
}

function findRowIndex(rows, predicate, start = 0) {
  for (let i = start; i < rows.length; i++) {
    if (predicate(rows[i], i)) return i
  }
  return -1
}

function findTitleRow(rows, titleText) {
  const needle = String(titleText).toUpperCase()
  return findRowIndex(rows, (r) => rowText(r).includes(needle))
}

function findHeaderRowAfter(rows, startIdx) {
  // Find next row where ANY cell equals "Team"
  return findRowIndex(
    rows,
    (r) => r.some((c) => canonHeader(c).toLowerCase() === "team"),
    Math.max(0, startIdx + 1)
  )
}

function parseTable(rows, headerIdx, stopTitleText) {
  if (headerIdx < 0) return { headers: [], data: [] }

  const headerRowRaw = rows[headerIdx].map(s)
  const headerRow = headerRowRaw.map(canonHeader)

  const teamCol = headerRow.findIndex((c) => c.toLowerCase() === "team")
  if (teamCol < 0) return { headers: [], data: [] }

  // If the column LEFT of Team looks like a rank column, include it
  const rankCol = teamCol - 1
  let hasRank = false
  if (rankCol >= 0) {
    for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 8); i++) {
      const v = s(rows[i]?.[rankCol])
      if (!v) continue
      if (/^\d+$/.test(v)) {
        hasRank = true
        break
      }
    }
  }

  // Build headers list: optional Rank + from Team column onward (only non-empty headers)
  const headers = []
  if (hasRank) headers.push("Rank")

  const cols = []
  for (let j = teamCol; j < headerRow.length; j++) {
    const h = canonHeader(headerRow[j])
    if (!h) continue
    cols.push({ j, h })
    headers.push(h)
  }

  const data = []
  const stopNeedle = stopTitleText ? String(stopTitleText).toUpperCase() : ""

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || isEmptyRow(r)) break

    if (stopNeedle && rowText(r).includes(stopNeedle)) break

    const teamVal = s(r[teamCol])
    if (!teamVal) continue

    const obj = {}
    if (hasRank) obj["Rank"] = s(r[rankCol])

    cols.forEach(({ j, h }) => {
      obj[h] = s(r[j])
    })

    data.push(obj)
  }

  return { headers, data }
}

export function parseLeagueMatchupTables(grid) {
  const rows = (grid || []).map((r) => (r || []).map(s))

  const titleMatchup = "MATCHUP LIVE RESULTS"
  const titleStandings = "STANDINGS BEFORE MATCHUP"

  const matchupTitleIdx = findTitleRow(rows, titleMatchup)
  const matchupHeaderIdx = findHeaderRowAfter(rows, matchupTitleIdx)

  const standingsTitleIdx = findTitleRow(rows, titleStandings)
  const standingsHeaderIdx = findHeaderRowAfter(rows, standingsTitleIdx)

  const matchup = parseTable(rows, matchupHeaderIdx, titleStandings)
  const standings = parseTable(rows, standingsHeaderIdx, null)

  return { matchup, standings }
}