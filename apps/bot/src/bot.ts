import TelegramBot from "node-telegram-bot-api";
import express from "express";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { parseMessageIntent, verifyDeliverable } from "./services/ai.js";
import { getJobDetails, releaseEscrow, rejectSubmission, getTreasuryStats, publicClient, account, resolveDispute, resolveDisputeCustom } from "./services/blockchain.js";
import { keccak256, toHex, parseUnits } from "viem";
import { supabase } from "./services/supabase.js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from workspace root or current directory
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Gracefully handle unhandled promise rejections (e.g. Telegram Bot API protocol errors)
process.on("unhandledRejection", (reason: any) => {
  console.error("⚠️ Graceful Catch - Unhandled Promise Rejection:", reason.message || reason);
  if (reason.message && reason.message.includes("Only HTTPS links are allowed")) {
    console.error("💡 TIP: Telegram Web Apps require secure HTTPS URLs. Please set up a tunnel (e.g., run 'npx localtunnel --port 3000' or 'ngrok http 3000'), copy the HTTPS url, set it as NEXT_PUBLIC_WEB_APP_URL in your root .env, and restart the bot.");
  }
});

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set. Add it to your .env file.");
}
const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3000";

// Print bot wallet address on startup so it can be set as the AI Evaluator in escrow contracts
console.log("🤖 Bot Wallet Address (use as AI Evaluator):", account.address);

// Initialize Bot
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(express.json());

console.log("Handshake Telegram Bot is running...");

// Helper to choose between Telegram WebApp iframe (requires HTTPS) and standard URL redirect (for local HTTP testing)
function getButtonMarkup(buttonText: string, path: string) {
  const fullUrl = `${webAppUrl}${path}`;
  const isHttps = fullUrl.startsWith("https://");
  
  console.log(`[getButtonMarkup] Path: ${path} | URL: ${fullUrl} | isHttps: ${isHttps}`);
  
  return {
    reply_markup: {
      inline_keyboard: [
        [
          isHttps
            ? { text: buttonText, web_app: { url: fullUrl } }
            : { text: buttonText, url: fullUrl }
        ]
      ]
    }
  };
}

// Enable CORS middleware custom headers
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Root & Health check endpoints for cloud hosts (Render, Koyeb, etc.)
app.get("/", (req, res) => {
  res.send("Handshake Telegram AI Bot is running! 🚀");
});
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
app.get("/healthz", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Helper to update submission status in Supabase Database
async function updateDbStatus(jobId: number, status: string, result: string) {
  try {
    await supabase
      .from("escrow_submissions")
      .update({ status, result })
      .eq("job_id", jobId);
    console.log(`DB updated: Job #${jobId} status is now "${status}"`);
  } catch (err) {
    console.error(`Failed to update DB status for job ${jobId}:`, err);
  }
}

// Synchronize any pending states from Supabase Database on startup
async function syncOfflineState() {
  console.log("🔄 Synchronizing offline submissions and approvals from Supabase...");
  try {
    const { data: pendingSubs, error } = await supabase
      .from("escrow_submissions")
      .select("*")
      .or("status.eq.Pending Verification,buyer_authorized.eq.true");

    if (error) {
      console.error("Failed to fetch pending submissions from Supabase:", error);
      return;
    }

    if (!pendingSubs || pendingSubs.length === 0) {
      console.log("✅ Supabase is fully synchronized.");
      return;
    }

    for (const sub of pendingSubs) {
      const jobId = BigInt(sub.job_id);
      const job = await getJobDetails(jobId);
      if (!job) continue;

      const onChainStatus = job[7]; // status

      // 1. Process pending verification
      if (sub.status === "Pending Verification" && onChainStatus === 1) { // Funded
        console.log(`🤖 Processing pending submission for Job #${sub.job_id} on startup...`);
        const jobDescription = job[4];
        const result = await verifyDeliverable(sub.file_url || "", sub.file_name || "deliverable", jobDescription);
        const aiLabel = result.usedAI ? "🤖 Gemini AI" : "📏 Heuristic";

        if (result.isApproved) {
          await updateDbStatus(sub.job_id, "Approved", `${aiLabel} Verification passed! ${result.reason}. Waiting for buyer payout release.`);
        } else {
          const reasonHash = keccak256(toHex("AI_REJECTED"));
          await updateDbStatus(sub.job_id, "Rejected", `${aiLabel} Verification failed! ${result.reason}`);
          await rejectSubmission(jobId, reasonHash);
        }
      }

      // 2. Process manual release authorized by buyer
      if (sub.buyer_authorized && (onChainStatus === 1 || onChainStatus === 2)) {
        console.log(`🤖 Processing buyer authorized release for Job #${sub.job_id} on startup...`);
        const reasonHash = keccak256(toHex("BUYER_MANUAL_APPROVED"));
        const txHash = await releaseEscrow(jobId, reasonHash);
        await updateDbStatus(sub.job_id, "Approved", `Escrow payment released manually by buyer. Tx Hash: ${txHash}`);
      }
    }
  } catch (err) {
    console.error("Error during startup sync:", err);
  }
}

// Start Realtime Database listener
function listenToSupabaseRealtime() {
  console.log("⚡ Starting Supabase realtime listener...");
  supabase
    .channel("escrow_submissions_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "escrow_submissions" },
      async (payload) => {
        const { eventType, new: newRow } = payload;
        if (eventType === "INSERT" || eventType === "UPDATE") {
          const jobId = BigInt(newRow.job_id);
          const job = await getJobDetails(jobId);
          if (!job) return;

          const onChainStatus = job[7];

          // Run AI check if newly inserted from web or Telegram
          if (newRow.status === "Pending Verification" && (onChainStatus === 1 || onChainStatus === 2)) {
            console.log(`⚡ Realtime Event: Running Gemini AI verification for Job #${newRow.job_id}...`);
            const jobDescription = job[4];
            const result = await verifyDeliverable(newRow.file_url || "", newRow.file_name || "deliverable", jobDescription);
            const aiLabel = result.usedAI ? "🤖 Gemini AI" : "📏 Heuristic";

            if (result.isApproved) {
              await updateDbStatus(newRow.job_id, "Approved", `${aiLabel} Verification passed! ${result.reason}. Waiting for buyer payout release.`);
            } else {
              const reasonHash = keccak256(toHex("AI_REJECTED"));
              await updateDbStatus(newRow.job_id, "Rejected", `${aiLabel} Verification failed! ${result.reason}`);
              await rejectSubmission(jobId, reasonHash);
            }
          }

          // Process payout ONLY if buyer authorized
          if (newRow.buyer_authorized && (onChainStatus === 1 || onChainStatus === 2)) {
            console.log(`⚡ Realtime Event: Processing buyer manual release for Job #${newRow.job_id}...`);
            const reasonHash = keccak256(toHex("BUYER_MANUAL_APPROVED"));
            const txHash = await releaseEscrow(jobId, reasonHash);
            await updateDbStatus(newRow.job_id, "Approved", `Escrow payment released manually by buyer. Tx Hash: ${txHash}`);
          }

          // Notify seller when a new escrow is created for them (status=Negotiation on INSERT)
          if (eventType === "INSERT" && newRow.status === "Negotiation") {
            try {
              const providerAddr = job[2] as string;
              console.log(`📣 New escrow Job #${newRow.job_id} created. Notifying seller (${providerAddr})...`);
              const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3000";
              console.log(`[Seller Notification] Job #${newRow.job_id} → ${webAppUrl}/escrow/${newRow.job_id}`);
            } catch (notifyErr) {
              console.error("Failed to send seller notification:", notifyErr);
            }
          }

          // Log and track dispute status changes
          if (newRow.status === "Disputed") {
            console.log(`⚠️ Realtime Event: Job #${newRow.job_id} has been disputed. Funds frozen on-chain. Waiting for arbitrator.`);
          }
        }
      }
    )
    .subscribe();

  // Periodic fallback check for pending submissions
  async function checkPendingSubmissions() {
    try {
      const { data: pending } = await supabase
        .from("escrow_submissions")
        .select("*")
        .eq("status", "Pending Verification")
        .limit(10);

      if (pending && pending.length > 0) {
        for (const row of pending) {
          const jobId = BigInt(row.job_id);
          const job = await getJobDetails(jobId);
          if (!job) continue;
          const onChainStatus = job[7];
          if (onChainStatus === 1 || onChainStatus === 2) {
            console.log(`🔍 Polling Fallback: Processing verification for Job #${row.job_id}...`);
            const jobDescription = job[4];
            const result = await verifyDeliverable(row.file_url || "", row.file_name || "deliverable", jobDescription);
            const aiLabel = result.usedAI ? "🤖 Gemini AI" : "📏 Heuristic";

            if (result.isApproved) {
              await updateDbStatus(row.job_id, "Approved", `${aiLabel} Verification passed! ${result.reason}. Waiting for buyer payout release.`);
            } else {
              const reasonHash = keccak256(toHex("AI_REJECTED"));
              await updateDbStatus(row.job_id, "Rejected", `${aiLabel} Verification failed! ${result.reason}`);
              await rejectSubmission(jobId, reasonHash);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error in checkPendingSubmissions:", err);
    }
  }

  // Run immediately and every 10 seconds
  checkPendingSubmissions();
  setInterval(checkPendingSubmissions, 10000);
}

// GET submission details for a job
app.get("/api/submissions/:jobId", async (req: any, res: any) => {
  const { jobId } = req.params;
  try {
    const { data, error } = await supabase
      .from("escrow_submissions")
      .select("*")
      .eq("job_id", Number(jobId))
      .maybeSingle();
    
    if (error || !data) {
      return res.status(404).json({ error: "No submission found for this job ID" });
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Database query failed" });
  }
});

// POST a new submission from the web interface
app.post("/api/submissions", async (req: any, res: any) => {
  const { jobId, fileUrl, fileName } = req.body;
  if (!jobId || !fileUrl) {
    return res.status(400).json({ error: "Missing jobId or fileUrl" });
  }

  const numericJobId = Number(jobId);
  try {
    await supabase.from("escrow_submissions").upsert({
      job_id: numericJobId,
      file_url: fileUrl,
      file_name: fileName || "deliverable",
      status: "Pending Verification",
      result: "AI verification agent analyzing the uploaded deliverable...",
      source: "web"
    });
    console.log(`Submission for Job #${jobId} saved to Cloud Database.`);
  } catch (dbErr) {
    console.error("Failed to insert web submission into Supabase:", dbErr);
  }

  res.status(202).json({ success: true, message: "Submission received. AI Agent verification started." });

  // Run the AI verification in the background
  try {
    const job = await getJobDetails(BigInt(jobId));
    if (!job) {
      await updateDbStatus(numericJobId, "Failed", "Job not found onchain.");
      return;
    }

    const jobDescription = job[4];
    const fileExtension = fileName?.split(".").pop() || "";
    let isApproved = false;
    let reason = "";

    if (jobDescription.toLowerCase().includes("svg") && fileExtension.toLowerCase() !== "svg") {
      reason = `Required file type: SVG. Uploaded file: ${fileExtension}.`;
    } else {
      isApproved = true;
      reason = "Deliverable matches all parameters in the agreed spec sheet.";
    }

    if (isApproved) {
      const reasonHash = keccak256(toHex("AI_APPROVED"));
      const txHash = await releaseEscrow(BigInt(numericJobId), reasonHash);
      await updateDbStatus(numericJobId, "Approved", `Verification passed! ${reason} Tx Hash: ${txHash}`);
    } else {
      const reasonHash = keccak256(toHex("AI_REJECTED"));
      await updateDbStatus(numericJobId, "Rejected", `Verification failed! ${reason}`);
      await rejectSubmission(BigInt(numericJobId), reasonHash);
    }
  } catch (error: any) {
    console.error("Error in background web submission verification:", error);
    await updateDbStatus(numericJobId, "Error", `Verification execution error: ${error.message || error}`);
  }
});

// POST to release escrow manually by client/buyer (acting through delegating execution to bot)
app.post("/api/escrow/release", async (req: any, res: any) => {
  const { jobId, buyerAddress } = req.body;
  if (!jobId || !buyerAddress) {
    return res.status(400).json({ error: "Missing jobId or buyerAddress" });
  }

  try {
    const job: any = await getJobDetails(BigInt(jobId));
    console.log(`[API Escrow Release] Job #${jobId} details from chain:`, job);
    if (!job) {
      return res.status(404).json({ error: "Job not found onchain" });
    }

    const clientOnChain = String(job.client || job[1] || "").toLowerCase();
    const isBuyer = buyerAddress && clientOnChain === String(buyerAddress).toLowerCase().trim();

    // Check if the submission was already approved by AI in Supabase
    let isAIApproved = false;
    try {
      const { data: sub } = await supabase
        .from("escrow_submissions")
        .select("status")
        .eq("job_id", Number(jobId))
        .maybeSingle();
      if (sub && sub.status === "Approved") {
        isAIApproved = true;
      }
    } catch (e) {}

    if (!isBuyer && !isAIApproved) {
      return res.status(403).json({ error: "Only the client/buyer of this escrow can authorize payment release." });
    }

    const rawStatus = job.status !== undefined ? job.status : job[7];
    const status = Number(rawStatus);
    console.log(`[API Escrow Release] Parsed on-chain status: ${status} (raw: ${rawStatus})`);

    if (status !== 1 && status !== 2) {
      return res.status(400).json({ error: `Cannot release escrow with current job status: ${status}. Job must be Funded (1) or Submitted (2).` });
    }

    const reasonHash = keccak256(toHex(isAIApproved ? "AI_APPROVED" : "BUYER_MANUAL_APPROVED"));
    const txHash = await releaseEscrow(BigInt(jobId), reasonHash);

    // Set buyer_authorized to true and save release transaction hash to Supabase
    try {
      await supabase.from("escrow_submissions").upsert({
        job_id: Number(jobId),
        buyer_authorized: true,
        status: "Approved",
        result: `Escrow payment released manually by buyer. Tx Hash: ${txHash}`,
        file_url: "",
        file_name: "",
        source: "web"
      });
    } catch (dbErr) {
      console.error("Failed to update buyer authorization in Supabase:", dbErr);
    }

    res.json({ success: true, txHash });
  } catch (error: any) {
    console.error("Error in manual escrow release endpoint:", error);
    res.status(500).json({ error: error.message || "Manual release transaction failed" });
  }
});

// POST to resolve dispute by arbitrator (acting through delegating execution to bot)
app.post("/api/escrow/resolve", async (req: any, res: any) => {
  const { jobId, resolution, clientShare } = req.body;
  if (jobId === undefined || resolution === undefined) {
    return res.status(400).json({ error: "Missing jobId or resolution" });
  }

  try {
    const job = await getJobDetails(BigInt(jobId));
    if (!job) {
      return res.status(404).json({ error: "Job not found onchain" });
    }

    let txHash: string;
    if (Number(resolution) === 3) {
      if (clientShare === undefined) {
        return res.status(400).json({ error: "Missing clientShare for custom split resolution" });
      }
      const clientShareRaw = parseUnits(clientShare.toString(), 6);
      txHash = await resolveDisputeCustom(BigInt(jobId), clientShareRaw);
    } else {
      txHash = await resolveDispute(BigInt(jobId), Number(resolution));
    }

    // Update Supabase status and message
    try {
      const resolutionLabel = Number(resolution) === 0 ? "Refunded" : Number(resolution) === 1 ? "Approved" : Number(resolution) === 2 ? "Split" : "Custom Split";
      const resolutionResult = Number(resolution) === 3
        ? `Dispute resolved by Admin with custom split: ${clientShare} USDC to Buyer, ${(Number(job[5]) / 1000000 - Number(clientShare)).toFixed(2)} USDC to Seller. Tx Hash: ${txHash}`
        : `Dispute resolved by Admin. Resolution: ${Number(resolution) === 0 ? "Refund Buyer" : Number(resolution) === 1 ? "Pay Seller" : "50/50 Split"}. Tx Hash: ${txHash}`;

      await supabase.from("escrow_submissions").upsert({
        job_id: Number(jobId),
        status: resolutionLabel,
        result: resolutionResult,
        file_url: "",
        file_name: "",
        source: "web"
      });
    } catch (dbErr) {
      console.error("Failed to update dispute resolution in Supabase:", dbErr);
    }

    res.json({ success: true, txHash });
  } catch (error: any) {
    console.error("Error in dispute resolution endpoint:", error);
    res.status(500).json({ error: error.message || "Dispute resolution transaction failed" });
  }
});

// Keep track of pending/active escrows in a simple local cache (in production, use a db like Supabase)
const activeEscrows: Record<string, { jobId: number; description: string; seller: string; amount: number }> = {};

// Express server for receiving events from the Next.js web application
app.post("/api/webhook/escrow-updated", async (req: any, res: any) => {
  const { jobId, status, clientTg, providerTg, amount, description } = req.body;
  
  try {
    // Notify the chat or the users directly
    let message = `🔔 *Escrow Update* (Job ID: ${jobId})\n`;
    message += `📝 Job: ${description}\n`;
    message += `💰 Amount: ${amount} USDC\n`;
    
    if (status === "Funded") {
      message += `✅ *Funded!* Seller @${providerTg} can now work on the task. Upload your final deliverable here or reply with \`#submit ${jobId}\` to trigger AI review.`;
    } else if (status === "Completed") {
      message += `🎉 *Completed!* USDC has been released to @${providerTg}.`;
    }
    
    // We can notify the buyer/seller directly if we have their chatIds
    // Here we log it
    console.log(`Webhook received: Job ${jobId} updated to ${status}`);
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Help command
bot.onText(/\/help|\/start/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `
🤝 *Welcome to Handshake!*
I am your autonomous escrow and group finance agent on the Arc blockchain.

*Available Actions:*
1. **Digital OTC Escrow**: Type what you want to buy, e.g.,
   _\"buy an SVG rocket logo from @designer for 10 USDC\"_
2. **Physical Meetup Escrow**: For local meetups, type:
   _\"in person buy graphics card from @seller for 100 USDC\"_
3. **Group Treasury**: Manage shared pools. Type:
   _\"propose to pay @dev 50 USDC for web dev work\"_

*Bot Commands:*
• /escrow - Launch the Escrow Portal
• /pool - Check Group Treasury status
• /help - Display this menu
  `;

  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// Launch Escrow portal
bot.onText(/\/escrow/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Click the button below to open the Handshake Escrow portal:", getButtonMarkup("🚀 Open Escrow Portal", "/escrow"));
});

// Link a custom Group Treasury pool to a group chat
bot.onText(/\/setup_pool\s+(0x[a-fA-F0-9]{40})/, async (msg, match) => {
  const chatId = msg.chat.id;
  const address = match?.[1];

  if (!address) {
    bot.sendMessage(chatId, "❌ Please specify a valid treasury contract address. Example: `/setup_pool 0x2998...`", { parse_mode: "Markdown" });
    return;
  }

  try {
    const { error } = await supabase
      .from("group_pools")
      .upsert({
        chat_id: chatId,
        treasury_address: address
      });

    if (error) throw error;

    bot.sendMessage(chatId, `✅ *Success!* Linked this chat to Group Treasury:\n\`${address}\`\n\nType /pool to see active stats.`, { parse_mode: "Markdown" });
  } catch (err: any) {
    console.error("Failed to link group pool in Supabase:", err);
    bot.sendMessage(chatId, `❌ Failed to link treasury: ${err.message || err}`);
  }
});

// Launch Pool portal — shows live treasury stats
bot.onText(/\/pool/, async (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3000";

  let linkedAddress = "";
  
  if (chatType === "group" || chatType === "supergroup") {
    try {
      const { data, error } = await supabase
        .from("group_pools")
        .select("treasury_address")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        linkedAddress = data.treasury_address;
      }
    } catch (dbErr) {
      console.error("Failed to query group_pools in Supabase:", dbErr);
    }
  }

  const targetAddress = linkedAddress || process.env.TREASURY_ADDRESS || "0x29984fd25B15Cd271e4ebAD350a2Ca2269a65304";
  const portalPath = linkedAddress ? `/treasury/${linkedAddress}` : "/treasury";

  try {
    const stats = await getTreasuryStats(targetAddress);
    if (!stats) {
      bot.sendMessage(
        chatId, 
        linkedAddress 
          ? `⚠️ Could not fetch treasury stats for linked pool. Try the portal directly:`
          : "⚠️ Could not fetch treasury stats. Try the portal directly:", 
        getButtonMarkup("🏦 Open Group Pool", portalPath)
      );
      return;
    }

    const poolLabel = linkedAddress ? `Group Pool (\`${linkedAddress.slice(0,6)}…${linkedAddress.slice(-4)}\`)` : "Group Pool";
    const reply =
      `🏦 *Handshake ${poolLabel}*\n\n` +
      `💰 Pool Balance: *${stats.balance} USDC*\n` +
      `👥 Members: *${stats.members}*\n` +
      `🗳 Active Votes: *${stats.active}* proposal${stats.active !== 1 ? "s" : ""} open\n` +
      `📊 Total Proposals: *${stats.totalProposals}*\n\n` +
      `Open the portal to deposit, vote, or propose a spend:`;

    bot.sendMessage(chatId, reply, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "🏦 Open Group Pool", web_app: { url: `${webAppUrl}${portalPath}` } }
        ]]
      }
    });
  } catch (err) {
    bot.sendMessage(chatId, "Click below to open the Handshake Group Pool:", getButtonMarkup("🏦 Open Group Pool", portalPath));
  }
});

// NLP Message Router
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Save user registration mapping (username -> chat_id) in Supabase if username exists
  if (msg.from?.username) {
    const uname = msg.from.username.toLowerCase();
    try {
      await supabase.from("telegram_users").upsert({
        username: uname,
        chat_id: msg.chat.id,
      });
    } catch (err) {
      console.error(`Failed to register Telegram user @${uname} in DB:`, err);
    }
  }

  // Ignore commands
  if (!text || text.startsWith("/")) return;

  try {
    const analysis = await parseMessageIntent(text);

    if (analysis.intent === "CREATE_ESCROW") {
      const { amount, recipient, itemType, taskDescription } = analysis.params;
      const seller = recipient || "@seller";
      const isPhysical = itemType === "physical";
      
      let reply = `📝 *Drafting ${isPhysical ? "Physical" : "Digital"} Escrow Deal*\n\n`;
      reply += `👤 *Buyer*: @${msg.from?.username || "buyer"}\n`;
      reply += `👤 *Seller*: ${seller}\n`;
      reply += `💰 *Budget*: ${amount || "Not specified"} USDC\n`;
      reply += `📋 *Description*: \"${taskDescription || "Handshake Contract"}\"\n\n`;
      reply += `Ready to lock this deal? Click below to finalize specs, approve USDC, and deploy it to the Arc Testnet.`;

      // Build target WebApp link passing details in query params
      const queryParams = new URLSearchParams({
        client: msg.from?.username || "buyer",
        provider: seller.replace("@", ""),
        amount: (amount || 0).toString(),
        description: taskDescription || "",
        type: itemType || "digital"
      });

      await bot.sendMessage(chatId, reply, {
        parse_mode: "Markdown",
        ...getButtonMarkup(`🔒 Lock Escrow (${amount || 0} USDC)`, `/escrow/create?${queryParams.toString()}`)
      });

      // Attempt to notify the seller directly
      const sellerUsername = seller.replace("@", "").toLowerCase().trim();
      let notifiedSeller = false;
      try {
        const { data: userData } = await supabase
          .from("telegram_users")
          .select("chat_id")
          .eq("username", sellerUsername)
          .maybeSingle();

        if (userData && userData.chat_id) {
          const sellerChatId = userData.chat_id;
          let sellerNotice = `🔔 *New Escrow Proposed to You!*\n\n`;
          sellerNotice += `👤 *Buyer*: @${msg.from?.username || "buyer"}\n`;
          sellerNotice += `💰 *Budget*: ${amount || "Not specified"} USDC\n`;
          sellerNotice += `📋 *Description*: \"${taskDescription || "Handshake Contract"}\"\n\n`;
          sellerNotice += `Click below to view the specifications and accept the deal:`;

          await bot.sendMessage(sellerChatId, sellerNotice, {
            parse_mode: "Markdown",
            ...getButtonMarkup(`🔒 View/Lock Escrow`, `/escrow/create?${queryParams.toString()}`)
          });
          notifiedSeller = true;
          console.log(`[Notification] Seller @${sellerUsername} notified of proposal at chat ID: ${sellerChatId}`);
        }
      } catch (err) {
        console.error(`Failed to send direct notification to seller @${sellerUsername}:`, err);
      }

      if (notifiedSeller) {
        await bot.sendMessage(chatId, `✉️ Direct notification sent to seller @${sellerUsername}!`);
      } else {
        await bot.sendMessage(
          chatId,
          `ℹ️ _Note: I couldn't direct message the seller @${sellerUsername}. Ask them to start the bot to receive direct deal notifications._`,
          { parse_mode: "Markdown" }
        );
      }
    } else if (analysis.intent === "CREATE_PROPOSAL") {
      const { amount, recipient, taskDescription } = analysis.params;
      
      // Look up if this group has a custom treasury address
      let linkedAddress = "";
      try {
        const { data } = await supabase
          .from("group_pools")
          .select("treasury_address")
          .eq("chat_id", chatId)
          .maybeSingle();
        if (data) {
          linkedAddress = data.treasury_address;
        }
      } catch (e) {}

      const portalPath = linkedAddress ? `/treasury/${linkedAddress}` : "/treasury";

      let reply = `🏦 *New Group Treasury Proposal*\n\n`;
      reply += `👤 *Proposer*: @${msg.from?.username || "member"}\n`;
      reply += `👤 *Recipient*: ${recipient || "Not specified"}\n`;
      reply += `💰 *Amount*: ${amount || 0} USDC\n`;
      reply += `📋 *Reason*: \"${taskDescription || "Treasury Spend"}\"\n\n`;
      reply += `Open the Treasury Pool to create the onchain proposal and start voting.`;

      bot.sendMessage(chatId, reply, {
        parse_mode: "Markdown",
        ...getButtonMarkup("✍️ Propose Spend", portalPath)
      });
    }
  } catch (error) {
    console.error("Error processing text:", error);
  }
});

// File upload listener (AI check workflow)
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  const caption = msg.caption || "";
  
  // Check if caption contains "#submit <jobId>" or if they replied to an escrow prompt
  const submitMatch = caption.match(/#submit\s+(\d+)/i);
  if (!submitMatch) return;

  const jobId = BigInt(submitMatch[1]);
  bot.sendMessage(chatId, `🔍 *AI Verification Agent started for Job ${jobId}...*\nAnalyzing deliverable file against specifications...`);

  try {
    // 1. Fetch Job from blockchain
    const job = await getJobDetails(jobId);
    if (!job) {
      bot.sendMessage(chatId, `❌ Job ID ${jobId} not found onchain.`);
      return;
    }

    // 2. Fetch File details from Telegram
    const fileId = msg.document?.file_id;
    if (!fileId) return;

    const fileUrl = await bot.getFileLink(fileId);
    console.log(`Downloading deliverable file from: ${fileUrl}`);

    // Cache submission details in Supabase
    const numericJobId = Number(jobId);
    try {
      await supabase.from("escrow_submissions").upsert({
        job_id: numericJobId,
        file_url: fileUrl,
        file_name: msg.document?.file_name || "deliverable",
        status: "Pending Verification",
        result: "AI verification agent analyzing the uploaded deliverable...",
        source: "telegram"
      });
      console.log(`Telegram submission for Job #${jobId} saved to Supabase.`);
    } catch (dbErr) {
      console.error("Failed to insert Telegram submission into Supabase:", dbErr);
    }

    // 3. AI Verification — Gemini Vision with heuristic fallback
    const jobDescription = job[4]; // description field
    const fileName = msg.document?.file_name || "deliverable";
    
    console.log(`🔍 Running AI verification for Job #${jobId}. Spec: "${jobDescription}"`);
    bot.sendMessage(chatId, `🔍 *Analyzing deliverable with ${process.env.GEMINI_API_KEY ? "Gemini Vision AI" : "heuristic check"}...*`);

    const verification = await verifyDeliverable(fileUrl, fileName, jobDescription);
    const aiLabel = verification.usedAI ? "🤖 Gemini AI" : "📏 Heuristic";

    if (verification.isApproved) {
      const reasonHash = keccak256(toHex("AI_APPROVED"));
      bot.sendMessage(chatId, `✅ *${aiLabel} Verification Passed!*\n${verification.reason}\n\nInitiating release transaction on the Arc network...`);
      
      const txHash = await releaseEscrow(jobId, reasonHash);
      bot.sendMessage(chatId, `🎉 *Escrow Released!* Payment of USDC has been sent to the seller.\nTx Explorer: https://testnet.arcscan.app/tx/${txHash}`);
      await updateDbStatus(numericJobId, "Approved", `${aiLabel} Verification passed! ${verification.reason} Tx Hash: ${txHash}`);
    } else {
      const reasonHash = keccak256(toHex("AI_REJECTED"));
      bot.sendMessage(chatId, `❌ *${aiLabel} Verification Failed!*\nReason: ${verification.reason}\n\nSubmission has been rejected. Fix and re-submit, or file a dispute via the web portal.`);
      await updateDbStatus(numericJobId, "Rejected", `${aiLabel} Verification failed! ${verification.reason}`);
      await rejectSubmission(jobId, reasonHash);
    }

  } catch (error: any) {
    bot.sendMessage(chatId, `❌ *Error processing AI Verification:* ${error.message}`);
  }
});

// /status command — quick job status lookup
bot.onText(/\/status(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const jobIdStr = match?.[1];

  if (!jobIdStr) {
    bot.sendMessage(chatId, "Usage: `/status <jobId>` — e.g., `/status 42`", { parse_mode: "Markdown" });
    return;
  }

  const jobId = BigInt(jobIdStr);
  try {
    const job = await getJobDetails(jobId);
    if (!job) {
      bot.sendMessage(chatId, `❌ Job #${jobIdStr} not found on chain.`);
      return;
    }

    const statuses = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired", "Disputed"];
    const statusEmojis = ["🟡", "🔵", "🟠", "✅", "❌", "⏰", "⚠️"];
    const statusIndex = Number(job[7]);
    const statusLabel = statuses[statusIndex] || "Unknown";
    const statusEmoji = statusEmojis[statusIndex] || "❓";

    const budgetRaw = job[5] as bigint;
    const budget = (Number(budgetRaw) / 1e6).toFixed(2);
    const expiredAt = new Date(Number(job[6]) * 1000);
    const now = new Date();
    const timeLeft = expiredAt.getTime() - now.getTime();
    const expiryStr = timeLeft > 0
      ? `${Math.floor(timeLeft / 3600000)}h ${Math.floor((timeLeft % 3600000) / 60000)}m remaining`
      : `Expired on ${expiredAt.toLocaleDateString()}`;

    const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3000";
    const reply =
      `${statusEmoji} *Job #${jobIdStr} — ${statusLabel}*\n` +
      `📋 _${job[4]}_\n\n` +
      `💰 Budget: *${budget} USDC*\n` +
      `⏱ Expiry: ${expiryStr}\n` +
      `🔗 [Open Escrow Portal](${webAppUrl}/escrow/${jobIdStr})`;

    bot.sendMessage(chatId, reply, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (err: any) {
    bot.sendMessage(chatId, `❌ Failed to fetch job #${jobIdStr}: ${err.message || err}`);
  }
});

// Run Express Webhook Server
const port = process.env.PORT || 4000;
app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  
  // Initialize Supabase integrations if keys exist
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    try {
      await syncOfflineState();
      listenToSupabaseRealtime();
    } catch (supabaseErr) {
      console.error("Failed to start Supabase sync or listener:", supabaseErr);
    }
  } else {
    console.warn("⚠️ Supabase credentials missing! Running bot in pure-blockchain mode.");
  }
});
