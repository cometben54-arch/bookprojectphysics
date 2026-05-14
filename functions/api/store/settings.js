import {
  json,
  error,
  authorize,
  loadGlobalSettings,
  saveGlobalSettings,
} from "../../_shared.js";

// GET  /api/store/settings  -> returns global AI/provider settings (without keys)
// PUT  /api/store/settings  -> overwrite global settings (requires shareToken if one is set)
//
// Special bootstrap behaviour: if no settings have ever been saved (no
// shareToken on file), the first PUT is accepted and seeds the token.

export const onRequestGet = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  // Return settings INCLUDING API keys. This request is already gated by
  // the share token (or the deploy is open/single-user), so the caller is
  // authorised — and it is the same client that originally entered the key.
  // Stripping keys here previously caused the browser to overwrite its
  // local copy with keyless data and "lose" the key. The share token IS
  // the credential; anyone holding it can already use the providers.
  return json(auth.settings);
};

export const onRequestPut = async ({ request, env }) => {
  const existing = await loadGlobalSettings(env);
  const isBootstrap = !existing.shareToken;
  if (!isBootstrap) {
    const auth = await authorize(request, env);
    if (!auth.ok) return error(auth.error, auth.status);
  }
  let incoming;
  try {
    incoming = await request.json();
  } catch {
    return error("非法 JSON");
  }
  // Merge: keep existing API keys if the incoming one is blank (allows
  // editing config in the UI without retyping keys every time).
  const merged = { ...existing, ...incoming };
  const oldByName = Object.fromEntries(
    (existing.providers || []).map((p) => [p.name, p])
  );
  merged.providers = (incoming.providers || []).map((p) => {
    if (!p.key && oldByName[p.name]) p.key = oldByName[p.name].key;
    return p;
  });
  await saveGlobalSettings(env, merged);
  return json({ ok: true });
};
