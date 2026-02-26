// src/pages/Home.jsx
import React from "react";
import { Link } from "react-router-dom";

function DivisionButton({ to, title, subtitle }) {
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
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.3 }}>
          {title}
        </div>

        <div style={{ marginTop: 10, color: "var(--gnfc-muted)", fontSize: 14 }}>
          {subtitle}
        </div>

        <div style={{ marginTop: 18 }}>
          <span className="badge">Enter</span>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />
          <div className="brand-title">
            <h1>The Greek NBA Fantasy Championship</h1>
            <p>Choose a division</p>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="divisionGrid">
          <DivisionButton
            to="/division/A"
            title="Division A"
            subtitle="Οι 'Καλοί' μας — leagues A1, A2, A3…"
          />
          <DivisionButton
            to="/division/B"
            title="Division B"
            subtitle="Οι 'Έλα μωρέ καλοί είμαστε αλλά δεν το παρακάνουμε κιόλλας' — leagues B1, B2, B3…"
          />
          <DivisionButton
            to="/division/Γ"
            title="Division Γ"
            subtitle="Οι 'Ωωωω τι ψαγμενιές ειναι αυτές ρε; Καλή φάση' — leagues Γ1, Γ2…"
          />
        </div>
      </div>
    </>
  );
}