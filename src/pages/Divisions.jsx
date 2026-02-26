import React, { useEffect, useMemo, useState } from "react";
import { fetchSheetGviz } from "../utils/fetchGviz";

function toNum(x) {
  const s = String(x ?? "").replace(/[%,$]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Extracts "A" / "B" / "Γ" from league like "A1", "B2", "Γ3"
function divisionFromLeague(leagueRaw) {
  const league = String(leagueRaw ?? "").trim().toUpperCase();
  if (!league) return "Unknown";

  // Support Greek Gamma OR Latin G as Gamma fallback
  if (league.startsWith("A")) return "A";
  if (league.startsWith("B")) return "B";
  if (league.startsWith("Γ") || league.startsWith("G")) return "Γ";

  return "Unknown";
}

// Sort leagues like A1, A2, A10 properly
function leagueSortKey(leagueRaw) {
  const league = String(leagueRaw ?? "").trim().toUpperCase();
  const div = divisionFromLeague(league);
  const numMatch = league.match(/(\d+)/);
  const num = numMatch ? Number(numMatch[1]) : 9999;

  const divOrder = div === "A" ? 1 : div === "B" ? 2 : div === "Γ" ? 3 : 9;
  return { divOrder, num, league };
}

export default function Divisions() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const sheetId = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow";
        const gid = "2143242587";

        const { data } = await fetchSheetGviz({ sheetId, gid });

        const normalized = data
          .map((r) => {
            const team = String(r["Team"] ?? "").trim();
            if (!team) return null;

            const manager = String(r["Manager"] ?? "").trim();
            const league = String(r["League"] ?? "").trim() || "Unassigned";
            const division = divisionFromLeague(league);

            return {
              team,
              manager,
              league,
              division,
              leagueRanking: r["League Ranking"] ?? "",
              generalStanding: r["General Standing"] ?? "",
              gp: toNum(r["GP"]),
              pointsTotal: r["Total"] ?? "",
              stats: {
                "FG%": r["GENERAL STATISTICS FG%"] ?? r["FG%"] ?? "",
                "3P": r["3P"] ?? "",
                "FT%": r["FT%"] ?? "",
                "PTS": r["PTS"] ?? "",
                "REB": r["REB"] ?? "",
                "AST": r["AST"] ?? "",
                "ST": r["ST"] ?? "",
                "BLK": r["BLK"] ?? "",
                "TO": r["TO"] ?? "",
              },
              raw: r,
            };
          })
          .filter(Boolean);

        if (!alive) return;
        setTeams(normalized);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Failed to load sheet");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    // division -> league -> teams[]
    const out = { A: {}, B: {}, Γ: {}, Unknown: {} };

    for (const t of teams) {
      const div = t.division || "Unknown";
      const lg = t.league || "Unassigned";
      out[div] ||= {};
      out[div][lg] ||= [];
      out[div][lg].push(t);
    }

    // sort teams inside each league by League Ranking (if numeric), else team name
    for (const div of Object.keys(out)) {
      for (const lg of Object.keys(out[div])) {
        out[div][lg].sort((a, b) => {
          const ar = toNum(a.leagueRanking);
          const br = toNum(b.leagueRanking);
          if (ar == null && br == null) return a.team.localeCompare(b.team);
          if (ar == null) return 1;
          if (br == null) return -1;
          return ar - br;
        });
      }
    }

    return out;
  }, [teams]);

  const divisionOrder = ["A", "B", "Γ"];

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />
          <div className="brand-title">
            <h1>The Greek NBA Fantasy Championship</h1>
            <p>Divisions • Leagues • Teams</p>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && <div className="notice">Loading…</div>}
        {error && <div className="notice">Error: {error}</div>}

        {!loading && !error && (
          <>
            {divisionOrder.map((div) => {
              const leaguesObj = grouped[div] || {};
              const leagues = Object.keys(leaguesObj).sort((a, b) => {
                const ka = leagueSortKey(a);
                const kb = leagueSortKey(b);
                if (ka.divOrder !== kb.divOrder) return ka.divOrder - kb.divOrder;
                if (ka.num !== kb.num) return ka.num - kb.num;
                return ka.league.localeCompare(kb.league);
              });

              return (
                <div key={div} style={{ marginTop: 18 }}>
                  <div className="sectionTitle">
                    <span className="badge">Division {div}</span>
                    <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                      {leagues.reduce((sum, lg) => sum + (leaguesObj[lg]?.length || 0), 0)} teams
                    </span>
                  </div>

                  {leagues.map((league) => {
                    const list = leaguesObj[league] || [];
                    return (
                      <div key={league} style={{ marginTop: 12 }}>
                        <div className="sectionTitle" style={{ marginTop: 10 }}>
                          <span className="badge">{league}</span>
                          <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                            {list.length} teams
                          </span>
                        </div>

                        <div className="grid">
                          {list.map((t) => (
                            <div key={t.team} className="card">
                              <div className="cardTop">
                                <div>
                                  <div className="teamName">{t.team}</div>
                                  <div className="manager">{t.manager || "—"}</div>
                                </div>
                                <span className="badge">Rank {t.leagueRanking || "—"}</span>
                              </div>

                              <div className="kv">
                                <div>
                                  <strong>General Standing</strong>
                                  <div>{t.generalStanding || "—"}</div>
                                </div>
                                <div>
                                  <strong>Games Played</strong>
                                  <div>{t.gp ?? "—"}</div>
                                </div>
                                <div>
                                  <strong>Total</strong>
                                  <div>{t.pointsTotal || "—"}</div>
                                </div>
                                <div>
                                  <strong>Turnovers</strong>
                                  <div>{t.stats["TO"] || "—"}</div>
                                </div>
                              </div>

                              <div className="statsLine">
                                <strong style={{ color: "var(--gnfc-text)" }}>Stats:</strong>{" "}
                                {Object.entries(t.stats)
                                  .map(([k, v]) => `${k} ${v || "-"}`)
                                  .join(" · ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}