// GNFC_ROTO_LEAGUE_SCOPING v2
// GNFC_ROTO_PAGE v1
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import ThemeToggle from "../theme/ThemeToggle"
import {
  ROTO_CSV_URL, ROTO_SHEET_URL, ROTO_STATS,
  parseRotoStandings, filterRotoTeams, sortRotoTeams, scopeRotoTeams,
} from "../utils/rotoData"
import "./RotoChampionshipPage.css"

const VIEWS = [
  { id: "standings", label: "Standings" },
  { id: "statistics", label: "Statistics" },
  { id: "rankings", label: "Category Rankings" },
]

const BASE_COLUMNS = [
  { key: "overallRank", label: "Overall", value: (row) => row.overallRank, numeric: true, sticky: "position" },
  { key: "team", label: "Team", value: (row) => row.team, sticky: "team" },
]

function columnsFor(view, selectedLeague) {
  const scoped = selectedLeague !== "all"
  const baseColumns = BASE_COLUMNS.map((column) => column.key === "overallRank"
    ? { ...column, label: scoped ? "Rank" : "Overall", value: (row) => scoped ? row.scopeRank : row.overallRank }
    : column)
  const league = { key: "league", label: "League", value: (row) => row.league }
  if (view === "standings") return [
    ...baseColumns,
    { key: "manager", label: "Manager", value: (row) => row.manager },
    league,
    { key: "rotoScore", label: "Roto Score", value: (row) => row.rotoScore, sortValue: (row) => row.rotoScoreValue ?? row.rotoScore, numeric: true, descending: true },
    ...(!scoped ? [{ key: "rotoRank", label: "Roto Rank", value: (row) => row.rotoRank, numeric: true }] : []),
    { key: "leaguePoints", label: "League Points", value: (row) => row.leaguePoints, numeric: true, descending: true },
    { key: "leagueRank", label: "League Rank", value: (row) => row.leagueRank, numeric: true },
  ]
  return [
    ...baseColumns, league,
    ...ROTO_STATS.map((stat) => ({
      key: `${view}:${stat}`, label: stat, numeric: true, descending: view === "statistics",
      value: (row) => view === "statistics" ? row.stats[stat] : row.categoryRanks[stat],
    })),
  ]
}

export default function RotoChampionshipPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [lastLoaded, setLastLoaded] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState({ key: "overallRank", direction: "asc" })
  const view = VIEWS.some((item) => item.id === params.get("view")) ? params.get("view") : "standings"
  const leagues = useMemo(() => [...new Set(teams.map((row) => row.league))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })), [teams])
  const requestedLeague = params.get("league") || "all"
  const league = leagues.includes(requestedLeague) ? requestedLeague : "all"

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError("")
      try {
        const response = await fetch(ROTO_CSV_URL, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error(`Could not load roto standings (${response.status}).`)
        const parsed = parseRotoStandings(await response.text())
        if (controller.signal.aborted) return
        setTeams(parsed)
        setLastLoaded(new Date())
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message || "Could not load the roto standings.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [refresh])

  const scopedTeams = useMemo(() => scopeRotoTeams(teams, league), [teams, league])
  const columns = useMemo(() => columnsFor(view, league), [view, league])
  const sortColumn = columns.find((column) => column.key === sort.key) || columns[0]
  const sortDirection = sortColumn.key === sort.key ? sort.direction : "asc"
  const visible = useMemo(() => sortRotoTeams(filterRotoTeams(scopedTeams, "all", query), sortColumn, sortDirection),
    [scopedTeams, query, sortColumn, sortDirection])

  function updateParam(key, value) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value === "all" || (key === "view" && value === "standings")) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
    setSort({ key: "overallRank", direction: "asc" })
  }

  function changeSort(column) {
    setSort((previous) => ({
      key: column.key,
      direction: previous.key === column.key
        ? previous.direction === "asc" ? "desc" : "asc"
        : column.descending ? "desc" : "asc",
    }))
  }

  const viewLabel = VIEWS.find((item) => item.id === view).label

  return (
    <div className="gnfc-roto-page">
      <div className="topbar">
        <div className="brand">
          <Link to="/" aria-label="Go to homepage" className="gnfc-roto-logo-link">
            <img src="/gnfc-logo.png" alt="GNFC Logo" />
          </Link>
          <div className="brand-title">
            <h1>Roto Championship</h1>
            <p>Overall standings and league statistics</p>
          </div>
          <div className="gnfc-header-actions">
            <ThemeToggle />
            <button type="button" className="badge" onClick={() => navigate(-1)}>Back</button>
            <Link to="/" className="badge">Home</Link>
          </div>
        </div>
      </div>

      <div className="container">
        <section className="card gnfc-roto-panel" aria-label="Roto Championship standings">
          <div className="gnfc-roto-toolbar">
            <div className="gnfc-roto-views" role="group" aria-label="Standings view">
              {VIEWS.map((item) => (
                <button key={item.id} type="button"
                  className={`gnfc-roto-view${view === item.id ? " is-active" : ""}`}
                  aria-pressed={view === item.id} onClick={() => updateParam("view", item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="gnfc-roto-filters">
              <label className="gnfc-roto-field">
                <span>League</span>
                <select aria-label="League" value={league} onChange={(event) => updateParam("league", event.target.value)}
                  disabled={!teams.length}>
                  <option value="all">All leagues</option>
                  {leagues.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="gnfc-roto-field gnfc-roto-search">
                <span>Search</span>
                <input type="search" aria-label="Search" placeholder="Team or manager" value={query}
                  onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
          </div>

          <div className="gnfc-roto-table-heading">
            <div>
              <h2>{league === "all" ? "Overall" : league} {viewLabel}</h2>
              <p>
                {league !== "all"
                  ? view === "standings"
                    ? `Roto Score and ranks compare the ${scopedTeams.length} teams in ${league}. League Points and League Rank follow the published league standings.`
                    : view === "rankings"
                      ? `Category ranks compare the ${scopedTeams.length} teams in ${league}. Equal values share a rank.`
                      : `Raw statistics for ${league}. Positions follow its recalculated Roto Score.`
                  : view === "rankings"
                    ? "Category ranks cover all teams."
                    : "Official overall positions follow the published standings."}
              </p>
            </div>
            <div className="gnfc-roto-refresh">
              <span aria-live="polite">{teams.length ? `${visible.length} of ${scopedTeams.length} teams` : ""}</span>
              <button type="button" className="badge" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {error && (
            <div className="gnfc-roto-error" role="alert">
              <strong>{error}</strong>
              {teams.length > 0 && <span>Showing the last successfully loaded standings.</span>}
              <button type="button" className="badge" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Try again</button>
            </div>
          )}

          {loading && !teams.length ? (
            <div className="gnfc-roto-empty" role="status">Loading roto standings…</div>
          ) : teams.length > 0 && (
            <div className="gnfc-roto-table-scroll" tabIndex={0} role="region" aria-label="Scrollable roto standings">
              <table className={`gnfc-roto-table gnfc-roto-table-${view}`} aria-busy={loading}>
                <caption className="gnfc-roto-visually-hidden">{viewLabel} for {league === "all" ? "all roto leagues" : league}.</caption>
                <thead>
                  <tr>{columns.map((column) => {
                    const active = sortColumn.key === column.key
                    return (
                      <th key={column.key} scope="col"
                        className={`${column.numeric ? "is-number " : ""}${column.sticky ? `gnfc-roto-sticky-${column.sticky}` : ""}`}
                        aria-sort={active ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                        <button type="button" onClick={() => changeSort(column)}>
                          {column.label}<span aria-hidden="true" className="gnfc-roto-sort">{active ? sortDirection === "asc" ? "▲" : "▼" : "↕"}</span>
                        </button>
                      </th>
                    )
                  })}</tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} data-overall-rank={row.overallRank}>
                      {columns.map((column) => {
                        const value = column.value(row)
                        return <td key={column.key}
                          className={`${column.numeric ? "is-number " : ""}${column.sticky ? `gnfc-roto-sticky-${column.sticky}` : ""}`}>
                          {column.key === "overallRank"
                            ? <span className={`gnfc-roto-rank${value !== "" && value <= 3 ? " is-leading" : ""}`}>{value === "" || value == null ? "—" : value}</span>
                            : column.key === "league" ? <span className="gnfc-roto-league-label">{value}</span>
                            : value == null || value === "" ? "—" : value}
                        </td>
                      })}
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr><td colSpan={columns.length} className="gnfc-roto-empty">
                      No teams match your search.
                      <button type="button" className="badge" onClick={() => { setQuery(""); updateParam("league", "all") }}>Clear filters</button>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="gnfc-roto-footer">
            <a href={ROTO_SHEET_URL} target="_blank" rel="noopener noreferrer">View spreadsheet</a>
            {lastLoaded && <span>Loaded {lastLoaded.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
        </section>
      </div>
    </div>
  )
}
