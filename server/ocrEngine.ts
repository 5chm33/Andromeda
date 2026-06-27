/**
 * ocrEngine.ts — v71.0.0 "Multi-Modal Intelligence"
 * OCR engine with text region detection, confidence scoring, and structured output.
 */
export interface TextRegion { regionId: string; text: string; confidence: number; bbox: { x: number; y: number; width: number; height: number }; language?: string; }
export interface OCRResult { ocrId: string; imageId: string; regions: TextRegion[]; fullText: string; avgConfidence: number; detectedLanguages: string[]; processingMs: number; }

const results: OCRResult[] = [];
let ocrCounter = 0;

export function performOCR(imageId: string, rawRegions: Array<{ text: string; confidence: number; x?: number; y?: number; w?: number; h?: number; lang?: string }>): OCRResult {
  const start = Date.now();
  const regions: TextRegion[] = rawRegions.map((r, i) => ({
    regionId: `region-${i + 1}`, text: r.text, confidence: r.confidence,
    bbox: { x: r.x ?? 0, y: r.y ?? 0, width: r.w ?? 100, height: r.h ?? 20 },
    language: r.lang
  }));
  const fullText = regions.map(r => r.text).join('\n');
  const avgConfidence = regions.length > 0 ? regions.reduce((s, r) => s + r.confidence, 0) / regions.length : 0;
  const detectedLanguages = [...new Set(regions.map(r => r.language).filter(Boolean) as string[])];
  const result: OCRResult = { ocrId: `ocr-${++ocrCounter}`, imageId, regions, fullText, avgConfidence, detectedLanguages, processingMs: Date.now() - start };
  results.push(result);
  return result;
}

export function searchOCRText(query: string): OCRResult[] {
  return results.filter(r => r.fullText.toLowerCase().includes(query.toLowerCase()));
}

export function getOCRHistory(): OCRResult[] { return [...results]; }
export function _resetOCREngineForTest(): void { results.length = 0; ocrCounter = 0; }
