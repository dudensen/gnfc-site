// GNFC_ROTO_PAGE v1
export const ROTO_SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
export const ROTO_GID = "1487963219"
export const ROTO_SHEET_URL = `https://docs.google.com/spreadsheets/d/${ROTO_SHEET_ID}/edit?gid=${ROTO_GID}#gid=${ROTO_GID}`
export const ROTO_CSV_URL = `https://docs.google.com/spreadsheets/d/${ROTO_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${ROTO_GID}`

// GP is tracked separately from the eight scoring categories. TO is absent.
export const ROTO_STATS = ["GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK"]

export function normalizeRotoText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim()
}

export function rotoNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  let text = clean(value).replace(/[\s\u00a0%]/g, "")
  if (!text || /^[—–-]$/.test(text)) return null
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "")
  } else if (text.includes(",")) {
    text = /^[+-]?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".")
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

export function parseRotoCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "")
  const rows = []
  let row = [], value = "", quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i++ }
      else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') quoted = true
    else if (char === ",") { row.push(value); value = "" }
    else if (char === "\n") { row.push(value); rows.push(row); row = []; value = "" }
    else if (char !== "\r") value += char
  }
  if (quoted) throw new Error("The roto spreadsheet returned an incomplete CSV response. Please refresh.")
  row.push(value)
  if (row.some((cell) => clean(cell))) rows.push(row)
  return rows
}

export function parseRotoStandings(text) {
  if (/^\s*(?:<!doctype|<html)/i.test(String(text))) {
    throw new Error("The roto spreadsheet returned a web page instead of standings. Please check its sharing settings.")
  }
  const rows = parseRotoCsv(text)
  const headerIndex = rows.findIndex((row, index) => index < 15 &&
    normalizeRotoText(row[1]) === "team" && normalizeRotoText(row[2]) === "roto score" &&
    normalizeRotoText(row[0]).includes("regular ranking"))
  if (headerIndex < 0) throw new Error("Could not find the roto standings headers in the spreadsheet.")
  const headers = rows[headerIndex].map(normalizeRotoText)
  const checks = [[3, "roto ranking"], [4, "league points"], [5, "league ranking"], [6, "manager"], [7, "league"], [9, "gp"]]
  if (checks.some(([index, label]) => headers[index] !== label) ||
      !headers[10]?.endsWith("fg%") || !headers[19]?.endsWith("gp") ||
      ROTO_STATS.slice(1).some((stat, index) => headers[20 + index] !== normalizeRotoText(stat))) {
    throw new Error("The roto spreadsheet column layout has changed. Please check the standings columns before displaying this data.")
  }
  // Validate both similarly named blocks so percentages cannot be mistaken for ranks.
  if (ROTO_STATS.slice(2).some((stat, index) => headers[11 + index] !== normalizeRotoText(stat))) {
    throw new Error("The roto statistics columns no longer match the expected categories.")
  }
  const seen = new Set()
  const teams = []
  rows.slice(headerIndex + 1).forEach((row, sourceIndex) => {
    const team = clean(row[1]), league = clean(row[7])
    if (!team || !league) return
    const overallRank = rotoNumber(row[0])
    if (!Number.isInteger(overallRank) || overallRank < 1) {
      throw new Error(`The overall position for ${team} is missing or invalid in the spreadsheet.`)
    }
    const id = `${league}\u0000${team}`
    if (seen.has(id)) throw new Error(`Duplicate roto entry for ${team} in ${league}.`)
    seen.add(id)
    const stats = {}, categoryRanks = {}
    ROTO_STATS.forEach((stat, index) => {
      stats[stat] = clean(row[9 + index])
      categoryRanks[stat] = clean(row[19 + index])
    })
    teams.push({
      id, sourceIndex, overallRank, team, manager: clean(row[6]), league,
      // These are independent published fields; none are recalculated here.
      rotoScore: clean(row[2]), rotoRank: clean(row[3]),
      leaguePoints: clean(row[4]), leagueRank: clean(row[5]), stats, categoryRanks,
    })
  })
  if (!teams.length) throw new Error("The roto spreadsheet currently contains no ranked teams.")
  return teams.sort((a, b) => a.overallRank - b.overallRank || a.sourceIndex - b.sourceIndex)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

export function sortRotoTeams(teams, column, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1
  return [...teams].sort((a, b) => {
    const valueForSort = column.sortValue || column.value
    const rawA = valueForSort(a), rawB = valueForSort(b)
    const valueA = column.numeric ? rotoNumber(rawA) : clean(rawA)
    const valueB = column.numeric ? rotoNumber(rawB) : clean(rawB)
    const missingA = valueA == null || valueA === ""
    const missingB = valueB == null || valueB === ""
    if (missingA !== missingB) return missingA ? 1 : -1
    const compared = missingA ? 0 : column.numeric ? valueA - valueB : collator.compare(valueA, valueB)
    return compared * multiplier || a.overallRank - b.overallRank || a.sourceIndex - b.sourceIndex
  })
}

export function filterRotoTeams(teams, league, query) {
  const wanted = normalizeRotoText(query)
  return teams.filter((row) => (league === "all" || row.league === league) &&
    (!wanted || normalizeRotoText(`${row.team} ${row.manager}`).includes(wanted)))
}

// GNFC_ROTO_LEAGUE_SCOPING v2
export function scopeRotoTeams(teams, league) {
  if (league === "all") return teams
  const pool = teams.filter((row) => row.league === league)
  const count = pool.length
  if (!count) return []

  // Published ranks preserve the sheet's comparisons, precision, and ties.
  // GP ranks are ascending; all eight scoring categories are descending.
  function ranksFor(valueFor, higherBetter = false) {
    const values = new Map(pool.map((row) => [row.id, valueFor(row)]))
    return new Map(pool.map((row) => {
      const value = values.get(row.id)
      if (value == null) return [row.id, ""]
      const better = [...values.values()].filter((other) => other != null &&
        (higherBetter ? other > value : other < value)).length
      return [row.id, better + 1]
    }))
  }

  const categoryRanks = new Map(pool.map((row) => [row.id, {}]))
  for (const stat of ROTO_STATS) {
    const ranks = ranksFor((row) => rotoNumber(row.categoryRanks[stat]))
    for (const row of pool) categoryRanks.get(row.id)[stat] = ranks.get(row.id)
  }

  const scoringCategories = ROTO_STATS.filter((stat) => stat !== "GP")
  const complete = pool.every((row) => scoringCategories.every((stat) =>
    rotoNumber(row.categoryRanks[stat]) != null))
  const scoreUnits = new Map()
  for (const row of pool) {
    if (!complete || count < 2) { scoreUnits.set(row.id, null); continue }
    let units = 0
    for (const opponent of pool) {
      if (row.id === opponent.id) continue
      for (const stat of scoringCategories) {
        const own = rotoNumber(row.categoryRanks[stat])
        const other = rotoNumber(opponent.categoryRanks[stat])
        // Two integer units per win, one per tie. This avoids floating ties.
        if (own < other) units += 2
        else if (own === other) units += 1
      }
    }
    scoreUnits.set(row.id, units)
  }
  const rotoRanks = ranksFor((row) => scoreUnits.get(row.id), true)
  return pool.map((row) => {
    const units = scoreUnits.get(row.id)
    // Same formula as the sheet, using only this league's opponents.
    // Excluding self removes the sheet's subtraction of four self-tie points.
    const score = units == null ? null : units / (2 * (count - 1))
    const rank = count === 1 && complete ? 1 : rotoRanks.get(row.id)
    return {
      ...row,
      categoryRanks: categoryRanks.get(row.id),
      scopeRank: rank,
      rotoScoreValue: score,
      rotoScore: score == null ? "" : (Math.round((score + Number.EPSILON) * 10) / 10).toFixed(1),
      rotoRank: rank,
    }
  })
}
