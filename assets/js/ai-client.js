// Thin browser-side client that talks to /api/ai/* server proxy.
// The proxy is what actually calls OpenAI / Anthropic / Gemini with the
// stored API key. The browser never sees the key.

(function (global) {
  async function call(endpoint, body, opts = {}) {
    const settings = global.BPPX.storage.loadSettings();
    const timeoutMs = (opts.timeout || settings.timeout || 120) * 1000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const r = await fetch("/api/ai/" + endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.shareToken
            ? { "x-share-token": settings.shareToken }
            : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await r.text();
      if (!r.ok) {
        try {
          const j = JSON.parse(text);
          throw new Error(j.error || text || ("HTTP " + r.status));
        } catch {
          throw new Error(text || "HTTP " + r.status);
        }
      }
      try {
        return JSON.parse(text);
      } catch {
        return { content: text };
      }
    } finally {
      clearTimeout(t);
    }
  }

  // High-level helpers
  async function generate({ provider, system, user, max_tokens, temperature }) {
    return call("generate", {
      provider,
      system,
      user,
      max_tokens,
      temperature,
    });
  }
  async function parseRef({ provider, kind, payload }) {
    return call("parse", { provider, kind, payload });
  }
  async function proofread({ provider, system, latex, targets }) {
    return call("proofread", { provider, system, latex, targets });
  }
  async function testProvider(provider) {
    return call("test", { provider });
  }

  global.BPPX = global.BPPX || {};
  global.BPPX.ai = { generate, parseRef, proofread, testProvider };
})(window);
