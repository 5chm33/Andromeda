/**
 * imageCaptioner.ts — v71.0.0 "Multi-Modal Intelligence"
 * Image captioning with style variants, detail levels, and accessibility descriptions.
 */
export type CaptionStyle = "descriptive" | "concise" | "accessibility" | "technical";
export interface Caption { captionId: string; imageId: string; style: CaptionStyle; text: string; confidence: number; tags: string[]; generatedAt: number; }

const captions: Caption[] = [];
let captionCounter = 0;

export function generateCaption(imageId: string, style: CaptionStyle, objects: Array<{ label: string; confidence: number }>, scene: string, colors: string[]): Caption {
  const highConf = objects.filter(o => o.confidence > 0.7).map(o => o.label);
  let text = "";
  switch (style) {
    case "descriptive": text = `A ${scene} scene featuring ${highConf.join(", ") || "various elements"} with dominant colors ${colors.slice(0, 2).join(" and ")}.`; break;
    case "concise": text = highConf.length > 0 ? `${highConf[0]} in a ${scene}` : `A ${scene} scene`; break;
    case "accessibility": text = `Image shows: ${highConf.join(", ") || "unidentified content"}. Scene type: ${scene}. Color palette: ${colors.join(", ")}.`; break;
    case "technical": text = `Scene=${scene}, Objects=[${highConf.join(",")}], Colors=[${colors.join(",")}], Confidence=${objects.length > 0 ? (objects.reduce((s, o) => s + o.confidence, 0) / objects.length).toFixed(2) : "N/A"}`; break;
  }
  const caption: Caption = { captionId: `cap-${++captionCounter}`, imageId, style, text, confidence: objects.length > 0 ? objects[0].confidence : 0.5, tags: highConf, generatedAt: Date.now() };
  captions.push(caption);
  return caption;
}

export function getCaptions(imageId?: string): Caption[] { return imageId ? captions.filter(c => c.imageId === imageId) : [...captions]; }
export function _resetImageCaptionerForTest(): void { captions.length = 0; captionCounter = 0; }
