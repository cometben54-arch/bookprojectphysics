import {
  json,
  error,
  authorize,
  findProvider,
  aiComplete,
} from "../../_shared.js";

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);

  const body = await request.json().catch(() => ({}));
  const provider = findProvider(auth.settings, body.provider);
  if (!provider)
    return json({ ok: false, error: "未保存或未找到该提供商: " + body.provider });

  try {
    const r = await aiComplete({
      provider,
      system: "Reply with only the word: pong",
      user: "ping",
      max_tokens: 16,
      temperature: 0,
    });
    return json({ ok: true, sample: (r.content || "").slice(0, 80) });
  } catch (e) {
    return json({ ok: false, error: e.message });
  }
};
