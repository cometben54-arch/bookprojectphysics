import {
  json,
  error,
  authorize,
  findProvider,
  describeMissingProvider,
  aiComplete,
} from "../../_shared.js";

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return error("请求体不是合法 JSON");
  }
  const provider = findProvider(auth.settings, body.provider);
  if (!provider)
    return error(describeMissingProvider(auth.settings, body.provider, env), 400);

  try {
    const r = await aiComplete({
      provider,
      system: body.system || "",
      user: body.user || "",
      max_tokens: Number(body.max_tokens) || 0,
      temperature: Number(body.temperature) || provider.temp,
    });
    return json({ content: r.content });
  } catch (e) {
    return error(e.message || String(e), 502);
  }
};
