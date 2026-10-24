import { useState } from "react";
import "./App.css";
import ReactMarkdown from "react-markdown";

const SAMPLE_DIFF = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1,3 +1,3 @@
 export function add(a, b) {
-  return a + b;
+  return a - b;
 }`;

const SAMPLE_LOGS = `> npm test
FAIL tests/math.test.js
AssertionError: expected 5, received -1
Tests: 1 failed, 4 passed
Process exited with code 1`;

export default function App() {
  const [diff, setDiff] = useState("");
  const [logs, setLogs] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function analyze(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("http://localhost:3001/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, logs }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed");
      setResult(data);
    } catch (err) {
      setError(`${err.message}. Check that the QuietPR backend is running.`);
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setDiff(SAMPLE_DIFF);
    setLogs(SAMPLE_LOGS);
    setResult(null);
    setError("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">Q</span> QuietPR
        </a>
        <span className="local-badge"><span className="dot" /> Local-first review</span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR PR REVIEW, SIMPLIFIED</p>
        <h1>Ship with clarity.<br />Not more tabs.</h1>
        <p className="subtitle">
          Understand code changes, investigate CI failures, and prepare a
          practical review checklist — without the mental overhead.
        </p>
      </section>

      <form className="workspace" onSubmit={analyze}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / INPUT</p>
            <h2>Bring your pull request</h2>
          </div>
          <button type="button" className="secondary" onClick={loadSample}>
            Load demo
          </button>
        </div>

        <label htmlFor="diff">Pull request diff</label>
        <textarea
          id="diff"
          value={diff}
          onChange={(e) => setDiff(e.target.value)}
          placeholder="Paste a unified Git diff here..."
          rows={9}
        />

        <label htmlFor="logs">CI and test logs</label>
        <textarea
          id="logs"
          value={logs}
          onChange={(e) => setLogs(e.target.value)}
          placeholder="Paste test output, stack traces, or CI logs..."
          rows={6}
        />

        <div className="form-footer">
          <p>Start with a diff, logs, or both.</p>
          <button disabled={loading || (!diff.trim() && !logs.trim())}>
            {loading ? "Analyzing..." : "Analyze pull request →"}
          </button>
        </div>
      </form>

      {error && <div className="notice error">{error}</div>}

      {result && (
        <section className="results">
          <p className="eyebrow">02 / FINDINGS</p>
          <h2>Review report</h2>

          <div className="stats">
            <div className="stat"><span>Changed files</span><strong>{result.evidence.changes.files.length}</strong></div>
            <div className="stat"><span>Lines added</span><strong>{result.evidence.changes.additions}</strong></div>
            <div className="stat"><span>Lines removed</span><strong>{result.evidence.changes.deletions}</strong></div>
            <div className="stat"><span>Log candidates</span><strong>{result.evidence.failures.length}</strong></div>
          </div>

          <div className="panel">
            <h3>Changed files</h3>
            {result.evidence.changes.files.length ? (
              <ul>{result.evidence.changes.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
            ) : <p>No changed file paths detected.</p>}
          </div>

          <div className="panel">
            <h3>Potential CI/test failure lines</h3>
            {result.evidence.failures.length ? (
              <ul className="failure-list">
                {result.evidence.failures.map((item) => (
                  <li key={`${item.line}-${item.text}`}>
                    <code>Line {item.line}</code> {item.text}
                  </li>
                ))}
              </ul>
            ) : <p>No matching failure patterns found. This does not prove the tests passed.</p>}
          </div>

          <div className="panel ai-panel">
            <h3>AI review</h3>
            {result.aiAnalysis ? (
  <div className="markdown-report">
    <ReactMarkdown>{result.aiAnalysis}</ReactMarkdown>
  </div>
) : (
  <p>{result.aiError || "AI analysis is not connected yet."}</p>
)}
          </div>

          <p className="disclaimer">
            AI findings are suggestions, not proof. Verify the code and run
            the tests before making a merge decision.
          </p>
        </section>
      )}

      <footer className="page-footer">
        QuietPR · Open-source AI · Human-reviewed decisions
      </footer>
    </main>
  );
}
