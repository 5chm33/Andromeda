/**
 * imageGeneration.ts — v5.1
 *
 * Two-stage reference-guided image generation:
 * Stage 1: Visual Deconstruction — DeepSeek Vision analyzes the reference image
 *          and extracts all visual style properties as structured text
 * Stage 2: Constraint-Injected Generation — those properties become hard constraints
 *          in the FLUX generation prompt, producing far more accurate style matching
 *
 * This approach outperforms img2img for FLUX because FLUX is fundamentally
 * text-driven — precise, detailed text constraints produce precise output.
 */

const HF_TXT2IMG_ENDPOINT =
  "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";

import { createLogger } from "../logger.js";
const log = createLogger("imageGeneration");

export type GenerateImageOptions = {
  prompt: string;
  referenceImageB64?: string;
  referenceMimeType?: string;
  width?: number;
  height?: number;
  model?: string;
  seed?: number;
  originalImages?: Array<{ url?: string; b64Json?: string; mimeType?: string }>;
  strength?: number;
};

export type GenerateImageResponse = {
  url?: string;
  b64Json?: string;
  enhancedPrompt?: string;
  styleAnalysis?: string;
  usedReference?: boolean;
};

async function extractVisualStyle(
  referenceImageB64: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  // Use the OpenAI-compatible endpoint with a vision-capable model.
  // deepseek-chat does NOT support image inputs (returns 400).
  // The OPENAI_API_KEY env var is pre-configured in the sandbox to point
  // to a proxy that supports gpt-4.1-mini with vision.
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  if (!apiKey) return "";

  const dataUrl = referenceImageB64.startsWith("data:")
    ? referenceImageB64
    : `data:${mimeType};base64,${referenceImageB64}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are a professional visual analyst for AI image generation.
Analyze the reference image and extract ALL visual properties that define its style.
Be extremely specific. Output a structured analysis covering:
1. RENDERING STYLE: (e.g., "photorealistic 3D render", "2D cartoon", "oil painting", "pixel art")
2. MATERIAL & SURFACE: (e.g., "chrome metallic liquid silver finish", "matte plastic", "watercolor")
3. LIGHTING: (e.g., "dramatic studio lighting with blue-purple rim light", "soft diffused daylight")
4. COLOR PALETTE: (e.g., "monochromatic silver-blue-purple", "warm earth tones", "vibrant saturated")
5. LEVEL OF DETAIL: (e.g., "ultra-high detail with subsurface scattering", "simple flat design")
6. COMPOSITION: (e.g., "dynamic action pose full body", "portrait centered", "3/4 view")
7. BACKGROUND: (e.g., "pure black", "blurred bokeh", "white studio")
8. ART DIRECTION: (e.g., "Nintendo 64 game art style", "Marvel Comics", "Studio Ghibli anime")
9. KEY FEATURES: any other unique visual properties
Use comma-separated descriptive terms. Be concise but complete.`,
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: "Analyze this reference image and extract all visual style properties." },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) { log.warn("[imageGen] Style extraction failed:", response.status); return ""; }
    const data = await response.json() as any;
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    log.warn("[imageGen] Style extraction error:", err);
    return "";
  }
}

async function buildConstrainedPrompt(userPrompt: string, styleAnalysis: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !styleAnalysis) return userPrompt;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an expert FLUX image generation prompt engineer.
You receive a STYLE ANALYSIS (hard constraints that MUST be preserved) and a USER REQUEST.
Write a single dense generation prompt (60-120 words) that:
1. Applies the user's requested subject/change
2. STRICTLY preserves ALL style constraints from the reference analysis
3. Uses FLUX-optimized comma-separated descriptive terms
4. Emphasizes key style properties with "EXACT SAME", "identical material", "matching style"
5. Ends with: ultra high detail, 8k, masterpiece
Output ONLY the prompt text. No explanation. No quotes.`,
          },
          {
            role: "user",
            content: `STYLE ANALYSIS (hard constraints):\n${styleAnalysis}\n\nUSER REQUEST: ${userPrompt}\n\nWrite the generation prompt:`,
          },
        ],
        max_tokens: 250,
        temperature: 0.5,
      }),
    });

    if (!response.ok) { log.warn("[imageGen] Prompt building failed:", response.status); return userPrompt; }
    const data = await response.json() as any;
    return data?.choices?.[0]?.message?.content?.trim() || userPrompt;
  } catch (err) {
    log.warn("[imageGen] Prompt building error:", err);
    return userPrompt;
  }
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const { prompt, referenceImageB64, referenceMimeType = "image/jpeg", width = 1024, height = 1024 } = options;

  if (!prompt?.trim()) throw new Error("Prompt is required for image generation");

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    throw new Error(
      "HF_TOKEN is not set in .env.local. Get a free token at https://huggingface.co/settings/tokens"
    );
  }

  let finalPrompt = prompt.trim();
  let styleAnalysis: string | undefined;

  if (referenceImageB64) {
    log.info("[imageGen] Stage 1: Extracting visual style from reference...");
    styleAnalysis = await extractVisualStyle(referenceImageB64, referenceMimeType);

    if (styleAnalysis) {
      log.info("[imageGen] Style extracted:", styleAnalysis.slice(0, 200));
      log.info("[imageGen] Stage 2: Building constrained prompt...");
      finalPrompt = await buildConstrainedPrompt(prompt.trim(), styleAnalysis);
      log.info("[imageGen] Final prompt:", finalPrompt);
    } else {
      finalPrompt = `${prompt.trim()}, same visual style as reference image, matching art style, identical rendering technique, same color palette and lighting, ultra high detail, 8k`;
    }
  }

  const response = await fetch(HF_TXT2IMG_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "application/json",
      "x-use-cache": "0",
    },
    body: JSON.stringify({
      inputs: finalPrompt,
      parameters: { num_inference_steps: 4, width, height, guidance_scale: 0 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`Image generation failed (HF ${response.status}): ${errorText.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  return {
    url: dataUrl,
    enhancedPrompt: referenceImageB64 ? finalPrompt : undefined,
    styleAnalysis,
    usedReference: !!referenceImageB64,
  };
}
