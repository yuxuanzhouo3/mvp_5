import { ProxyAgent, fetch as undiciFetch } from "undici";

export type ProxyProvider = "mistral" | "replicate" | "aliyun";

const sharedProxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? undefined;

const proxyUrlByProvider: Record<ProxyProvider, string | undefined> = {
  mistral:
    process.env.MISTRAL_PROXY_URL ??
    process.env.GEMINI_PROXY_URL ??
    sharedProxyUrl,
  replicate:
    process.env.REPLICATE_PROXY_URL ??
    process.env.GEMINI_PROXY_URL ??
    sharedProxyUrl,
  aliyun:
    process.env.DASHSCOPE_PROXY_URL ??
    process.env.ALIYUN_PROXY_URL ??
    process.env.GEMINI_PROXY_URL ??
    sharedProxyUrl,
};

const proxyAgentCache = new Map<ProxyProvider, ProxyAgent | undefined>();

function getProxyAgent(provider: ProxyProvider) {
  if (proxyAgentCache.has(provider)) {
    return proxyAgentCache.get(provider);
  }

  const proxyUrl = proxyUrlByProvider[provider];
  const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  proxyAgentCache.set(provider, agent);
  return agent;
}

export const providerFetch = ((
  provider: ProxyProvider,
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const proxyAgent = getProxyAgent(provider);
  if (!proxyAgent) {
    return fetch(input, init);
  }

  return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init ?? {}),
    dispatcher: proxyAgent,
  } as Parameters<typeof undiciFetch>[1]);
}) as (
  provider: ProxyProvider,
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function getProviderProxyStatus(provider: ProxyProvider) {
  const proxyUrl = proxyUrlByProvider[provider];
  return proxyUrl ? `启用 (${proxyUrl})` : "未启用";
}
