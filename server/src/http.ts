export const SCRYFALL_USER_AGENT = "BizzyMTGCommander/0.1 (unofficial local Commander client)";

export type HttpRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

export async function fetchJson(
  fetchImpl: HttpFetch,
  url: string,
  init: HttpRequestInit = {},
): Promise<unknown> {
  const headers = {
    "User-Agent": SCRYFALL_USER_AGENT,
    Accept: "application/json",
    ...init.headers,
  };
  const response = await fetchImpl(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}: ${body.slice(0, 180)}`);
  }
  return response.json();
}
