import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("transcribeAudio", () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("should return SERVICE_ERROR when forgeApiUrl is not set", async () => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3" });
    
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("SERVICE_ERROR");
    }
  });

  it("should return SERVICE_ERROR when forgeApiKey is not set", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    delete process.env.BUILT_IN_FORGE_API_KEY;
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3" });
    
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("SERVICE_ERROR");
    }
  });

  it("should return INVALID_FORMAT when audio download fails", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
    
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3" });
    
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("INVALID_FORMAT");
    }
  });

  it("should return FILE_TOO_LARGE when audio exceeds 16MB", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
    
    // Create a buffer larger than 16MB
    const bigBuffer = Buffer.alloc(17 * 1024 * 1024);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValueOnce(bigBuffer.buffer),
      headers: { get: vi.fn().mockReturnValue("audio/mpeg") },
    });
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3" });
    
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("FILE_TOO_LARGE");
    }
  });

  it("should return transcription on success", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
    
    const audioBuffer = Buffer.from("fake-audio");
    const whisperResponse = {
      task: "transcribe",
      language: "en",
      duration: 5.0,
      text: "Hello world",
      segments: [],
    };
    
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValueOnce(audioBuffer.buffer),
        headers: { get: vi.fn().mockReturnValue("audio/mpeg") },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(whisperResponse),
      });
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3", language: "en" });
    
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toBe("Hello world");
      expect(result.language).toBe("en");
    }
  });

  it("should return TRANSCRIPTION_FAILED on API error", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
    
    const audioBuffer = Buffer.from("fake-audio");
    
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValueOnce(audioBuffer.buffer),
        headers: { get: vi.fn().mockReturnValue("audio/mpeg") },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockResolvedValueOnce(""),
      });
    
    const { transcribeAudio } = await import("./voiceTranscription");
    const result = await transcribeAudio({ audioUrl: "http://example.com/audio.mp3" });
    
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("TRANSCRIPTION_FAILED");
    }
  });
});
