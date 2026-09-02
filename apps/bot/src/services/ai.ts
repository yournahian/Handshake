import * as dotenv from "dotenv";
import * as path from "path";
import * as https from "https";
import * as http from "http";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

interface AIRequest {
  prompt: string;
  image?: { base64: string; mimeType: string };
}

// ─── Gemini HTTP Client ──────────────────────────────────────────────────────
async function callGemini(apiKey: string, prompt: string, image?: { base64: string; mimeType: string }): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const parts: any[] = [{ text: prompt }];
  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64
      }
    });
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API returned empty response candidates");
  return text;
}

// ─── OpenAI / Groq / OpenRouter HTTP Client ─────────────────────────────────
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  image?: { base64: string; mimeType: string }
): Promise<string> {
  const headers: any = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
  if (baseUrl.includes("openrouter")) {
    headers["HTTP-Referer"] = "https://handshake.com";
    headers["X-Title"] = "Handshake Arbitrator";
  }

  const messages: any[] = [];
  const contentParts: any[] = [{ type: "text", text: prompt }];
  if (image) {
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`
      }
    });
  }
  messages.push({ role: "user", content: contentParts });

  const body: any = {
    model,
    messages,
    response_format: { type: "json_object" }
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`${model} API returned status ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${model} API returned empty choices`);
  return text;
}

// ─── Failover Engine ─────────────────────────────────────────────────────────
export async function callAIWithFailover(req: AIRequest): Promise<{ text: string; provider: string }> {
  const configs = [
    {
      name: "Gemini Primary",
      type: "gemini",
      key: process.env.GEMINI_API_KEY,
      model: "gemini-1.5-flash"
    },
    {
      name: "Gemini Fallback",
      type: "gemini",
      key: process.env.GEMINI_API_KEY_FALLBACK,
      model: "gemini-1.5-flash"
    },
    {
      name: "OpenAI",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      key: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini"
    },
    {
      name: "Groq Primary",
      type: "openai-compatible",
      baseUrl: "https://api.groq.com/openai/v1",
      key: process.env.GROQ_API_KEY,
      model: "llama-3.2-11b-vision-preview"
    },
    {
      name: "Groq Fallback",
      type: "openai-compatible",
      baseUrl: "https://api.groq.com/openai/v1",
      key: process.env.GROQ_API_KEY_FALLBACK,
      model: "llama-3.2-11b-vision-preview"
    },
    {
      name: "OpenRouter",
      type: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      key: process.env.OPENROUTER_API_KEY,
      model: "google/gemma-2-9b-it:free"
    }
  ];

  for (const config of configs) {
    if (!config.key) {
      continue;
    }

    try {
      console.log(`[AI Failover Engine] Attempting request using ${config.name}...`);
      let resultText = "";
      if (config.type === "gemini") {
        resultText = await callGemini(config.key, req.prompt, req.image);
      } else {
        resultText = await callOpenAICompatible(
          config.baseUrl!,
          config.key,
          config.model,
          req.prompt,
          req.image
        );
      }
      
      console.log(`[AI Failover Engine] ✅ Success with ${config.name}!`);
      return { text: resultText, provider: config.name };
    } catch (err: any) {
      console.error(`[AI Failover Engine] ❌ ${config.name} failed:`, err.message || err);
    }
  }

  throw new Error("All AI API Providers failed or rate-limited.");
}

export interface ExtractedIntent {
  intent: "CREATE_ESCROW" | "CREATE_PROPOSAL" | "DIRECT_SPEND" | "HELP" | "UNKNOWN";
  params: {
    amount?: number;
    recipient?: string;
    itemType?: "digital" | "physical";
    taskDescription?: string;
  };
}

/**
 * Parses natural language input to extract financial intents.
 */
export async function parseMessageIntent(text: string): Promise<ExtractedIntent> {
  const lowercaseText = text.toLowerCase();

  // 1. Check for Help commands first
  if (lowercaseText.includes("help") || lowercaseText === "/start" || lowercaseText.includes("info")) {
    return { intent: "HELP", params: {} };
  }

  // 2. Try Failover AI parsing
  try {
    const prompt = `
      Analyze the following Telegram message and extract the user's intent and parameters.
      We have three main actions:
      1. CREATE_ESCROW: User wants to buy something from a seller, or setup an escrow. E.g., "buy a logo from @alice for 50 USDC" or "setup physical escrow for 100 USDC with @bob".
      2. CREATE_PROPOSAL: User wants to propose a group treasury pool spend. E.g., "propose to pay @charlie 100 USDC for server costs".
      3. DIRECT_SPEND: User wants to pay someone immediately from their daily limit. E.g., "pay @dave 5 USDC".

      Return ONLY a JSON object with this exact structure:
      {
        "intent": "CREATE_ESCROW" | "CREATE_PROPOSAL" | "DIRECT_SPEND" | "UNKNOWN",
        "params": {
          "amount": number (extracted USDC value),
          "recipient": string (username like "@alice" or address like "0x..."),
          "itemType": "digital" | "physical" (default to "digital" unless "in person", "physical", "meetup" is specified),
          "taskDescription": string (brief description of what is being bought/spent on)
        }
      }

      Message to parse: "${text}"
    `;

    const { text: responseText, provider } = await callAIWithFailover({ prompt });
    return JSON.parse(responseText.trim()) as ExtractedIntent;
  } catch (error) {
    console.error("AI parsing failed, falling back to rule-based parsing:", error);
  }

  // 3. Fallback: Rule-based regex parser
  return ruleBasedParse(text);
}

function ruleBasedParse(text: string): ExtractedIntent {
  const lowercaseText = text.toLowerCase();

  // Pattern: pay/buy/escrow <amount> usdc (from/to/with) <recipient> (for) <description>
  // E.g., "buy logo from @alice for 50 usdc" or "pay @bob 10 usdc"
  
  // Extract amount
  const amountRegex = /(\d+(?:\.\d+)?)\s*(?:usdc|dollars|\$)/i;
  const amountMatch = text.match(amountRegex);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

  // Extract recipient (Telegram username starting with @ or hex address)
  const recipientRegex = /(@\w+)|(0x[a-fA-F0-9]{40})/i;
  const recipientMatch = text.match(recipientRegex);
  const recipient = recipientMatch ? recipientMatch[0] : undefined;

  // Detect physical vs digital
  const isPhysical = lowercaseText.includes("in person") || 
                     lowercaseText.includes("physical") || 
                     lowercaseText.includes("meetup") ||
                     lowercaseText.includes("local");

  const itemType = isPhysical ? "physical" : "digital";

  // Determine intent
  if (lowercaseText.includes("propose") || lowercaseText.includes("proposal") || lowercaseText.includes("vote")) {
    return {
      intent: "CREATE_PROPOSAL",
      params: { amount, recipient, taskDescription: extractDescription(text) }
    };
  }

  if (lowercaseText.includes("escrow") || lowercaseText.includes("buy") || lowercaseText.includes("handshake")) {
    return {
      intent: "CREATE_ESCROW",
      params: { amount, recipient, itemType, taskDescription: extractDescription(text) }
    };
  }

  if (lowercaseText.includes("pay") || lowercaseText.includes("send") || lowercaseText.includes("transfer")) {
    // If it's a small amount, we can assume direct spend, otherwise default to escrow
    const isDirect = amount !== undefined && amount <= 20;
    return {
      intent: isDirect ? "DIRECT_SPEND" : "CREATE_ESCROW",
      params: { amount, recipient, itemType, taskDescription: extractDescription(text) }
    };
  }

  return { intent: "UNKNOWN", params: {} };
}

function extractDescription(text: string): string {
  // Simple heuristic: look for "for <text>" or "to <text>" after the amount or recipient
  const forMatch = text.match(/for\s+(.+)$/i);
  if (forMatch) return forMatch[1].trim();

  const toMatch = text.match(/(?:buy|pay)\s+(?:from|to\s+)?(?:@\w+|0x[a-f0-9]+)?\s*(.+)$/i);
  if (toMatch) return toMatch[1].trim();

  return "Handshake Deal";
}

/**
 * Downloads a file from a URL and returns it as a base64-encoded string with its MIME type.
 */
async function fetchFileAsBase64(fileUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  if (!fileUrl) return null;
  if (fileUrl.startsWith("data:")) {
    try {
      const parts = fileUrl.split(",");
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const base64 = parts[1] || "";
      return { base64, mimeType };
    } catch (e) {
      return null;
    }
  }

  return new Promise((resolve) => {
    const protocol = fileUrl.startsWith("https") ? https : http;
    protocol.get(fileUrl, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchFileAsBase64(res.headers.location).then(resolve);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString("base64");
        const contentType = res.headers["content-type"] || "application/octet-stream";
        const mimeType = contentType.split(";")[0].trim();
        resolve({ base64, mimeType });
      });
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

export interface VerificationResult {
  isApproved: boolean;
  reason: string;
  usedAI: boolean;
}

/**
 * Verifies a submitted deliverable against the job description.
 * Uses Gemini Vision if available; falls back to extension-based heuristics.
 */
export async function verifyDeliverable(
  fileUrl: string,
  fileName: string,
  jobDescription: string
): Promise<VerificationResult> {
  const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";

  // Try Failover AI Vision path
  try {
    console.log(`🔍 Downloading deliverable for AI vision check: ${fileUrl}`);
    const fileData = await fetchFileAsBase64(fileUrl);

    if (fileData) {
      const prompt = `
You are an autonomous escrow verification agent for a freelance marketplace.
Your task is to decide whether the uploaded deliverable satisfies the job requirements.

Job Description / Spec:
"${jobDescription}"

Uploaded File Name: "${fileName}"
File Extension: ".${fileExtension}"

Instructions:
1. Look at the uploaded file carefully.
2. Check if it matches the requirements in the job description (e.g., file type, content, quality).
3. Respond ONLY with a JSON object in this exact format — no extra text:
{
  "approved": true | false,
  "reason": "A clear, one-sentence explanation of your verdict."
}
`;

      const { text: responseText, provider } = await callAIWithFailover({
        prompt,
        image: {
          base64: fileData.base64,
          mimeType: fileData.mimeType
        }
      });

      const parsed = JSON.parse(responseText.trim());
      console.log(`🤖 AI (${provider}) verdict: ${parsed.approved ? "✅ APPROVED" : "❌ REJECTED"} — ${parsed.reason}`);

      return {
        isApproved: !!parsed.approved,
        reason: parsed.reason || (parsed.approved ? `Deliverable verified by ${provider}.` : `Deliverable rejected by ${provider}.`),
        usedAI: true,
      };
    }
  } catch (error: any) {
    console.error("AI Vision verification failed, falling back to heuristic:", error.message || error);
  }

  // ─── Heuristic fallback ───────────────────────────────────────────────────
  console.warn("⚠️ Gemini Vision unavailable — using heuristic file extension check.");

  const descLower = jobDescription.toLowerCase();

  // Check for explicit file type requirements in the description
  const fileTypePatterns: Record<string, string[]> = {
    svg: ["svg"],
    png: ["png"],
    pdf: ["pdf"],
    jpg: ["jpg", "jpeg"],
    mp4: ["mp4", "video"],
    zip: ["zip", "archive"],
    mp3: ["mp3", "audio"],
  };

  for (const [ext, keywords] of Object.entries(fileTypePatterns)) {
    if (keywords.some((kw) => descLower.includes(kw))) {
      if (fileExtension !== ext) {
        return {
          isApproved: false,
          reason: `Job requires a .${ext} file but received a .${fileExtension} file.`,
          usedAI: false,
        };
      }
      break;
    }
  }

  return {
    isApproved: true,
    reason: "Deliverable file type matches job requirements. (Heuristic check — set GEMINI_API_KEY for full AI verification.)",
    usedAI: false,
  };
}
