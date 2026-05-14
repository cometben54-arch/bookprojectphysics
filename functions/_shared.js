// Shared helpers for all Pages Functions.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const error = (msg, status = 400) => json({ error: msg }, status);

// KV-or-fallback helpers. If BOOK_KV is not bound (e.g. local dev w/o KV),
// degrade to in-memory globalThis cache so the dev experience still works.
const memKV = (globalThis.__BPPX_MEM_KV ??= new Map());

export function kvGet(env, key) {
  if (env && env.BOOK_KV) return env.BOOK_KV.get(key, "json");
  return Promise.resolve(memKV.get(key) ?? null);
}
export function kvPut(env, key, value) {
  if (env && env.BOOK_KV)
    return env.BOOK_KV.put(key, JSON.stringify(value));
  memKV.set(key, value);
  return Promise.resolve();
}
export function kvDel(env, key) {
  if (env && env.BOOK_KV) return env.BOOK_KV.delete(key);
  memKV.delete(key);
  return Promise.resolve();
}

// Binary KV helpers (for images). Stores raw bytes + metadata.
export async function kvPutBytes(env, key, bytes, metadata) {
  if (env && env.BOOK_KV)
    return env.BOOK_KV.put(key, bytes, { metadata });
  memKV.set(key, { bytes, metadata });
  return Promise.resolve();
}
export async function kvGetBytes(env, key) {
  if (env && env.BOOK_KV) {
    const r = await env.BOOK_KV.getWithMetadata(key, { type: "arrayBuffer" });
    if (!r || !r.value) return null;
    return { bytes: r.value, metadata: r.metadata || {} };
  }
  return memKV.get(key) || null;
}
export async function kvList(env, prefix) {
  if (env && env.BOOK_KV) {
    const r = await env.BOOK_KV.list({ prefix });
    return r.keys.map((k) => ({ name: k.name, metadata: k.metadata || {} }));
  }
  const out = [];
  for (const [k, v] of memKV.entries()) {
    if (k.startsWith(prefix))
      out.push({ name: k, metadata: (v && v.metadata) || {} });
  }
  return out;
}

const SETTINGS_KEY = "global:settings";

export async function loadGlobalSettings(env) {
  return (await kvGet(env, SETTINGS_KEY)) || { providers: [] };
}
export async function saveGlobalSettings(env, settings) {
  return kvPut(env, SETTINGS_KEY, settings);
}

// Authorize a request against the configured shareToken (if any).
// If no token has ever been set, the API is open (single-tenant deploys).
export async function authorize(request, env) {
  const settings = await loadGlobalSettings(env);
  if (!settings.shareToken) return { ok: true, settings };
  const got = request.headers.get("x-share-token") || "";
  if (got !== settings.shareToken)
    return { ok: false, settings, status: 401, error: "无效的共享 Token" };
  return { ok: true, settings };
}

export function findProvider(settings, name) {
  return (settings.providers || []).find((p) => p.name === name);
}

// Read a fetch Response, returning { ok, status, json, text }. Never throws.
async function readResponse(r) {
  const text = await r.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, statusText: r.statusText, json, text };
}

// Build a detailed error string so the UI shows the real cause instead of "{}".
function describeHttpError(label, res) {
  const j = res.json;
  let detail =
    (j && (j.error?.message || (typeof j.error === "string" && j.error))) ||
    "";
  if (!detail) {
    const raw = (res.text || "").trim();
    detail = raw
      ? raw.slice(0, 400)
      : "（响应体为空 — 通常是 URL 路径错误或网络拦截）";
  }
  return `${label} ${res.status} ${res.statusText || ""}: ${detail}`.trim();
}

// Normalise a Gemini base URL. The API needs a version segment (/v1beta or
// /v1); users frequently paste just the host, which 404s with an empty body.
function geminiBase(base) {
  const b = (base || "https://generativelanguage.googleapis.com").replace(
    /\/+$/,
    ""
  );
  if (/\/v1(beta)?$/.test(b)) return b;
  return b + "/v1beta";
}

// Unified completion call across providers. Returns { content, raw }.
export async function aiComplete({ provider, system, user, max_tokens, temperature }) {
  if (!provider) throw new Error("未指定提供商");
  const base = (provider.base || "").replace(/\/+$/, "");
  const max = max_tokens || provider.max || 4096;
  const temp = temperature ?? provider.temp ?? 0.5;

  if (provider.type === "openai") {
    let r;
    try {
      r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + (provider.key || ""),
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: temp,
          max_tokens: max,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: user },
          ],
        }),
      });
    } catch (e) {
      throw new Error("OpenAI 网络错误：" + (e.message || e) + "（检查 Base URL）");
    }
    const res = await readResponse(r);
    if (!res.ok) throw new Error(describeHttpError("OpenAI", res));
    const j = res.json || {};
    const content =
      j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text ?? "";
    return { content, raw: j };
  }

  if (provider.type === "anthropic") {
    let r;
    try {
      r = await fetch(base + "/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": provider.key || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: max,
          temperature: temp,
          system: system || undefined,
          messages: [{ role: "user", content: user }],
        }),
      });
    } catch (e) {
      throw new Error(
        "Anthropic 网络错误：" + (e.message || e) + "（检查 Base URL）"
      );
    }
    const res = await readResponse(r);
    if (!res.ok) throw new Error(describeHttpError("Anthropic", res));
    const j = res.json || {};
    const content = (j.content || []).map((b) => b.text || "").join("");
    return { content, raw: j };
  }

  if (provider.type === "gemini") {
    const url =
      geminiBase(provider.base) +
      "/models/" +
      encodeURIComponent(provider.model) +
      ":generateContent?key=" +
      encodeURIComponent(provider.key || "");
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: system
            ? { parts: [{ text: system }] }
            : undefined,
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: temp, maxOutputTokens: max },
        }),
      });
    } catch (e) {
      throw new Error(
        "Gemini 网络错误：" + (e.message || e) + "（检查 Base URL）"
      );
    }
    const res = await readResponse(r);
    if (!res.ok) throw new Error(describeHttpError("Gemini", res));
    const j = res.json || {};
    // A 200 can still carry a blocked / empty candidate — surface that too.
    if (j.promptFeedback?.blockReason) {
      throw new Error(
        "Gemini 内容被拦截：" + j.promptFeedback.blockReason
      );
    }
    const content = (j.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");
    if (!content && j.candidates?.[0]?.finishReason) {
      throw new Error(
        "Gemini 未返回文本（finishReason=" +
          j.candidates[0].finishReason +
          "）"
      );
    }
    return { content, raw: j };
  }

  throw new Error("未知提供商类型: " + provider.type);
}

export { readResponse, describeHttpError, geminiBase };

