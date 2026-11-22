// Provider-neutral LLM client. AI_PROVIDER=gemini (default) or anthropic.
// Both jobs (advice writer, question answerer) go through complete() / chatWithTools().
import '@sour/db/env';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai';

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type RunTool = (name: string, input: unknown) => Promise<string>;

const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase() === 'anthropic' ? 'anthropic' : 'gemini';
const apiKey = () => process.env.AI_API_KEY || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY);

// Fast, cheap tiers by default (tech design §7.3). Override with AI_MODEL.
export const MODEL = process.env.AI_MODEL || (provider === 'gemini' ? 'gemini-3.8-flash' : 'claude-haiku-5-5');
export const PROVIDER = provider;
export const aiEnabled = () => !!apiKey();

// Tried in order when a model is overloaded (503), timed out, rate-limited or retired.
const FALLBACK_MODELS = (
  process.env.AI_FALLBACK_MODELS ?? (provider === 'gemini' ? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite' : '')
)
  .split(',')
  .map((s) => s.trim())
  .filter((m) => m && m !== MODEL);
export const MODELS = [MODEL, ...FALLBACK_MODELS];

const MAX_TURNS = 5;
const ATTEMPT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 10_000);

/** Remembers a model that just failed so the next questions skip it for a few minutes. */
const coolDown = new Map<string, number>();
const COOL_DOWN_MS = 3 * 60_000;

let gemini: GoogleGenAI | null = null;
let claude: Anthropic | null = null;
const geminiClient = () =>
  (gemini ??= new GoogleGenAI({ apiKey: apiKey()!, httpOptions: { timeout: ATTEMPT_TIMEOUT_MS } }));
const claudeClient = () => (claude ??= new Anthropic({ apiKey: apiKey()!, timeout: 15_000, maxRetries: 1 }));

// ---------------------------------------------------------------- Gemini

function geminiConfig(system: string, maxTokens: number) {
  return {
    systemInstruction: system,
    temperature: 0.2, // consistent wording (tech design §7.3)
    maxOutputTokens: maxTokens,
  };
}

/** generateContent with model fallback: busy / timed-out / retired models are skipped. */
async function geminiGenerate(
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  pinned?: { model?: string },
) {
  const ai = geminiClient();
  const order = pinned?.model
    ? [pinned.model]
    : [...MODELS.filter((m) => (coolDown.get(m) ?? 0) < Date.now()), ...MODELS.filter((m) => (coolDown.get(m) ?? 0) >= Date.now())];
  let lastErr: unknown;
  for (const model of order) {
    try {
      // Gemini 3 models "think" by default; keep it LOW so answers come back fast (NFR-2).
      const config = /^gemini-3/.test(model)
        ? { ...params.config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : params.config;
      const res = await ai.models.generateContent({ ...params, config, model });
      if (pinned) pinned.model = model; // keep one model for the whole tool conversation
      return res;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error).message);
      const retryable = /"code":\s*(429|500|503|504|404)|UNAVAILABLE|DEADLINE|timeout|aborted|fetch failed/i.test(msg);
      console.warn(`[ai] ${model} failed: ${msg.slice(0, 120)}`);
      if (!retryable || pinned?.model) throw err;
      coolDown.set(model, Date.now() + COOL_DOWN_MS);
    }
  }
  throw lastErr;
}

async function geminiChat(system: string, question: string, tools: ToolSpec[], runTool: RunTool, maxTokens: number) {
  const pinned: { model?: string } = {};
  const contents: Content[] = [{ role: 'user', parts: [{ text: question }] }];
  const config = {
    ...geminiConfig(system, maxTokens),
    ...(tools.length
      ? {
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.input_schema,
              })),
            },
          ],
        }
      : {}),
  };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await geminiGenerate({ contents, config }, pinned);
    const calls = res.functionCalls ?? [];
    if (!calls.length) return res.text?.trim() || null;

    contents.push(res.candidates?.[0]?.content ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    const parts: Part[] = await Promise.all(
      calls.map(async (c) => {
        const out = JSON.parse(await runTool(c.name ?? '', c.args ?? {}));
        return {
          functionResponse: {
            id: c.id,
            name: c.name ?? '',
            response: out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out },
          },
        };
      }),
    );
    contents.push({ role: 'user', parts });
  }
  return null;
}

// ---------------------------------------------------------------- Anthropic (Claude)

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function claudeChat(system: string, question: string, tools: ToolSpec[], runTool: RunTool, maxTokens: number) {
  const client = claudeClient();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: Math.max(maxTokens, 1024),
      output_config: { effort: 'low' },
      system,
      ...(tools.length ? { tools: tools as Anthropic.Tool[] } : {}),
      messages,
    });
    if (res.stop_reason === 'refusal') return null;
    if (res.stop_reason !== 'tool_use') return textOf(res) || null;
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => ({
        type: 'tool_result',
        tool_use_id: c.id,
        content: await runTool(c.name, c.input),
      })),
    );
    messages.push({ role: 'user', content: results });
  }
  return null;
}

// ---------------------------------------------------------------- public API

/** Runs a tool-calling conversation. Returns null on any failure so callers can fall back. */
export async function chatWithTools(
  system: string,
  question: string,
  tools: ToolSpec[],
  runTool: RunTool,
  maxTokens = 1024,
): Promise<string | null> {
  if (!aiEnabled()) return null;
  try {
    return provider === 'gemini'
      ? await geminiChat(system, question, tools, runTool, maxTokens)
      : await claudeChat(system, question, tools, runTool, maxTokens);
  } catch (err) {
    console.warn(`[ai] ${provider} request failed:`, (err as Error).message);
    return null;
  }
}

/** One short completion (no tools). Returns null on any failure. */
export function complete(system: string, user: string, maxTokens = 1024): Promise<string | null> {
  return chatWithTools(system, user, [], async () => '{}', maxTokens);
}
