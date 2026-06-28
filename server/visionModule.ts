/**
 * visionModule.ts — Multi-Modal Vision Analysis (v11.0.0)
 * Gives Andromeda the ability to "see" — analyze images, screenshots, and
 * UI layouts using vision-capable LLMs. Supports base64 and URL inputs.
 * Routes to the best available vision provider (GPT-4o, Claude 3.5, Gemini).
 */
import fs from 'fs';
import path from 'path';

export type VisionProvider = 'openai' | 'anthropic' | 'gemini' | 'mock';

export interface VisionAnalysisOptions {
  provider?: VisionProvider;
  maxTokens?: number;
  detail?: 'low' | 'high' | 'auto';
}

export interface VisionAnalysisResult {
  description: string;
  objects: string[];
  text: string[];       // OCR'd text found in image
  uiElements: string[]; // detected UI elements (buttons, inputs, etc.)
  confidence: number;
  provider: VisionProvider;
  durationMs: number;
}

export interface VisionError {
  error: string;
  provider: VisionProvider;
}

/**
 * Detect the best available vision provider based on env vars.
 */
export function detectVisionProvider(): VisionProvider {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'mock';
}

/**
 * Load an image from a file path and return as base64.
 */
export function imageToBase64(filePath: string): string {
  const abs = path.resolve(filePath);
  const buffer = fs.readFileSync(abs);
  return buffer.toString('base64');
}

/**
 * Detect MIME type from file extension.
 */
export function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeMap[ext] ?? 'image/png';
}

/**
 * Parse vision response into structured VisionAnalysisResult.
 * Extracts objects, text, and UI elements from free-form description.
 */
function parseVisionResponse(
  raw: string,
  provider: VisionProvider,
  durationMs: number
): VisionAnalysisResult {
  // Extract quoted items as objects
  const objects = (raw.match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''));

  // Extract UI element keywords
  const uiKeywords = ['button', 'input', 'dropdown', 'menu', 'header', 'footer',
    'modal', 'sidebar', 'nav', 'form', 'table', 'card', 'icon', 'link', 'checkbox'];
  const lower = raw.toLowerCase();
  const uiElements = uiKeywords.filter(k => lower.includes(k));

  // Extract text in ALL CAPS or quoted strings as OCR candidates
  const text = (raw.match(/[A-Z]{2,}(?:\s+[A-Z]{2,})*/g) ?? []).filter(t => t.length > 2);

  return {
    description: raw,
    objects,
    text,
    uiElements,
    confidence: 0.85,
    provider,
    durationMs,
  };
}

/**
 * Analyze an image using the OpenAI vision API (GPT-4o).
 */
async function analyzeWithOpenAI(
  imageData: string,
  mimeType: string,
  prompt: string,
  options: VisionAnalysisOptions
): Promise<string> {
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: options.maxTokens ?? 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageData}`,
                detail: options.detail ?? 'auto',
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    return response.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    console.error('OpenAI vision analysis failed:', error);
    throw error;
  }
}

/**
 * Analyze an image using the Anthropic Claude vision API.
 */
async function analyzeWithAnthropic(
  imageData: string,
  mimeType: string,
  prompt: string,
  options: VisionAnalysisOptions
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: options.maxTokens ?? 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageData,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

/**
 * Mock vision analysis for testing / offline use.
 */
function mockAnalysis(prompt: string, durationMs: number): VisionAnalysisResult {
  return {
    description: `[MOCK] Vision analysis of image: ${prompt}`,
    objects: ['element1', 'element2'],
    text: ['MOCK TEXT'],
    uiElements: ['button', 'input'],
    confidence: 0.5,
    provider: 'mock',
    durationMs,
  };
}

/**
 * Main entry point: analyze an image from a file path or base64 string.
 * @param imageSource - File path, URL, or base64 string
 * @param prompt - What to look for / analyze
 * @param options - Provider and analysis options
 */
export async function analyzeImage(
  imageSource: string,
  prompt = 'Describe this image in detail. List all visible UI elements, text, and objects.',
  options: VisionAnalysisOptions = {}
): Promise<VisionAnalysisResult | VisionError> {
  const provider = options.provider ?? detectVisionProvider();
  const startTime = Date.now();

  // Return mock immediately if requested or no API keys
  if (provider === 'mock') {
    return mockAnalysis(prompt, Date.now() - startTime);
  }

  try {
    let imageData: string;
    let mimeType: string;

    if (imageSource.startsWith('data:')) {
      // Already base64 data URI
      const [header, data] = imageSource.split(',');
      mimeType = header.split(':')[1].split(';')[0];
      imageData = data;
    } else if (imageSource.startsWith('http')) {
      // URL — fetch and convert
      const res = await fetch(imageSource);
      const buffer = await res.arrayBuffer();
      imageData = Buffer.from(buffer).toString('base64');
      mimeType = res.headers.get('content-type') ?? 'image/jpeg';
    } else {
      // File path
      imageData = imageToBase64(imageSource);
      mimeType = detectMimeType(imageSource);
    }

    let raw = '';
    if (provider === 'openai') {
      raw = await analyzeWithOpenAI(imageData, mimeType, prompt, options);
    } else if (provider === 'anthropic') {
      raw = await analyzeWithAnthropic(imageData, mimeType, prompt, options);
    } else {
      return mockAnalysis(prompt, Date.now() - startTime);
    }

    return parseVisionResponse(raw, provider, Date.now() - startTime);
  } catch (error: any) {
    return { error: error.message ?? 'Vision analysis failed', provider };
  }
}

/**
 * Specialized: analyze a UI screenshot and return actionable fix suggestions.
 */
export async function analyzeUIScreenshot(
  screenshotPath: string,
  options: VisionAnalysisOptions = {}
): Promise<VisionAnalysisResult | VisionError> {
  const prompt = [
    'Analyze this UI screenshot.',
    'List: 1) All visible UI components (buttons, inputs, modals, etc.)',
    '2) Any visible error messages or broken layouts',
    '3) Text content visible on screen',
    '4) Suggested fixes for any issues you see',
  ].join(' ');

  return analyzeImage(screenshotPath, prompt, options);
}

/**
 * Specialized: extract all text from an image (OCR-like).
 */
export async function extractTextFromImage(
  imageSource: string,
  options: VisionAnalysisOptions = {}
): Promise<string[]> {
  const result = await analyzeImage(
    imageSource,
    'Extract ALL text visible in this image. Return each text element on a new line.',
    options
  );
  if ('error' in result) return [];
  return result.text.length > 0 ? result.text : result.description.split('\n').filter(Boolean);
}
