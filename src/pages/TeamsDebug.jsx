// src/pages/TeamsDebug.jsx
import React, { useEffect, useState } from "react";
import { fetchSheetGviz } from "../utils/fetchGviz";

export default function TeamsDebug() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError("");

        const sheetId = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow";
        const gid = "2143242587";

        const { headers, data } = await fetchSheetGviz({ sheetId, gid });

        if (!alive) return;
        setHeaders(headers);
        setRows(data);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Failed");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui" }}>
      <h1>Teams Debug</h1>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {!loading && !error && (
        <>
          <h2>Headers</h2>
          <pre style={{ background: "#111", color: "#eee", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {JSON.stringify(headers, null, 2)}
          </pre>

          <h2>First 10 rows</h2>
          <pre style={{ background: "#111", color: "#eee", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {JSON.stringify(rows.slice(0, 10), null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}