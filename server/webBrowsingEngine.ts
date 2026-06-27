/**
 * webBrowsingEngine.ts — v66.0.0 "Real-World Integration"
 * Autonomous web browsing: fetch pages, extract content, follow links, handle redirects.
 */

export interface BrowseRequest { url: string; extractLinks?: boolean; extractText?: boolean; timeout?: number; }
export interface BrowseResult { url: string; finalUrl: string; statusCode: number; title: string; textContent: string; links: string[]; fetchedAt: number; error?: string; }

const history: BrowseResult[] = [];

export async function browseUrl(req: BrowseRequest): Promise<BrowseResult> {
  const timeout = req.timeout ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(req.url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const textContent = req.extractText !== false
      ? html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
           .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
           .replace(/<[^>]+>/g, " ")
           .replace(/\s+/g, " ")
           .trim()
           .slice(0, 5000)
      : "";
    const links: string[] = [];
    if (req.extractLinks) {
      const linkRegex = /href="(https?:\/\/[^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null && links.length < 50) links.push(m[1]);
    }
    const result: BrowseResult = { url: req.url, finalUrl: res.url, statusCode: res.status, title, textContent, links, fetchedAt: Date.now() };
    history.push(result);
    return result;
  } catch (e: unknown) {
    clearTimeout(timer);
    const error = e instanceof Error ? e.message : String(e);
    const result: BrowseResult = { url: req.url, finalUrl: req.url, statusCode: 0, title: "", textContent: "", links: [], fetchedAt: Date.now(), error };
    history.push(result);
    return result;
  }
}

export function getBrowsingHistory(): BrowseResult[] { return [...history]; }
export function clearBrowsingHistory(): void { history.length = 0; }
