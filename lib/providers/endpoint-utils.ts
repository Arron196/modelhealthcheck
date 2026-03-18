import type {ProviderType} from "@/lib/types";

const OPENAI_ENDPOINT_REGEX = /\/(chat\/completions|responses)\/?$/i;
const ANTHROPIC_ENDPOINT_REGEX = /\/messages\/?$/i;

function parseEndpoint(endpoint: string): URL {
  try {
    return new URL(endpoint.trim());
  } catch {
    throw new Error("接口地址必须是合法 URL");
  }
}

function normalizeOpenAiPath(pathname: string): string {
  return pathname
    .replace(/\/response(?=\/|$)/i, "/responses")
    .replace(/\/chat\/completion(?=\/|$)/i, "/chat/completions");
}

export function normalizeProviderEndpoint(type: ProviderType, endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return endpoint;
  }

  const parsed = parseEndpoint(trimmed);

  if (type === "openai") {
    parsed.pathname = normalizeOpenAiPath(parsed.pathname);
    if (!OPENAI_ENDPOINT_REGEX.test(parsed.pathname)) {
      throw new Error("OpenAI 接口地址必须以 /v1/chat/completions 或 /v1/responses 结尾");
    }
  }

  if (type === "anthropic" && !ANTHROPIC_ENDPOINT_REGEX.test(parsed.pathname)) {
    throw new Error("Anthropic 接口地址必须以 /v1/messages 结尾");
  }

  return parsed.toString();
}
