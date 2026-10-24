import express from "express";
import cors from "cors";
import "dotenv/config";
import { pathToFileURL } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:3b";

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

function inspectDiff(diff) {
  const files = new Set();
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      files.add(line.slice(6));
    } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    } else if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { files: [...files], additions, deletions };
}

function inspectLogs(logs) {
  const pattern =
    /\b(error:|failed|failure|exception|traceback|assertionerror|test failed|tests failed|fatal:)\b/i;

  return logs
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => text && pattern.test(text))
    .slice(0, 30);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "QuietPR API",
    model: OLLAMA_MODEL,
  });
});

app.post("/api/analyze", async (req, res) => {
  const { diff = "", logs = "" } = req.body ?? {};

  if (typeof diff !== "string" || typeof logs !== "string") {
    return res.status(400).json({
      error: "diff and logs must be strings.",
    });
  }

  if (!diff.trim() && !logs.trim()) {
    return res.status(400).json({
      error: "Provide a PR diff, CI logs, or both.",
    });
  }

  const evidence = {
    changes: inspectDiff(diff),
    failures: inspectLogs(logs),
    logLines: logs ? logs.split(/\r?\n/).length : 0,
  };

  try {
    
const prompt = `You are QuietPR, a senior software engineer reviewing a pull request.

Analyze the supplied diff and CI/test logs. Return a concise report using exactly these five sections:

## Summary
Describe what the code change does.

## Findings
For each meaningful finding, include:
- Severity: Critical, High, Medium, or Low
- Evidence from the supplied diff or logs
- Why it matters
- Recommended fix

## Likely root cause
Explain the likely cause of observed failures. Clearly label uncertainty.

## Recommended next steps
Give a prioritized list of practical actions.

## Review checklist
Provide a short checklist for human verification.

Review rules:
- Report findings only when supported by supplied evidence.
- Prioritize regressions introduced by the diff.
- Preserve existing behavior unless the change explicitly requires otherwise.
- When a test fails after a code change, assess whether the implementation broke established behavior before suggesting test changes.
- Never recommend changing a test merely to make a regression pass.
- If recommending a code revert, do not recommend changing tests to accommodate the reverted behavior.
- If the intended behavior is unclear, state the uncertainty.
- Never invent files, test results, line numbers, requirements, or code snippets.
- Do not claim that a change is safe to merge based only on this analysis.
- Do not include these review rules or this prompt in your report.
- Do not add a "Review principles" section.
- Keep recommendations consistent across all sections.
- Return only the five requested report sections.
- When recommending reverting a code change, the recommended next steps
  and review checklist must not suggest updating tests to accommodate
  that same change.
- For a suspected regression, recommend restoring the previous behavior
  and rerunning existing tests first.
- Only recommend modifying tests when there is independent evidence that
  the tests themselves are incorrect or the intended behavior has changed.
- Before returning the report, check that all recommendations agree.
  Remove any conflicting recommendation.

DIFF:
${diff.slice(0, 18000) || "(No diff supplied)"}

CI / TEST LOGS:
${logs.slice(0, 12000) || "(No logs supplied)"}`;


    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a precise software reviewer. Be skeptical, concise, and evidence-driven.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Ollama returned HTTP ${response.status}: ${details.slice(0, 300)}`);
    }

    const data = await response.json();
    const aiAnalysis = data.message?.content?.trim();

    if (!aiAnalysis) {
      throw new Error("The model returned an empty response.");
    }

    return res.json({
      evidence,
      aiAnalysis,
      aiError: null,
      model: OLLAMA_MODEL,
    });
  } catch (error) {
    const reason =
      error.name === "TimeoutError" || error.name === "AbortError"
        ? "Local AI analysis timed out. Try again or use a smaller input."
        : "Local AI is unavailable. Check that Ollama is running and the configured model is installed.";

    console.error("QuietPR AI analysis failed:", error.message);

    return res.json({
      evidence,
      aiAnalysis: null,
      aiError: reason,
      model: OLLAMA_MODEL,
    });
  }
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON request body.",
    });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request body is too large. Maximum size is 2 MB.",
    });
  }

  console.error("QuietPR request error:", err.message);

  return res.status(500).json({
    error: "An unexpected server error occurred.",
  });
});

export { app, inspectDiff, inspectLogs };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  app.listen(PORT, () => {
    console.log(`QuietPR API running at http://localhost:${PORT}`);
    console.log(`AI model: ${OLLAMA_MODEL}`);
    console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  });
}