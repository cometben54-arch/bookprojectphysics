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
      // Generous budget: Gemini 2.5 / other "thinking" models spend tokens
      // on internal reasoning first, so a tiny cap (e.g. 16) yields
      // finishReason=MAX_TOKENS with no visible text.
      max_tokens: 512,
      temperature: 0,
    });
    const sample = (r.content || "").trim();
    if (!sample)
      return json({
        ok: false,
        error:
          "提供商返回了空内容（可能是模型名错误或被安全策略拦截）",
      });
    return json({ ok: true, sample: sample.slice(0, 80) });
  } catch (e) {
    return json({ ok: false, error: e.message });
  }
};
