import { simpleChatCompletion } from "./llmProvider.js";
import fs from "fs";
import path from "path";

export interface VisualContext {
  id: string;
  sourceType: "diagram" | "screenshot" | "ui_mockup";
  extractedText: string;
  structuredData: any;
  confidence: number;
}

const visualContextCache = new Map<string, VisualContext>();

/**
 * Simulates a VLM (Vision Language Model) reading an image file
 * and extracting structured context for the RSI pipeline.
 */
export async function extractVisualContext(imagePath: string, type: "diagram" | "screenshot" | "ui_mockup"): Promise<VisualContext | null> {
  if (!fs.existsSync(imagePath)) {
    return null;
  }

  const cacheKey = `${imagePath}_${type}`;
  if (visualContextCache.has(cacheKey)) {
    return visualContextCache.get(cacheKey)!;
  }

  // In a real implementation, this would send the image bytes to GPT-4o
  // For the RSI engine, we simulate the VLM extraction
  const prompt = `Analyze the image at ${imagePath} of type ${type} and extract structured context.`;
  
  try {
    // Simulate VLM call with a standard LLM call for the mock
    const response = await simpleChatCompletion([
      { role: "system", content: "You are a Vision Language Model. Return JSON." },
      { role: "user", content: prompt }
    ]);
    
    // Parse the simulated response
    let structuredData = { entities: [], relationships: [] };
    let extractedText = "Simulated visual extraction";
    
    try {
      const parsed = JSON.parse(response);
      structuredData = parsed.structuredData || structuredData;
      extractedText = parsed.extractedText || extractedText;
    } catch (e) {
      // Fallback
    }

    const context: VisualContext = {
      id: `vc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      sourceType: type,
      extractedText,
      structuredData,
      confidence: 0.85 + (Math.random() * 0.1)
    };

    visualContextCache.set(cacheKey, context);
    return context;
  } catch (error) {
    console.error(`[MultiModal] Failed to extract visual context from ${imagePath}:`, error);
    return null;
  }
}

/**
 * Scans a directory for relevant images to build a project-wide visual context graph.
 */
export async function scanProjectVisuals(dirPath: string): Promise<VisualContext[]> {
  const contexts: VisualContext[] = [];
  
  if (!fs.existsSync(dirPath)) return contexts;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const ext = path.extname(file).toLowerCase();
    
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      // Heuristic for type
      let type: "diagram" | "screenshot" | "ui_mockup" = "screenshot";
      if (file.toLowerCase().includes("arch") || file.toLowerCase().includes("diagram")) {
        type = "diagram";
      } else if (file.toLowerCase().includes("mock") || file.toLowerCase().includes("ui")) {
        type = "ui_mockup";
      }
      
      const ctx = await extractVisualContext(fullPath, type);
      if (ctx) contexts.push(ctx);
    }
  }
  
  return contexts;
}

export function initMultiModalReader() {
  console.log("[MultiModal] Initialized VLM Code Reader daemon");
  // Pre-scan common documentation directories
  const docsDir = path.join(process.cwd(), "docs", "assets");
  if (fs.existsSync(docsDir)) {
    scanProjectVisuals(docsDir).catch(console.error);
  }
}
