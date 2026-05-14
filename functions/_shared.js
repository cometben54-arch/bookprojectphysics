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

// Unified completion call across providers. Returns { content, raw }.
export async function aiComplete({ provider, system, user, max_tokens, temperature }) {
  if (!provider) throw new Error("未指定提供商");
  const base = (provider.base || "").replace(/\/+$/, "");
  const max = max_tokens || provider.max || 4096;
  const temp = temperature ?? provider.temp ?? 0.5;

  if (provider.type === "openai") {
    const r = await fetch(base + "/chat/completions", {
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
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(
        "OpenAI 错误：" + (j.error?.message || JSON.stringify(j) || r.status)
      );
    const content =
      j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text ?? "";
    return { content, raw: j };
  }

  if (provider.type === "anthropic") {
    const r = await fetch(base + "/messages", {
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
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(
        "Anthropic 错误：" + (j.error?.message || JSON.stringify(j) || r.status)
      );
    const content = (j.content || [])
      .map((b) => b.text || "")
      .join("");
    return { content, raw: j };
  }

  if (provider.type === "gemini") {
    const url =
      base +
      "/models/" +
      encodeURIComponent(provider.model) +
      ":generateContent?key=" +
      encodeURIComponent(provider.key || "");
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: temp, maxOutputTokens: max },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(
        "Gemini 错误：" + (j.error?.message || JSON.stringify(j) || r.status)
      );
    const content = (j.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");
    return { content, raw: j };
  }

  throw new Error("未知提供商类型: " + provider.type);
}
