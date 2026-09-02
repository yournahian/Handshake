import { NextRequest, NextResponse } from "next/server";
import { callAI, getAISettings } from "@/lib/adminSettings";

export async function POST(req: NextRequest) {
  try {
    const { description, type } = await req.json();

    if (!description?.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const settings = getAISettings();

    // Fallback if no active API key
    if (!settings.apiKey) {
      return NextResponse.json({
        plainSummary: description,
        priceRange: { min: null, max: null },
        riskFlags: [],
        suggestions: [],
      });
    }

    const prompt = `You are an escrow contract assistant for Handshake, a USDC peer-to-peer escrow platform on Arc blockchain.

Analyze this job/escrow description and respond in JSON only (no markdown):
Description: "${description}"
Type: ${type === "physical" ? "Physical meetup (in-person exchange)" : "Digital/OTC escrow"}

Respond with EXACTLY this JSON structure:
{
  "plainSummary": "2-3 sentence plain-language summary of what this escrow is for",
  "priceRange": { "min": <number or null>, "max": <number or null> },
  "estimatedDuration": "<time estimate like '1-3 days' or null>",
  "riskFlags": ["<risk flag 1>", "<risk flag 2>"],
  "suggestions": ["<tip 1>", "<tip 2>"]
}

Price range should be in USDC. Only flag real risks (vague description, unrealistic amount, no deliverable defined). Keep riskFlags empty array if no issues. Maximum 2 risk flags and 2 suggestions.`;

    const raw = await callAI(prompt);
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        plainSummary: description,
        priceRange: { min: null, max: null },
        riskFlags: [],
        suggestions: [],
      });
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error("[AI Summarize]", err);
    return NextResponse.json({ error: err.message || "AI error" }, { status: 500 });
  }
}
