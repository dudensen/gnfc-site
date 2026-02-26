import { useEffect, useState } from "react";
import { fetchSheetGviz } from "../utils/fetchGviz";

function toNum(x) {
  const s = String(x ?? "").replace(/[%,$]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function divisionFromLeague(leagueRaw) {
  const league = String(leagueRaw ?? "").trim().toUpperCase();
  if (!league) return "Unknown";
  if (league.startsWith("A")) return "A";
  if (league.startsWith("B")) return "B";
  if (league.startsWith("Γ") || league.startsWith("G")) return "Γ"; // support Gamma or G
  return "Unknown";
}

export function useTeams() {
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

  return { loading, error, teams };
}