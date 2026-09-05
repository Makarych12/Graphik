import { NextResponse } from "next/server";

/**
 * Сървърен посредник към OpenRouter (D.7.2).
 * Ключът стои САМО в Environment Variables на Vercel и никога не стига до клиента.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Моделът се задава само в Environment Variables — приложението няма UI за него. */
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";
const MAX_BODY = 400_000; // символа — предпазна граница за контекста на графика

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Не е конфигуриран OPENROUTER_API_KEY в Environment Variables." },
      { status: 503 },
    );
  }

  let body: {
    messages?: unknown[];
    tools?: unknown[];
    temperature?: number;
  };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) {
      return NextResponse.json({ error: "Заявката е твърде голяма." }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Невалидно тяло на заявката." }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Липсва messages." }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_SITE_NAME) headers["X-Title"] = process.env.OPENROUTER_SITE_NAME;

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: "auto" } : {}),
        temperature: body.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `OpenRouter отговори с ${upstream.status}`, detail: text.slice(0, 800) },
        { status: upstream.status },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Няма връзка с OpenRouter: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
