import fs from "fs";
import path from "path";

export interface AISettings {
  aiProvider: "gemini" | "openai" | "anthropic" | "custom";
  apiKey: string;
  modelName: string;
  customBaseUrl?: string;
}

export function getAISettings(): AISettings {
  const defaultSettings: AISettings = {
    aiProvider: "gemini",
    apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    modelName: "gemini-3.6-flash",
    customBaseUrl: "",
  };

  try {
    const filePath = path.join(process.cwd(), "admin_settings.json");
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        aiProvider: parsed.aiProvider || defaultSettings.aiProvider,
        apiKey: parsed.apiKey || defaultSettings.apiKey,
        modelName: parsed.modelName || defaultSettings.modelName,
        customBaseUrl: parsed.customBaseUrl || "",
      };
    }
  } catch (e) {
    console.warn("Failed to read admin_settings.json:", e);
  }
  return defaultSettings;
}

export async function callAI(prompt: string): Promise<string> {
  const settings = getAISettings();
  const { aiProvider, apiKey, modelName, customBaseUrl } = settings;

  if (!apiKey) {
    throw new Error(`AI API Key is not configured for provider: ${aiProvider}`);
  }

  // Handle OpenAI and OpenAI-Compatible Custom Endpoints (DeepSeek, Groq, OpenRouter, Ollama, etc.)
  if (aiProvider === "openai" || aiProvider === "custom") {
    const defaultBaseUrl = "https://api.openai.com/v1";
    const baseUrl = (aiProvider === "custom" && customBaseUrl) ? customBaseUrl.trim() : defaultBaseUrl;
    
    // Strip trailing slashes and ensure it ends with chat/completions
    const cleanBase = baseUrl.replace(/\/$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions") 
      ? cleanBase 
      : `${cleanBase}/chat/completions`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${aiProvider === "custom" ? "Custom LLM" : "OpenAI"} API error: ${response.status} ${errText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } 
  
  if (aiProvider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: modelName || "claude-3-5-sonnet-20240620",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errText}`);
    }
    const data = await response.json();
    return data.content?.[0]?.text || "";
  }

  // Default to Gemini API
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName || "gemini-3.6-flash"}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      })
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
