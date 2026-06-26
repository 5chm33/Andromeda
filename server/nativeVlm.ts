/**
 * nativeVlm.ts — Phase 5a: Native Vision-Language Integration
 * Andromeda v9.16.2
 *
 * Replaces the intermediate Playwright bounding-box abstraction with a direct
 * Vision-Language Model (VLM) pipeline. The agent processes raw pixels natively
 * to understand UI state, identical to human perception.
 */
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { chatCompletion, getProviderForTier } from "./llmProvider.js";

const log = createLogger("nativeVlm");

export interface VlmAnalysisResult {
  description: string;
  interactableElements: Array<{
    type: string;
    label: string;
    action: string;
    estimatedCoordinates: { x: number, y: number };
  }>;
  suggestedAction: string;
}

/**
 * Analyzes a raw screenshot using a Vision-Language Model.
 * Bypasses the DOM/Playwright bounding box abstraction.
 */
export async function analyzeRawScreenshot(imagePath: string, userQuery: string): Promise<VlmAnalysisResult> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Screenshot not found at ${imagePath}`);
  }

  log.info(`[VLM] Analyzing raw pixels for: ${imagePath}`);
  
  // Read image as base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Use Pro tier (Claude 3.5 Sonnet) as it has the best vision capabilities
  const proProvider = getProviderForTier("pro");
  
  const prompt = `
You are a native Vision-Language Model integrated into an autonomous agent.
You are looking at a raw screenshot of a user interface. 
Do NOT rely on HTML/DOM abstractions. Analyze the pixels directly.

USER GOAL: ${userQuery}

Provide a structured analysis of this UI in EXACTLY this JSON format:
{
  "description": "A brief summary of the current UI state",
  "interactableElements": [
    {
      "type": "button|input|link|dropdown",
      "label": "The visible text or icon description",
      "action": "What happens if clicked/typed",
      "estimatedCoordinates": {"x": 0-100, "y": 0-100} // Percentage from top-left
    }
  ],
  "suggestedAction": "The single best next action to achieve the user goal"
}
`;

  // We construct a special message format that the llmProvider translates to 
  // the provider-specific vision format (OpenAI/Anthropic standard)
  const result = await chatCompletion(
    [
      { 
        role: "user", 
        content: JSON.stringify([
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } }
        ]) 
      }
    ],
    { 
      providerId: proProvider, 
      maxTokens: 2000, 
      temperature: 0.1,
      toolChoice: "none"
    }
  );

  if (!result.content) {
    throw new Error("VLM returned empty response");
  }

  try {
    // Extract JSON from markdown blocks if present
    const jsonMatch = result.content.match(/```json\n([\s\S]*?)\n```/) || 
                      result.content.match(/\{[\s\S]*\}/);
                      
    if (!jsonMatch) {
      throw new Error("Could not parse JSON from VLM response");
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    if (!jsonStr) {
      throw new Error('VLM response did not contain valid JSON');
    }
    const parsed = JSON.parse(jsonStr) as VlmAnalysisResult;
    log.info(`[VLM] Analysis complete. Found ${parsed.interactableElements.length} elements.`);
    return parsed;
  } catch (err) {
    log.error(`[VLM] Failed to parse response: ${result.content}`);
    throw err;
  }
}
