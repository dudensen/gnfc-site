import React, { useEffect, useMemo, useState } from "react";
import { fetchSheetGviz } from "../utils/fetchGviz";

function toNum(x) {
  const s = String(x ?? "").replace(/[%,$]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function Teams() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const sheetId = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow";
        const gid = "2143242587";

        const { data } = await fetchSheetGviz({ sheetId, gid });

        const teams = data
          .map((r) => {
            const team = String(r["Team"] ?? "").trim();
            const manager = String(r["Manager"] ?? "").trim();
            const league = String(r["League"] ?? "").trim();
            if (!team) return null;

            return {
              team,
              manager,
              league: league || "Unassigned",
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
        setRows(teams);
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

  const byLeague = useMemo(() => {
    const out = {};
    for (const t of rows) {
      out[t.league] ||= [];
      out[t.league].push(t);
    }
    for (const lg of Object.keys(out)) {
      out[lg].sort((a, b) => {
        const ar = toNum(a.leagueRanking);
        const br = toNum(b.leagueRanking);
        if (ar == null && br == null) return a.team.localeCompare(b.team);
        if (ar == null) return 1;
        if (br == null) return -1;
        return ar - br;
      });
    }
    return out;
  }, [rows]);

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />
          <div className="brand-title">
            <h1>The Greek NBA Fantasy Championship</h1>
            <p>Teams • Managers • Leagues</p>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && <div className="notice">Loading…</div>}
        {error && <div className="notice">Error: {error}</div>}

        {!loading &&
          !error &&
          Object.entries(byLeague).map(([league, teams]) => (
            <div key={league}>
              <div className="sectionTitle">
                <span className="badge">{league}</span>
                <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                  {teams.length} teams
                </span>
              </div>

              <div className="grid">
                {teams.map((t) => (
                  <div key={t.team} className="card">
                    <div className="cardTop">
                      <div>
                        <div className="teamName">{t.team}</div>
                        <div className="manager">{t.manager || "—"}</div>
                      </div>

                      <span className="badge">
                        Rank {t.leagueRanking || "—"}
                      </span>
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
          ))}
      </div>
    </>
  );
}