import { useEffect, useState } from "react";
import Login from "./Login.jsx";
import POS from "./POS.jsx";
import { setAuthToken, onServerWakeupNeeded, API_BASE_URL } from "./api.js";
import axios from "axios";

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = sessionStorage.getItem("pos-session");
    if (saved) {
      const parsed = JSON.parse(saved);
      setAuthToken(parsed.token);
      return parsed;
    }
    return null;
  });

  const [wakingUp, setWakingUp] = useState(false);

  useEffect(() => {
    setAuthToken(session?.token);
    if (session) {
      sessionStorage.setItem("pos-session", JSON.stringify(session));
    } else {
      sessionStorage.removeItem("pos-session");
    }
  }, [session]);

  useEffect(() => {
    const unsubscribe = onServerWakeupNeeded(() => {
      setWakingUp(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!wakingUp) return;
    let timer;
    const checkServer = async () => {
      try {
        await axios.get(`${API_BASE_URL}/health`, { timeout: 3000 });
        setWakingUp(false);
        window.location.reload();
      } catch (_) {
        timer = setTimeout(checkServer, 2500);
      }
    };
    checkServer();
    return () => clearTimeout(timer);
  }, [wakingUp]);

  return (
    <>
      {!session ? (
        <Login onLogin={setSession} />
      ) : (
        <POS session={session} onLogout={() => setSession(null)} />
      )}

      {wakingUp && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15, 23, 42, 0.94)",
          backdropFilter: "blur(6px)",
          zIndex: 99999,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          color: "#e2e8f0", fontFamily: "sans-serif",
          padding: "20px", textAlign: "center"
        }}>
          <div style={{
            background: "#1e293b", border: "1px solid #334155",
            borderRadius: "12px", padding: "32px", maxWidth: "420px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)"
          }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>⚡</div>
            <h3 style={{ margin: "0 0 10px", fontSize: "18px", color: "#38bdf8" }}>Server & Database Waking Up</h3>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: "1.5", margin: "0 0 20px" }}>
              Render & Neon PostgreSQL are waking up from sleep mode after inactivity. Please wait a few seconds while your session connects...
            </p>
            <div style={{ display: "inline-block", padding: "6px 16px", background: "#0f172a", borderRadius: "20px", fontSize: "12px", color: "#22c55e", border: "1px solid #22c55e" }}>
              ● Reconnecting...
            </div>
          </div>
        </div>
      )}
    </>
  );
}
