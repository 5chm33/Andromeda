/**
 * videoGeneration.ts — SOTA Video & Enhanced Image Generation via fal.ai
 * Andromeda v10.4.1
 *
 * Provides:
 *   - Text-to-video  (Kling v2.1 Master — best quality, 5s/10s clips)
 *   - Image-to-video (Kling v2.1 Master — animate a still image)
 *   - Text-to-image  (FLUX 1.1 Pro Ultra — higher quality than HF free tier)
 *
 * Requires: FAL_KEY in .env.local
 * Install:  pnpm add @fal-ai/client
 *
 * Model IDs (fal.ai):
 *   fal-ai/kling-video/v2.1/master/text-to-video
 *   fal-ai/kling-video/v2.1/master/image-to-video
 *   fal-ai/flux-pro/v1.1-ultra
 *   fal-ai/flux-pro/v1.1
 */

// ─── Public option types ──────────────────────────────────────────────────────

export interface TextToVideoOptions {
  /** Text prompt describing the video content */
  prompt: string;
  /** Negative prompt — things to avoid */
  negativePrompt?: string;
  /** Duration in seconds: "5" or "10" (default: "5") */
  duration?: "5" | "10";
  /** Aspect ratio (default: "16:9") */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Camera movement description (appended to prompt) */
  cameraMovement?: string;
  /** CFG scale — how closely to follow the prompt (default: 0.5) */
  cfgScale?: number;
}

export interface ImageToVideoOptions {
  /** Text prompt describing the motion/action */
  prompt: string;
  /** Source image as a public URL or base64 data URL */
  imageUrl: string;
  /** Duration in seconds: "5" or "10" (default: "5") */
  duration?: "5" | "10";
  /** Aspect ratio (default: "16:9") */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** CFG scale (default: 0.5) */
  cfgScale?: number;
}

export interface FalImageOptions {
  /** Text prompt */
  prompt: string;
  /** Negative prompt */
  negativePrompt?: string;
  /** Width in pixels (default: 1024) */
  width?: number;
  /** Height in pixels (default: 1024) */
  height?: number;
  /** Use ultra model for highest quality (default: true) */
  useUltra?: boolean;
  /** Safety tolerance 1 (strict) to 6 (permissive), default "2" */
  safetyTolerance?: "1" | "2" | "3" | "4" | "5" | "6";
}

export interface VideoGenerationResult {
  /** Direct URL to the generated video (mp4) */
  videoUrl: string;
  /** URL to the thumbnail/poster frame */
  thumbnailUrl?: string;
  /** Duration of the generated video in seconds */
  duration: number;
  /** The model used */
  model: string;
  /** Seed used for reproducibility */
  seed?: number;
}

export interface FalImageResult {
  /** Direct URL to the generated image */
  imageUrl: string;
  /** Width of the generated image */
  width: number;
  /** Height of the generated image */
  height: number;
  /** The model used */
  model: string;
  /** Seed used for reproducibility */
  seed?: number;
}

// ─── Internal fal.ai payload types (not exported from client index) ───────────

interface KlingT2VInput {
  prompt: string;
  negative_prompt?: string;
  duration?: "5" | "10";
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  cfg_scale?: number;
}

interface KlingI2VInput {
  prompt: string;
  image_url: string;
  duration?: "5" | "10";
  cfg_scale?: number;
}

interface FluxUltraInput {
  prompt: string;
  aspect_ratio?: string;
  num_images?: number;
  output_format?: "jpeg" | "png";
  safety_tolerance?: "1" | "2" | "3" | "4" | "5" | "6";
}

interface FluxV11Input {
  prompt: string;
  image_size?: "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  num_images?: number;
  output_format?: "jpeg" | "png";
  safety_tolerance?: "1" | "2" | "3" | "4" | "5" | "6";
}

interface FalVideoOutput {
  data: {
    video: { url: string; thumbnail_url?: string };
    seed?: number;
  };
}

interface FalImageOutput {
  data: {
    images: Array<{ url: string; width?: number; height?: number }>;
    seed?: number;
  };
}

// ─── fal.ai Client Factory ────────────────────────────────────────────────────

async function getFalClient() {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    throw new Error(
      "FAL_KEY is not set in .env.local. Get a key at https://fal.ai/dashboard/keys"
    );
  }
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: falKey });
  return fal;
}

// ─── Text-to-Video ────────────────────────────────────────────────────────────

/**
 * Generate a video from a text prompt using Kling v2.1 Master.
 *
 * Kling v2.1 Master is currently the best publicly available text-to-video
 * model, producing cinematic 1080p clips with coherent motion and physics.
 *
 * @example
 * ```ts
 * const result = await generateVideoFromText({
 *   prompt: "A golden retriever running through a field of sunflowers at sunset",
 *   duration: "5",
 *   aspectRatio: "16:9"
 * });
 * console.log(result.videoUrl); // https://cdn.fal.ai/...
 * ```
 */
export async function generateVideoFromText(
  options: TextToVideoOptions
): Promise<VideoGenerationResult> {
  const {
    prompt,
    negativePrompt,
    duration = "5",
    aspectRatio = "16:9",
    cameraMovement,
    cfgScale,
  } = options;

  if (!prompt?.trim()) throw new Error("prompt is required for video generation");

  const fal = await getFalClient();

  // Append camera movement to prompt if provided
  const fullPrompt = cameraMovement
    ? `${prompt.trim()}. Camera: ${cameraMovement}`
    : prompt.trim();

  console.log(`[videoGen] Generating ${duration}s text-to-video: "${fullPrompt.slice(0, 80)}..."`);

  const input: KlingT2VInput = {
    prompt: fullPrompt,
    duration,
    aspect_ratio: aspectRatio,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    ...(cfgScale !== undefined ? { cfg_scale: cfgScale } : {}),
  };

  const result = await fal.subscribe("fal-ai/kling-video/v2.1/master/text-to-video", {
    input,
    logs: true,
    onQueueUpdate: (update: { status: string; position?: number }) => {
      if (update.status === "IN_QUEUE") {
        console.log(`[videoGen] In queue${update.position !== undefined ? ` (position ${update.position})` : ""}`);
      } else if (update.status === "IN_PROGRESS") {
        console.log("[videoGen] Processing...");
      }
    },
  }) as FalVideoOutput;

  const video = result?.data?.video;
  if (!video?.url) {
    throw new Error("Video generation returned no URL. Check fal.ai balance at https://fal.ai/dashboard");
  }

  console.log(`[videoGen] Video ready: ${video.url}`);

  return {
    videoUrl: video.url,
    thumbnailUrl: video.thumbnail_url,
    duration: parseInt(duration, 10),
    model: "kling-video/v2.1/master",
    seed: result?.data?.seed,
  };
}

// ─── Image-to-Video ───────────────────────────────────────────────────────────

/**
 * Animate a still image into a video using Kling v2.1 Master.
 *
 * Takes a reference image and a motion prompt, producing a smooth animated
 * video that preserves the visual style of the source image.
 *
 * @example
 * ```ts
 * const result = await generateVideoFromImage({
 *   prompt: "The camera slowly zooms in, leaves gently swaying in the breeze",
 *   imageUrl: "https://example.com/forest.jpg",
 *   duration: "5"
 * });
 * ```
 */
export async function generateVideoFromImage(
  options: ImageToVideoOptions
): Promise<VideoGenerationResult> {
  const {
    prompt,
    imageUrl,
    duration = "5",
    cfgScale,
  } = options;

  if (!prompt?.trim()) throw new Error("prompt is required for image-to-video");
  if (!imageUrl?.trim()) throw new Error("imageUrl is required for image-to-video");

  const fal = await getFalClient();

  // If imageUrl is a base64 data URL, upload it to fal storage first
  let resolvedImageUrl: string = imageUrl;
  if (imageUrl.startsWith("data:")) {
    console.log("[videoGen] Uploading base64 image to fal storage...");
    const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch?.[1] ?? "image/jpeg";
    const base64Data = imageUrl.split(",")[1];
    const buffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([buffer], { type: mimeType });
    resolvedImageUrl = await fal.storage.upload(blob);
    console.log(`[videoGen] Image uploaded: ${resolvedImageUrl}`);
  }

  console.log(`[videoGen] Generating ${duration}s image-to-video: "${prompt.slice(0, 80)}..."`);

  const input: KlingI2VInput = {
    prompt: prompt.trim(),
    image_url: resolvedImageUrl,
    duration,
    ...(cfgScale !== undefined ? { cfg_scale: cfgScale } : {}),
  };

  const result = await fal.subscribe("fal-ai/kling-video/v2.1/master/image-to-video", {
    input,
    logs: true,
    onQueueUpdate: (update: { status: string; position?: number }) => {
      if (update.status === "IN_QUEUE") {
        console.log(`[videoGen] In queue${update.position !== undefined ? ` (position ${update.position})` : ""}`);
      } else if (update.status === "IN_PROGRESS") {
        console.log("[videoGen] Processing...");
      }
    },
  }) as FalVideoOutput;

  const video = result?.data?.video;
  if (!video?.url) {
    throw new Error("Image-to-video generation returned no URL. Check fal.ai balance at https://fal.ai/dashboard");
  }

  console.log(`[videoGen] Video ready: ${video.url}`);

  return {
    videoUrl: video.url,
    thumbnailUrl: video.thumbnail_url,
    duration: parseInt(duration, 10),
    model: "kling-video/v2.1/master",
    seed: result?.data?.seed,
  };
}

// ─── FLUX Image Generation (fal.ai — higher quality than HF free tier) ────────

/**
 * Generate a high-quality image using FLUX 1.1 Pro Ultra via fal.ai.
 *
 * This is a step up from the HuggingFace free tier — FLUX Pro produces
 * significantly better detail, coherence, and prompt adherence.
 *
 * @example
 * ```ts
 * const result = await generateImageFal({
 *   prompt: "A photorealistic portrait of a robot philosopher, studio lighting",
 *   useUltra: true
 * });
 * ```
 */
export async function generateImageFal(
  options: FalImageOptions
): Promise<FalImageResult> {
  const {
    prompt,
    width = 1024,
    height = 1024,
    useUltra = true,
    safetyTolerance = "2",
  } = options;

  if (!prompt?.trim()) throw new Error("prompt is required for image generation");

  const fal = await getFalClient();

  // Derive aspect ratio string from width/height for ultra model
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  const aspectRatio = `${width / g}:${height / g}`;

  if (useUltra) {
    const modelId = "fal-ai/flux-pro/v1.1-ultra" as const;
    console.log(`[videoGen] Generating image via ${modelId}: "${prompt.slice(0, 80)}..."`);

    const input: FluxUltraInput = {
      prompt: prompt.trim(),
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: safetyTolerance,
    };

    const result = await fal.subscribe(modelId, { input, logs: false }) as FalImageOutput;

    const image = result?.data?.images?.[0];
    if (!image?.url) {
      throw new Error("Image generation returned no URL. Check fal.ai balance at https://fal.ai/dashboard");
    }

    console.log(`[videoGen] Image ready: ${image.url}`);
    return {
      imageUrl: image.url,
      width: image.width ?? width,
      height: image.height ?? height,
      model: modelId,
      seed: result?.data?.seed,
    };
  } else {
    const modelId = "fal-ai/flux-pro/v1.1" as const;
    console.log(`[videoGen] Generating image via ${modelId}: "${prompt.slice(0, 80)}..."`);

    const input: FluxV11Input = {
      prompt: prompt.trim(),
      image_size: "landscape_16_9",
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: safetyTolerance,
    };

    const result = await fal.subscribe(modelId, { input, logs: false }) as FalImageOutput;

    const image = result?.data?.images?.[0];
    if (!image?.url) {
      throw new Error("Image generation returned no URL. Check fal.ai balance at https://fal.ai/dashboard");
    }

    console.log(`[videoGen] Image ready: ${image.url}`);
    return {
      imageUrl: image.url,
      width: image.width ?? width,
      height: image.height ?? height,
      model: modelId,
      seed: result?.data?.seed,
    };
  }
}

// ─── Capability Check ─────────────────────────────────────────────────────────

/**
 * Returns true if fal.ai video generation is configured and available.
 */
export function isFalAvailable(): boolean {
  return !!process.env.FAL_KEY;
}
