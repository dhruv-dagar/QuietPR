
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app, inspectDiff, inspectLogs } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
  }
});

test("health endpoint returns API status and model", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.status, "ok");
  assert.equal(data.service, "QuietPR API");
  assert.ok(data.model);
});

test("diff parser identifies changed files and line counts", () => {
  const diff = [
    "diff --git a/src/math.js b/src/math.js",
    "--- a/src/math.js",
    "+++ b/src/math.js",
    "@@ -1 +1 @@",
    "-  return a + b;",
    "+  return a - b;",
  ].join("\n");

  assert.deepEqual(inspectDiff(diff), {
    files: ["src/math.js"],
    additions: 1,
    deletions: 1,
  });
});

test("diff parser handles an empty diff", () => {
  assert.deepEqual(inspectDiff(""), {
    files: [],
    additions: 0,
    deletions: 0,
  });
});

test("log parser identifies test failures", () => {
  const logs = [
    "> npm test",
    "Tests: 1 failed, 4 passed",
    "AssertionError: expected 5, received -1",
  ].join("\n");

  const failures = inspectLogs(logs);

  assert.ok(failures.length >= 2);
  assert.ok(
    failures.some((item) =>
      item.text.includes("AssertionError")
    )
  );
});

test("analysis rejects empty input", async () => {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diff: "", logs: "" }),
  });

  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(
    data.error,
    "Provide a PR diff, CI logs, or both."
  );
});

test("analysis rejects non-string inputs", async () => {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diff: 123, logs: "" }),
  });

  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.error, "diff and logs must be strings.");
});

test("analysis returns evidence and AI report when Ollama responds", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/api/chat")) {
      const request = JSON.parse(options.body);

      
assert.equal(request.model, "qwen2.5-coder:3b");
assert.equal(request.stream, false);

const prompt = request.messages.find(
  (message) => message.role === "user"
)?.content;

assert.ok(prompt, "The model should receive a review prompt");

assert.match(
  prompt,
  /Prioritize regressions introduced by the diff/i
);


assert.match(
  prompt,
  /If recommending a code revert, do not recommend changing tests to accommodate the reverted behavior/i
);


assert.match(
  prompt,
  /If the intended behavior is unclear, state the uncertainty/i
);

assert.match(
  prompt,
  /Never invent files, test results, line numbers, requirements, or code snippets/i
);

assert.match(
  prompt,
  /Return only the five requested report sections/i
);


      return new Response(
        JSON.stringify({
          message: {
            content: "## Summary\nThe change introduces a regression.",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return originalFetch(url, options);
  };

  try {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        diff: [
          "diff --git a/src/math.js b/src/math.js",
          "--- a/src/math.js",
          "+++ b/src/math.js",
          "- return a + b;",
          "+ return a - b;",
        ].join("\n"),
        logs: "AssertionError: expected 5, received -1",
      }),
    });

    const data = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(data.evidence.changes.files, [
      "src/math.js",
    ]);
    assert.equal(data.evidence.changes.additions, 1);
    assert.equal(data.evidence.changes.deletions, 1);
    assert.ok(data.evidence.failures.length > 0);
    assert.match(data.aiAnalysis, /regression/i);
    assert.equal(data.aiError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis returns evidence when Ollama is unavailable", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/api/chat")) {
      throw new Error("Ollama connection refused");
    }

    return originalFetch(url, options);
  };

  try {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        diff: "diff --git a/a.js b/a.js\n-old()\n+new()",
        logs: "Tests failed",
      }),
    });

    const data = await response.json();

    assert.equal(response.status, 200);
    assert.ok(data.evidence);
    assert.equal(data.aiAnalysis, null);
    assert.match(data.aiError, /Ollama is running/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis handles an empty Ollama response", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/api/chat")) {
      return new Response(
        JSON.stringify({ message: { content: "   " } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return originalFetch(url, options);
  };

  try {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diff: "some change", logs: "" }),
    });

    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.aiAnalysis, null);
    assert.ok(data.aiError);
    assert.ok(data.evidence);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("analysis rejects malformed JSON with a clean error", async () => {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"diff": ',
  });

  const data = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(data, {
    error: "Invalid JSON request body.",
  });
});

test("diff parser handles multiple changed files", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "-oldA()",
    "+newA()",
    "diff --git a/src/b.js b/src/b.js",
    "--- a/src/b.js",
    "+++ b/src/b.js",
    "-oldB()",
    "+newB()",
  ].join("\n");

  assert.deepEqual(inspectDiff(diff), {
    files: ["src/a.js", "src/b.js"],
    additions: 2,
    deletions: 2,
  });
});

test("diff parser ignores file headers when counting changes", () => {
  const diff = [
    "diff --git a/src/a.js b/src/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,2 +1,2 @@",
    "-const oldValue = 1;",
    "+const newValue = 2;",
  ].join("\n");

  const result = inspectDiff(diff);

  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
  assert.deepEqual(result.files, ["src/a.js"]);
});

test("API rejects request bodies larger than 2 MB", async () => {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      diff: "x".repeat(2 * 1024 * 1024 + 100),
      logs: "",
    }),
  });

  const data = await response.json();

  assert.equal(response.status, 413);
  assert.deepEqual(data, {
    error: "Request body is too large. Maximum size is 2 MB.",
  });
});
