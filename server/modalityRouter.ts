/**
 * modalityRouter.ts — v72.0.0 "Multi-Modal Fusion"
 * Routes incoming data to the appropriate modality processor based on MIME type or content heuristics.
 */
export type ModalityRoute = { modality: string; processor: string; confidence: number; reason: string; };

const routingHistory: Array<{ input: string; route: ModalityRoute; routedAt: number }> = [];

const MIME_MAP: Record<string, ModalityRoute> = {
  "image/jpeg": { modality: "vision", processor: "visionProcessor", confidence: 1.0, reason: "JPEG image" },
  "image/png":  { modality: "vision", processor: "visionProcessor", confidence: 1.0, reason: "PNG image" },
  "audio/mp3":  { modality: "audio", processor: "speechRecognizer", confidence: 1.0, reason: "MP3 audio" },
  "audio/wav":  { modality: "audio", processor: "speechRecognizer", confidence: 1.0, reason: "WAV audio" },
  "video/mp4":  { modality: "video", processor: "videoFrameAnalyzer", confidence: 1.0, reason: "MP4 video" },
  "text/plain": { modality: "text", processor: "documentParser", confidence: 1.0, reason: "Plain text" },
  "text/html":  { modality: "text", processor: "documentParser", confidence: 0.95, reason: "HTML document" },
  "application/pdf": { modality: "text", processor: "documentParser", confidence: 0.9, reason: "PDF document" },
};

export function routeByMimeType(mimeType: string): ModalityRoute {
  const route = MIME_MAP[mimeType] ?? { modality: "text", processor: "documentParser", confidence: 0.5, reason: "Unknown MIME type, defaulting to text" };
  routingHistory.push({ input: mimeType, route, routedAt: Date.now() });
  return route;
}

export function routeByHeuristic(content: string): ModalityRoute {
  let route: ModalityRoute;
  if (content.startsWith("data:image/")) route = { modality: "vision", processor: "visionProcessor", confidence: 0.95, reason: "Base64 image data URI" };
  else if (content.startsWith("http") && /\.(jpg|jpeg|png|gif|webp)$/i.test(content)) route = { modality: "vision", processor: "visionProcessor", confidence: 0.9, reason: "Image URL" };
  else if (content.startsWith("http") && /\.(mp4|avi|mov|webm)$/i.test(content)) route = { modality: "video", processor: "videoFrameAnalyzer", confidence: 0.9, reason: "Video URL" };
  else if (content.startsWith("http") && /\.(mp3|wav|ogg|flac)$/i.test(content)) route = { modality: "audio", processor: "speechRecognizer", confidence: 0.9, reason: "Audio URL" };
  else if (content.includes("graph TD") || content.includes("sequenceDiagram") || content.includes("classDiagram")) route = { modality: "diagram", processor: "diagramInterpreter", confidence: 0.95, reason: "Mermaid diagram syntax" };
  else route = { modality: "text", processor: "documentParser", confidence: 0.8, reason: "Default text content" };
  routingHistory.push({ input: content.slice(0, 50), route, routedAt: Date.now() });
  return route;
}

export function getRoutingHistory() { return [...routingHistory]; }
export function _resetModalityRouterForTest(): void { routingHistory.length = 0; }
