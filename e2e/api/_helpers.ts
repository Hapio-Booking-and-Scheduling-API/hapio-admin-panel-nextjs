import http from "node:http"

export interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  text: string
  json<T = Record<string, unknown>>(): T
}

/**
 * Sends a request with full control over the path and headers (including Host),
 * which fetch and Playwright's request context normalise or refuse to override.
 */
export function rawRequest(
  appUrl: string,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<RawResponse> {
  const url = new URL(appUrl)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.body === undefined ? options.headers : { "Content-Type": "application/json", ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: <T>() => JSON.parse(text) as T,
          })
        })
        res.on("error", reject)
      }
    )
    req.on("error", reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** The headers the panel's own client sends. */
export const ADMIN_HEADERS = { "X-Hapio-Admin": "1", Accept: "application/json" } as const
