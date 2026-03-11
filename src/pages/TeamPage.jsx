// src/pages/TeamPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTeams } from "../hooks/useTeams"
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
  cl: "/awards/champions-league.webp",
  cup: "/awards/cup.webp",
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

/* ----------------------------- scoring helpers ----------------------------- */

function placementScore(value) {
  const x = normalizeLoose(value)
  if (!x) return -1

  const n = toNumberMaybe(x)
  if (n != null) return n

  if (x.includes("winner")) return 100
  if (x.includes("champion")) return 90
  if (x.includes("semi")) return 70
  if (x.includes("final")) return 80
  if (x.includes("quarter")) return 60
  if (x.includes("16")) return 50
  if (x.includes("32")) return 40

  return 0
}

function playoffPlacementScore(value) {
  const x = normalizeLoose(value)
  if (!x) return -1

  if (x.includes("winner")) return 100
  if (x.includes("champion")) return 100
  if (x.includes("semi")) return 80
  if (x === "final" || x.includes(" final")) return 90
  if (x.includes("quarter")) return 70
  if (x.includes("16")) return 60
  if (x.includes("32")) return 50

  const n = toNumberMaybe(x)
  if (n != null) return n

  return 0
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

  return { headers, data, idxTeam }
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

const CUP_COL_MATCHUP_NO = 0 // A
const CUP_COL_TEAM = 1 // B
const CUP_COL_ROUND_TITLE = 3 // D


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

  // if your current cup still uses "Week X" titles, map them explicitly
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

  // winner mark usually sits somewhere else on the same row
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

    // ONLY read round titles from column D, same spirit as GnfcCupPage
    const roundTitle = s(row[CUP_COL_ROUND_TITLE])
    const parsedStage = cupRoundFromTitle(roundTitle)
    if (parsedStage) {
      currentStage = parsedStage
      continue
    }

    if (!currentStage) continue

    // ONLY read the actual team from column B
    const rowTeam = s(row[CUP_COL_TEAM])
    if (!rowTeam) continue
    if (!teamNameMatches(rowTeam, teamName)) continue

    appearances.push({
      stage: currentStage,
      winner: isWinnerRowForTeam(row, teamName),
    })
  }

  if (!appearances.length) return ""

  // If the team appears in multiple rounds, keep the farthest VALID stage found
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
        const parsed = parseSimpleSheet(rows)

        if (alive) setOverviewParsed(parsed)
      } catch (e) {
        if (alive) {
          setOverviewParsed(null)
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

  const awardsSummary = useMemo(() => {
    if (!team?.team || !overviewParsed) return []

    const row = findRowForTeam(overviewParsed, team.team)
    if (!row) return []

    const rawAwards = [
      {
        key: "leagueWinnerA",
        label: "League Winner A",
        value: getFirstFilledFromLabels(overviewParsed.headers, row, ["League Winner A"]),
        iconType: "leagueA",
      },
      {
        key: "leagueWinnerB",
        label: "League Winner B",
        value: getFirstFilledFromLabels(overviewParsed.headers, row, ["League Winner B"]),
        iconType: "leagueB",
      },
      {
        key: "leagueWinnerG",
        label: "League Winner Γ",
        value: getFirstFilledFromLabels(overviewParsed.headers, row, ["League Winner Γ"]),
        iconType: "leagueG",
      },
      {
        key: "championsLeague",
        label: "Champions League",
        value: getFirstFilledFromLabels(overviewParsed.headers, row, ["Champions League"]),
        iconType: "cl",
      },
      {
        key: "cup",
        label: "Cup",
        value: getFirstFilledFromLabels(overviewParsed.headers, row, ["Cup"]),
        iconType: "cup",
      },
    ]

    return rawAwards
      .map((item) => {
        const num = toNumberMaybe(item.value)
        return {
          ...item,
          count: num != null ? num : 0,
        }
      })
      .filter((item) => item.count > 0)
  }, [overviewParsed, team?.team])

  const bestPerformance = useMemo(() => {
    if (!team?.team || !historyParsed.length) return []

    const leaguePointsCandidates = []
    const championsLeagueCandidates = []
    const cupCandidates = []
    const playoffsCandidates = []

    for (const { year, parsed } of historyParsed) {
      const row = findRowForTeam(parsed, team.team)
      if (!row) continue

      const leaguePoints = getFirstFilledFromLabels(parsed.headers, row, ["League points"])
      const cl = getFirstFilledFromLabels(parsed.headers, row, ["Champions League"])
      const cup = getFirstFilledFromLabels(parsed.headers, row, ["Cup"])
      const playoffs = getFirstFilledFromLabels(parsed.headers, row, ["Playoffs"])
      const league = getFirstFilledFromLabels(parsed.headers, row, ["League"], { exactOnly: true })

      const lpNum = toNumberMaybe(leaguePoints)
      if (lpNum != null) {
        leaguePointsCandidates.push({
          value: String(lpNum),
          year: Number(year),
          score: lpNum,
        })
      }

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
    }

    const bestLeaguePoints = bestOfCandidates(leaguePointsCandidates, (x) => x.score)
    const bestChampionsLeague = bestOfCandidates(championsLeagueCandidates, (x) => placementScore(x.value))
    const bestCup = bestOfCandidates(cupCandidates, (x) => placementScore(x.value))
    const bestLeaguePlacement = bestOfCandidates(playoffsCandidates, (x) => playoffPlacementScore(x.value))

    const bestLeaguePlacementScore = bestLeaguePlacement
      ? playoffPlacementScore(bestLeaguePlacement.value)
      : null

    const sameBestLeaguePlacementEntries =
      bestLeaguePlacementScore == null
        ? []
        : playoffsCandidates
            .filter((x) => playoffPlacementScore(x.value) === bestLeaguePlacementScore)
            .slice()
            .sort((a, b) => a.year - b.year)

    const divisionWinningEntries =
      bestLeaguePlacementScore == null
        ? []
        : playoffsCandidates
            .filter((x) => {
              const score = playoffPlacementScore(x.value)
              const label = normalizeLoose(x.value)
              return score === bestLeaguePlacementScore && label.includes("champion")
            })
            .slice()
            .sort((a, b) => a.year - b.year)

    function bestLeaguePlacementDisplay(entry, entries) {
      if (!entry) return ""

      const label = normalizeLoose(entry.value)
      const isWinner = label.includes("winner")

      if (isWinner) {
        const parts = entries.map((x) => {
          const leaguePart = x.league ? `${x.league} ` : ""
          return `${leaguePart}(${x.year})`
        })
        return `${entry.value} - ${parts.join(", ")}`
      }

      return `${entry.value} (${yearsText(uniqSortedYears(entries.map((x) => x.year)))})`
    }

    return [
      bestLeaguePoints
        ? {
            label: "Most League Points",
            display: `${bestLeaguePoints.value} (${bestLeaguePoints.year})`,
          }
        : null,

      bestChampionsLeague
        ? {
            label: "Best Champions League Placement",
            display: `${bestChampionsLeague.value} (${bestChampionsLeague.year})`,
          }
        : null,

      bestCup
        ? {
            label: "Best Cup Placement",
            display: `${bestCup.value} (${bestCup.year})`,
          }
        : null,

      bestLeaguePlacement
        ? {
            label: "Best League Placement",
            display: bestLeaguePlacementDisplay(bestLeaguePlacement, sameBestLeaguePlacementEntries),
          }
        : null,

      divisionWinningEntries.length
        ? {
            label: "Best Division",
            display: `${bestLeaguePlacement.value} (${yearsText(
              uniqSortedYears(divisionWinningEntries.map((x) => x.year))
            )})`,
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
  const rawCupValue = team?.raw ? getFirst(team.raw, "Cup") : ""

const currentCupValue = team?.raw
  ? (isMissingCupValue(getFirst(team.raw, "Cup")) ? cupFallbackValue : getFirst(team.raw, "Cup"))
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

    const wanted = [
      "league points",
      "category adj",
      "cup",
      "general standing",
      "stats winners",
      "tw",
      "rw",
      "extra",
      "total",
    ]

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

        if (
          cleanLabel === want ||
          fullLabel.includes(`points system ${want}`) ||
          fullLabel === want
        ) {
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
                    <div style={{ fontSize: 24, fontWeight: 1000, letterSpacing: 0.3 }}>{team.team}</div>
                    <div style={{ marginTop: 6, color: "var(--gnfc-muted)", fontSize: 14 }}>
                      Manager:{" "}
                      <span style={{ color: "var(--gnfc-text)", fontWeight: 800 }}>
                        {team.manager || "—"}
                      </span>
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

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
                alignItems: "stretch",
              }}
            >
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
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
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(0,0,0,0.12)",
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
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(0,0,0,0.12)",
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
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(0,0,0,0.12)",
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
    </>
  )
}

/* ----------------------------- styles ----------------------------- */

function messageBoxStyle(marginTop = 12) {
  return {
    marginTop,
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    padding: 12,
    background: "rgba(0,0,0,0.12)",
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
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(0,0,0,0.12)",
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

const awardTrophyImg = {
  width: 42,
  height: 42,
  objectFit: "contain",
  display: "block",
}