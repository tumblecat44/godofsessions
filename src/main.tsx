import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./theme.css";

interface ErrorBoundaryState {
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const ko = document.documentElement.lang === "ko";
    return (
      <main className="startup-state" style={{ display: "grid", placeItems: "center", height: "100dvh", textAlign: "center", padding: 32, background: "#090d13", color: "#f2eddf" }}>
        <div>
          <p style={{ fontSize: 18, marginBottom: 12 }}>{ko ? "화면을 표시하지 못했어요." : "The screen could not render."}</p>
          <small style={{ opacity: 0.7, display: "block", marginBottom: 24 }}>{ko ? "새로고침하거나 언어를 English로 초기화해 보세요." : "Refresh or reset language to English."}</small>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("morrow-language-reset", "en");
              } catch { /* ignore */ }
              window.location.reload();
            }}
            style={{ padding: "10px 20px", background: "#eab04f", color: "#17120a", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
          >
            {ko ? "English로 초기화" : "Reset to English"}
          </button>
        </div>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
