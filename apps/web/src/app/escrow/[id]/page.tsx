"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatUnits, parseUnits, keccak256, toHex, encodeFunctionData } from "viem";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";
import { ShieldAlert, ShieldCheck, Download, Upload, AlertCircle, RefreshCw, DollarSign, Wallet, Clock } from "lucide-react";
import confetti from "canvas-confetti";
import { trackJobId } from "@/lib/escrow-tracking";
import { supabase } from "@/lib/supabase";
import { waitForReceipt } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useCircleWallet } from "@/components/CircleWalletContext";
import { publicClient } from "@/lib/publicClient";
import { ReviewModal } from "@/components/ReviewModal";
import { EscrowChatBidding } from "@/components/EscrowChatBidding";


const DEFAULT_EVALUATOR = process.env.NEXT_PUBLIC_BOT_WALLET_ADDRESS || "0x546c8C7A9d3Db29eb0c194Da0c72631F8a717b00";

export default function EscrowDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { address, isConnected } = useWallet();
  const { executeContractCall } = useCircleWallet();
  const isNumeric = typeof id === "string" && /^\d+$/.test(id);
  const jobId = isNumeric ? BigInt(id as string) : 0n;

  // Local file upload state (for demo and watermarking)
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Seller: set budget state
  const [budgetInput, setBudgetInput] = useState("");
  const [isSettingBudget, setIsSettingBudget] = useState(false);

  // Negotiation state
  const [counterOfferInput, setCounterOfferInput] = useState("");
  const [isCounterOffering, setIsCounterOffering] = useState(false);
  const [localCounterOffer, setLocalCounterOffer] = useState<string | null>(null);
  const [proposedBudget, setProposedBudget] = useState<string | null>(null);

  // Buyer: fund state
  const [isFunding, setIsFunding] = useState(false);
  const [lastSeenBudget, setLastSeenBudget] = useState<string | null>(null);

  // Custom toast notification state and alert helper to replace native browser popups
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Features extensions
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [aiSummary, setAiSummary] = useState<any>(null);
  const [fraudData, setFraudData] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [completedTxHash, setCompletedTxHash] = useState<string | null>(null);
  const [hasReviewed, setHasReviewed] = useState(false);

  const alert = useCallback((message: string) => {
    const lower = message.toLowerCase();
    const isError = lower.includes("failed") || 
                    lower.includes("error") || 
                    lower.includes("offline") || 
                    lower.includes("invalid") || 
                    lower.includes("incorrect") || 
                    lower.includes("wrong") || 
                    lower.includes("not set");
    
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message: message.replace(/\n/g, " "), type: isError ? "error" : "success" });
    
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Read Job details from Arc Testnet contract manually using publicClient
  const [jobRaw, setJobRaw] = useState<any>(null);
  const [isPending, setIsPending] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const data = await publicClient.readContract({
        address: DEPLOYED_ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "jobs",
        args: [jobId],
      });
      setJobRaw(data);
    } catch (err) {
      console.error("Error reading job:", err);
    } finally {
      setIsPending(false);
    }
  }, [jobId]);

  const fetchCompletedTxHash = useCallback(async () => {
    try {
      const logs = await publicClient.getLogs({
        address: DEPLOYED_ESCROW_ADDRESS,
        event: {
          type: "event",
          name: "Completed",
          inputs: [
            { type: "uint256", name: "jobId", indexed: true },
            { type: "bytes32", name: "reason" }
          ]
        },
        args: {
          jobId: jobId
        },
        fromBlock: 0n,
        toBlock: "latest"
      });
      if (logs && logs.length > 0) {
        return logs[0].transactionHash;
      }
    } catch (e) {
      console.error("Failed to query Completed event logs:", e);
    }
    return null;
  }, [jobId]);

  const fetchReviewStatus = useCallback(async () => {
    if (!address || !jobId) return;
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!hasSupabase) return;
    try {
      const { data } = await supabase
        .from("reviews")
        .select("id")
        .eq("escrow_id", Number(jobId))
        .eq("reviewer_address", address.toLowerCase())
        .maybeSingle();
      if (data) {
        setHasReviewed(true);
      }
    } catch (e) {
      console.error(e);
    }
  }, [address, jobId]);

  useEffect(() => {
    fetchReviewStatus();
  }, [fetchReviewStatus]);


  useEffect(() => {
    refetch();
  }, [refetch]);

  // Unified contract writer using Circle Smart Wallet SDK
  const writeContract = useCallback(async (
    contractAddress: string,
    abi: any,
    functionName: string,
    args: any[],
  ): Promise<`0x${string}`> => {
    const calldata = encodeFunctionData({ abi, functionName: functionName as any, args });
    const txHash = await executeContractCall({
      contractAddress,
      abiFunctionSignature: "execute(bytes)",
      abiParameters: [{ type: "callData", value: calldata }],
      amount: "0",
    });
    return (txHash || "0x") as `0x${string}`;
  }, [executeContractCall]);

  // Confetti trigger on completed + track this job ID in localStorage
  useEffect(() => {
    if (jobRaw) {
      trackJobId(Number(jobId)); // add to known list for any visitor
    }
  }, [jobRaw, jobId]);

  // Load physical code and negotiation state from localStorage on load
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`arc_negotiation_${jobId}`);
      if (saved) {
        setLocalCounterOffer(saved);
      }
    } catch (e) {}
  }, [jobId]);


  // Submissions & release state
  const [submission, setSubmission] = useState<{ fileUrl: string; fileName: string; status: string; result: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);

  // Live countdown timer
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  // Self-healing timeouts for pending transaction states (resets stuck buttons after unhandled chunk load or wallet cancel errors)
  useEffect(() => {
    if (isSettingBudget) {
      const t = setTimeout(() => setIsSettingBudget(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isSettingBudget]);

  useEffect(() => {
    if (isFunding) {
      const t = setTimeout(() => setIsFunding(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isFunding]);

  useEffect(() => {
    if (isCounterOffering) {
      const t = setTimeout(() => setIsCounterOffering(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isCounterOffering]);

  useEffect(() => {
    if (isSubmitting) {
      const t = setTimeout(() => setIsSubmitting(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isSubmitting]);

  useEffect(() => {
    if (isReleasing) {
      const t = setTimeout(() => setIsReleasing(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isReleasing]);

  useEffect(() => {
    if (isRefunding) {
      const t = setTimeout(() => setIsRefunding(false), 45000);
      return () => clearTimeout(t);
    }
  }, [isRefunding]);

  // Load proposed budget from Supabase submissions, notifications, or messages
  useEffect(() => {
    const loadProposed = async () => {
      if (jobRaw && jobRaw[5] > BigInt(0)) {
        setProposedBudget(null);
        try {
          localStorage.removeItem(`arc_proposed_budget_${jobId}`);
        } catch (e) {}
        return;
      }

      // 1. Check submission result
      if (submission && submission.result) {
        if (submission.result.startsWith("Proposed budget: ")) {
          const amt = submission.result.replace("Proposed budget: ", "").replace(" USDC", "").trim();
          if (amt && amt !== "0") {
            setProposedBudget(amt);
            return;
          }
        }
        const match = submission.result.match(/Proposed budget:\s*([0-9.]+)/i);
        if (match && match[1] && match[1] !== "0") {
          setProposedBudget(match[1]);
          return;
        }
      }

      // 2. Check Supabase notifications for COUNTER_OFFER on this escrow
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        try {
          const { data } = await supabase
            .from("notifications")
            .select("metadata, message")
            .eq("escrow_id", Number(jobId))
            .order("created_at", { ascending: false })
            .limit(5);

          if (data && data.length > 0) {
            for (const row of data) {
              if (row.metadata?.budget) {
                setProposedBudget(String(row.metadata.budget));
                return;
              }
              const numMatch = row.message?.match(/(\d+(\.\d+)?)\s*USDC/i);
              if (numMatch && numMatch[1]) {
                setProposedBudget(numMatch[1]);
                return;
              }
            }
          }
        } catch (e) {}
      }

      // 3. Check Messages API for first bid proposal
      try {
        const res = await fetch(`/api/escrow/${jobId}/messages`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && Array.isArray(data.messages)) {
            const firstBid = data.messages.find((m: any) => m.type === "bid" && m.bid_amount);
            if (firstBid && firstBid.bid_amount) {
              setProposedBudget(String(firstBid.bid_amount));
              return;
            }
          }
        }
      } catch (e) {}

      // 4. LocalStorage fallback
      try {
        const saved = localStorage.getItem(`arc_proposed_budget_${jobId}`);
        if (saved) {
          setProposedBudget(saved);
        }
      } catch (err) {}
    };
    loadProposed();
  }, [submission, jobId, jobRaw]);

  // Pre-fill budget input for the seller
  useEffect(() => {
    if (proposedBudget && !budgetInput) {
      setBudgetInput(proposedBudget);
    }
  }, [proposedBudget, budgetInput]);

  // Fetch USD rate from CoinGecko
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd")
      .then(res => res.json())
      .then(data => {
        if (data?.["usd-coin"]?.usd) {
          setUsdRate(data["usd-coin"].usd);
        }
      })
      .catch(() => setUsdRate(1.0));
  }, []);

  // Map tuple results from contract safely
  const [
    _,
    client,
    provider,
    evaluator,
    description,
    budgetRaw,
    expiredAtRaw,
    status,
    hook,
    deliverableHash,
    qrConfirmationHash
  ] = jobRaw || [
    undefined,
    "",
    "",
    "",
    "",
    BigInt(0),
    BigInt(0),
    0,
    "",
    "0x",
    "0x"
  ];

  const budget = formatUnits(budgetRaw, 6);
  const isClient = address?.toLowerCase() === client.toLowerCase();
  const isProvider = address?.toLowerCase() === provider.toLowerCase();
  const isEvaluator = address?.toLowerCase() === evaluator.toLowerCase();
  const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  useEffect(() => {
    if (status === 3) {
      fetchCompletedTxHash().then(hash => {
        if (hash) {
          setCompletedTxHash(hash);
          try {
            localStorage.setItem(`arc_completed_tx_${jobId}`, hash);
          } catch (e) {}
        }
      });
    }
  }, [status, fetchCompletedTxHash, jobId]);

  // Fetch AI summary & fraud flags
  useEffect(() => {
    if (!description || !budget) return;
    setLoadingAI(true);
    fetch("/api/ai/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, type: isPhysical ? "physical" : "digital" }),
    })
      .then(res => res.json())
      .then(data => setAiSummary(data))
      .catch(() => {});

    fetch("/api/ai/fraud-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        amount: budget,
        buyerAddress: client,
        sellerAddress: provider,
        escrowId: Number(jobId)
      }),
    })
      .then(res => res.json())
      .then(data => setFraudData(data))
      .catch(() => {})
      .finally(() => setLoadingAI(false));
  }, [description, budget, client, provider, isPhysical, jobId]);


  const fetchSubmission = async () => {
    // 1. Try to fetch from Supabase directly first if available
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (hasSupabase) {
      try {
        const { data, error } = await supabase
          .from("escrow_submissions")
          .select("*")
          .eq("job_id", Number(jobId))
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setSubmission({
            fileUrl: data.file_url,
            fileName: data.file_name,
            status: data.status,
            result: data.result,
          });
          if (data.file_url && !fileUrl) {
            setFileUrl(data.file_url);
            setFileName(data.file_name);
          }
          return;
        } else {
          // If Supabase is active but no record was found, reset submission state
          setSubmission(null);
          return;
        }
      } catch (err) {
        // Supabase offline/empty
      }
    }

    // 2. Fall back to API Proxy (which talks to the local Express bot server)
    try {
      const res = await fetch(`/api/submissions/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setSubmission(data);
        if (data.fileUrl && !fileUrl) {
          setFileUrl(data.fileUrl);
          setFileName(data.fileName);
        }
        return;
      } else if (res.status === 404) {
        setSubmission(null);
      }
    } catch (e) {
      // API offline, fall back to localStorage
    }

    // 3. Fallback to LocalStorage (Web-only botless testing)
    try {
      const localSubStr = localStorage.getItem(`arc_web_submission_${jobId}`);
      if (localSubStr) {
        const localSub = JSON.parse(localSubStr);
        setSubmission(localSub);
        if (localSub.fileUrl && !fileUrl) {
          setFileUrl(localSub.fileUrl);
          setFileName(localSub.fileName);
        }
      } else {
        setSubmission(null);
      }
    } catch (err) {
      console.error("Failed to read local submission cache:", err);
      setSubmission(null);
    }
  };

  // Subscribe to real-time changes or fall back to polling
  useEffect(() => {
    if (!jobRaw) return;

    fetchSubmission();

    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let channel: any = null;

    if (hasSupabase) {
      try {
        channel = supabase
          .channel(`escrow_submission_${jobId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "escrow_submissions",
              filter: `job_id=eq.${jobId}`,
            },
            (payload) => {
              console.log("⚡ Realtime notification received:", payload);
              if (payload.eventType === "DELETE") {
                setSubmission(null);
                try {
                  localStorage.removeItem(`arc_negotiation_${jobId}`);
                  setLocalCounterOffer(null);
                } catch (err) {}
                refetch();
              } else if (payload.new) {
                const newRow = payload.new as any;
                setSubmission({
                  fileUrl: newRow.file_url,
                  fileName: newRow.file_name,
                  status: newRow.status,
                  result: newRow.result,
                });
                if (newRow.file_url && !fileUrl) {
                  setFileUrl(newRow.file_url);
                  setFileName(newRow.file_name);
                }
                refetch(); // Update onchain state
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.error("Failed to start Supabase realtime channel:", err);
      }
    }

    // Set up a fallback polling interval for blockchain refetching and in case realtime/Supabase is offline
    const status = jobRaw[7];
    if (status <= 2) {
      const interval = setInterval(async () => {
        await fetchSubmission();
        refetch();
      }, 5000);
      return () => {
        clearInterval(interval);
        if (channel) {
          supabase.removeChannel(channel);
        }
      };
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [jobRaw, jobId]);

  // Redirect physical escrows to meetup page if status >= 1 (Funded)
  useEffect(() => {
    if (jobRaw) {
      const qrHash = jobRaw[10];
      const isPhysical = qrHash && qrHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
      const status = jobRaw[7];
      if (isPhysical && status >= 1) {
        router.replace(`/meetup/${id}`);
      }
      if (status === 3) { // Status === Completed
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }
  }, [jobRaw, id, router]);



  // ─── Live countdown (runs after jobRaw is available) ─────────────────────
  useEffect(() => {
    if (!expiredAtRaw) return;
    const expiry = Number(expiredAtRaw) * 1000;
    const tick = () => {
      const diff = expiry - Date.now();
      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hrs  = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000)  / 60000);
      const secs = Math.floor((diff % 60000)    / 1000);
      setTimeLeft(
        days > 0
          ? `${days}d ${hrs}h ${mins}m`
          : hrs > 0
          ? `${hrs}h ${mins}m ${secs}s`
          : `${mins}m ${secs}s`
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiredAtRaw]);



  // 1. Determine the negotiation state machine
  const dbResult = submission && submission.status === "Negotiation" ? submission.result : null;
  const isUpdating = dbResult === "Updating budget...";
  const onChainBudget = jobRaw ? formatUnits(jobRaw[5], 6) : "0";
  const onChainStatus = jobRaw ? jobRaw[7] : 0;

  let negotiationState: "none" | "proposed" | "seller_declined" | "buyer_rejected" | "accepted" = "none";
  let negotiatedAmount = "";

  if (dbResult === "rejected" || dbResult === "declined" || localCounterOffer === "seller_declined" || localCounterOffer === "rejected") {
    negotiationState = "seller_declined";
  } else if (dbResult === "Buyer rejected proposed budget." || localCounterOffer === "buyer_rejected") {
    negotiationState = "buyer_rejected";
  } else if (localCounterOffer === "accepted") {
    negotiationState = "accepted";
  } else {
    // Check if there is an active proposed offer
    const activeOffer = (localCounterOffer && !["rejected", "buyer_rejected", "seller_declined", "accepted"].includes(localCounterOffer))
      ? localCounterOffer
      : (submission && submission.status === "Negotiation" && submission.result.startsWith("Counter-offer: "))
      ? submission.result.replace("Counter-offer: ", "").replace(" USDC", "")
      : (submission && submission.status === "Negotiation" && submission.result.startsWith("Proposed budget: "))
      ? submission.result.replace("Proposed budget: ", "").replace(" USDC", "")
      : null;

    if (activeOffer) {
      if (parseFloat(onChainBudget) === parseFloat(activeOffer)) {
        negotiationState = "accepted";
        try {
          localStorage.setItem(`arc_negotiation_${jobId}`, "accepted");
        } catch (e) {}
      } else {
        negotiationState = "proposed";
        negotiatedAmount = activeOffer;
      }
    }
  }

  // Backward compatibility variables for existing code structure
  const counterOfferAmount = negotiationState === "seller_declined" 
    ? "rejected" 
    : negotiationState === "buyer_rejected" 
    ? "buyer_rejected" 
    : negotiationState === "proposed" 
    ? negotiatedAmount 
    : localCounterOffer;

  const isNegotiationActive = negotiationState === "proposed";

  // Clear local counter-offer if on-chain status is Funded or above,
  // or if the database negotiation has been completely cleared.
  useEffect(() => {
    if (!jobRaw) return;
    const onChainStatus = jobRaw[7];

    if (onChainStatus >= 1) {
      try {
        localStorage.removeItem(`arc_negotiation_${jobId}`);
        setLocalCounterOffer(null);
      } catch (err) {}
      return;
    }

    const isDbNegotiating = submission && submission.status === "Negotiation";
    const dbResultStr = submission?.result || "";

    // 1. If there is an active counter-offer in the database, clear any stale local rejected/accepted cache
    if (isDbNegotiating && dbResultStr.startsWith("Counter-offer:") && localCounterOffer && ["seller_declined", "buyer_rejected", "accepted", "rejected"].includes(localCounterOffer)) {
      try {
        localStorage.removeItem(`arc_negotiation_${jobId}`);
        setLocalCounterOffer(null);
      } catch (err) {}
      return;
    }

    // 2. If negotiation is no longer active in the database (status !== "Negotiation"), clear everything
    if (!isDbNegotiating && !isCounterOffering && localCounterOffer) {
      try {
        localStorage.removeItem(`arc_negotiation_${jobId}`);
        setLocalCounterOffer(null);
      } catch (err) {}
    }
  }, [jobRaw, localCounterOffer, jobId, submission, isCounterOffering]);

  // Notify buyer when the seller sets/updates the budget on-chain in real-time
  useEffect(() => {
    if (jobRaw) {
      const currentBudget = formatUnits(jobRaw[5], 6);
      if (lastSeenBudget !== null && currentBudget !== lastSeenBudget && parseFloat(currentBudget) > 0) {
        if (isClient) {
          alert(`🔔 Price Update: The seller has set/updated the budget to ${currentBudget} USDC!`);
        }
      }
      setLastSeenBudget(currentBudget);
    }
  }, [jobRaw, lastSeenBudget, isClient, alert]);

  if (isPending || !jobRaw) {
    return (
      <div style={{ textAlign: "center", padding: "100px 0", color: "var(--text-secondary)" }}>
        <RefreshCw className="animate-spin" size={32} style={{ margin: "0 auto 16px" }} />
        Loading escrow details from Arc Network...
      </div>
    );
  }


  const statuses = [
    "Open",       // 0
    "Funded",     // 1
    "Submitted",  // 2
    "Completed",  // 3
    "Rejected",   // 4
    "Expired",    // 5
    "Disputed"    // 6
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setFileName(file.name);
    setSelectedFile(file); // Save the file object
    
    // Simulate watermarking overlay generator
    const reader = new FileReader();
    reader.onload = (event) => {
      setFileUrl(event.target?.result as string);
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  // SELLER: Set Budget handler
  const handleSetBudget = async (amountToSet?: string) => {
    const targetAmount = amountToSet || budgetInput;
    if (!targetAmount || parseFloat(targetAmount) <= 0) return;
    setIsSettingBudget(true);
    const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    try {
      // Set Supabase status to "Negotiation" with result "Updating budget..." instantly on click (before wallet modal)
      // This triggers real-time UI synchronization showing "Syncing New Price Quote (Mining Block...)"
      if (hasSupabase) {
        try {
          const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            status: "Negotiation",
            result: "Updating budget...",
            file_url: isPhysical ? (submission?.fileUrl || "") : "",
            file_name: isPhysical ? "meetup_code" : "",
            source: "web"
          });
        } catch (dbErr) {
          console.error("Failed to set temporary updating status in Supabase:", dbErr);
        }
      }

      try {
        localStorage.removeItem(`arc_negotiation_${jobId}`);
        setLocalCounterOffer(null);
      } catch (err) {}

      const amount = parseUnits(targetAmount, 6);
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "setBudget",
        [jobId, amount, "0x"]
      );

      // Wait for on-chain block receipt
      await waitForReceipt(publicClient, txHash);
      setBudgetInput("");

      if (hasSupabase) {
        try {
          const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          if (!isPhysical) {
            await supabase.from("escrow_submissions").delete().eq("job_id", Number(jobId));
          }
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            status: "Open",
            result: "",
            file_url: isPhysical ? (submission?.fileUrl || "") : "",
            file_name: isPhysical ? "meetup_code" : "",
            source: "web"
          });

          // Notify the client that the provider has updated the budget
          await supabase.from("notifications").insert({
            recipient_address: client.toLowerCase(),
            type: "COUNTER_OFFER",
            escrow_id: Number(jobId),
            message: `Seller ${address?.slice(0, 8)}...${address?.slice(-4)} has set/updated the budget to ${targetAmount} USDC for JOB #${jobId}.`,
            read: false,
            metadata: { provider: address, budget: targetAmount }
          });
          console.log("Budget set notification sent to client.");
        } catch (dbErr) {
          console.error("Failed to insert budget set notification:", dbErr);
        }
      }

      refetch();
      await fetchSubmission();

      // Post confirmation event to chat room
      try {
        await fetch(`/api/escrow/${jobId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: address || "seller",
            senderRole: "seller",
            type: "text",
            text: `⛓️ On-chain budget confirmed: ${targetAmount} USDC. Escrow is ready for buyer funding!`,
          }),
        });
      } catch (e) {}

      alert(`Budget successfully updated to ${targetAmount} USDC!`);
    } catch (err: any) {
      // If error occurs or user cancels, restore Supabase state to original rejected status so they see the red text again
      if (hasSupabase) {
        try {
          const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            status: "Negotiation",
            result: "rejected",
            file_url: isPhysical ? (submission?.fileUrl || "") : "",
            file_name: isPhysical ? "meetup_code" : "",
            source: "web"
          });
        } catch (dbErr) {}
      }
      alert(`Set budget failed: ${err.message || err}`);
    } finally {
      setIsSettingBudget(false);
    }
  };

  // BUYER: Propose counter offer
  const handleProposeCounterOffer = async () => {
    if (!counterOfferInput || parseFloat(counterOfferInput) <= 0) return;
    const proposedVal = counterOfferInput;
    setCounterOfferInput("");
    setIsCounterOffering(true);

    // Optimistic UI update: instantly update local state to transition view
    try {
      localStorage.setItem(`arc_negotiation_${jobId}`, proposedVal);
      setLocalCounterOffer(proposedVal);
    } catch (err) {}

    try {
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
        const { error } = await supabase.from("escrow_submissions").upsert({
          job_id: Number(jobId),
          file_url: isPhysical ? (submission?.fileUrl || "") : "",
          file_name: isPhysical ? "meetup_code" : "",
          status: "Negotiation",
          result: `Counter-offer: ${proposedVal} USDC`,
          source: "web"
        });
        if (error) {
          console.error("Supabase upsert negotiation error:", error);
        }
      }
      await fetchSubmission();
    } catch (err: any) {
      console.error("Propose counter-offer backend sync error:", err);
    } finally {
      setIsCounterOffering(false);
    }
  };

  // BUYER: Reject budget
  const handleRejectBudget = async () => {
    try {
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
        await supabase.from("escrow_submissions").upsert({
          job_id: Number(jobId),
          file_url: isPhysical ? (submission?.fileUrl || "") : "",
          file_name: isPhysical ? "meetup_code" : "",
          status: "Negotiation",
          result: "Buyer rejected proposed budget.",
          source: "web"
        });
      }

      try {
        localStorage.setItem(`arc_negotiation_${jobId}`, "buyer_rejected");
        setLocalCounterOffer("buyer_rejected");
      } catch (err) {}

      alert("Budget quote rejected.");
      await fetchSubmission();
    } catch (err: any) {
      alert(`Failed to reject budget: ${err.message || err}`);
    }
  };

  // BUYER: Approve USDC + Fund handler (called after seller has set budget)
  const handleApproveAndFund = async () => {
    if (budgetRaw === BigInt(0)) {
      alert("Seller has not set the budget yet!");
      return;
    }
    setIsFunding(true);
    try {
      const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
      const approveAbi = [{
        type: "function", name: "approve", stateMutability: "nonpayable",
        inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
        outputs: [{ type: "bool" }]
      }] as const;

      const approveTxHash = await writeContract(
        USDC_ADDRESS, approveAbi, "approve",
        [DEPLOYED_ESCROW_ADDRESS, budgetRaw]
      );
      const approveReceipt = await waitForReceipt(publicClient, approveTxHash);
      if (approveReceipt.status !== "success") throw new Error("USDC approval reverted!");

      const fundTxHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS, escrowAbi, "fund",
        [jobId, "0x"]
      );
      const fundReceipt = await waitForReceipt(publicClient, fundTxHash);
      if (fundReceipt.status !== "success") throw new Error("Funding transaction reverted!");

      // Save escrow funding transaction to localStorage to show real amounts in profile transaction logs
      try {
        const savedRaw = localStorage.getItem("arc_saved_escrows") || "{}";
        const saved = JSON.parse(savedRaw);
        saved[fundTxHash.toLowerCase()] = {
          amount: budget,
          symbol: "USDC",
          jobId: Number(jobId),
          type: "fund"
        };
        localStorage.setItem("arc_saved_escrows", JSON.stringify(saved));
      } catch (e) {
        console.warn("Failed to cache funded escrow transaction:", e);
      }

      refetch();

      // If deliverable was already approved, automatically release payment onchain
      if (submission?.status === "Approved") {
        try {
          console.log("Deliverable was pre-approved, releasing payment...");
          await handleComplete();
        } catch (releaseErr) {
          console.warn("Auto-release after funding:", releaseErr);
        }
      }

      // Notify the provider (seller) that the job has been funded
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        try {
          await supabase.from("notifications").insert({
            recipient_address: provider.toLowerCase(),
            type: "FUNDED",
            escrow_id: Number(jobId),
            message: `Buyer ${address?.slice(0, 8)}...${address?.slice(-4)} has funded JOB #${jobId} with ${budget} USDC! You can now start working.`,
            read: false,
            metadata: { client: address, budget }
          });
          console.log("Funding notification sent to provider.");
        } catch (dbErr) {
          console.error("Failed to insert funding notification:", dbErr);
        }
      }
    } catch (err: any) {
      alert(`Funding failed: ${err.message || err}`);
    } finally {
      setIsFunding(false);
    }
  };

  const handleWebSubmit = async () => {
    if (!fileUrl || !fileName) return;
    setIsSubmitting(true);
    try {
      // 1. Submit onchain first to update status to Submitted (status === 2)
      const deliverableHash = keccak256(toHex(fileName));
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "submit",
        [jobId, deliverableHash, "0x"]
      );
      await waitForReceipt(publicClient, txHash);

      let finalFileUrl = fileUrl;
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // Upload to Supabase Storage if available
      if (hasSupabase && selectedFile) {
        try {
          const fileExt = fileName.split(".").pop();
          const filePath = `job_${jobId}_${Date.now()}.${fileExt}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("escrow-deliverables")
            .upload(filePath, selectedFile, {
              cacheControl: "3600",
              upsert: true
            });
            
          if (uploadError) throw uploadError;
          
          const { data } = supabase.storage.from("escrow-deliverables").getPublicUrl(filePath);
          finalFileUrl = data.publicUrl;
          setFileUrl(finalFileUrl); // Update local fileUrl state to point to cloud file
        } catch (err: any) {
          console.error("Supabase Storage upload failed:", err);
          alert("Warning: Failed to upload file to Cloud Storage. Submitting local fallback URL.");
        }
      }

      const isCustomEvaluator = evaluator.toLowerCase() !== DEFAULT_EVALUATOR.toLowerCase();
      const initialStatus = isCustomEvaluator ? "Awaiting Buyer Approval" : "Pending Verification";
      const initialResult = isCustomEvaluator 
        ? "Deliverable uploaded. Awaiting manual review and approval by the buyer." 
        : "AI verification agent analyzing the uploaded deliverable...";

      // Save to Supabase DB if available
      let dbSaved = false;
      if (hasSupabase) {
        try {
          const { error: dbErr } = await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            file_url: finalFileUrl,
            file_name: fileName,
            status: initialStatus,
            result: initialResult,
            source: "web"
          });
          if (!dbErr) {
            dbSaved = true;
            console.log("Submission details saved to Supabase.");

            // Notify the client that the provider has submitted deliverables
            await supabase.from("notifications").insert({
              recipient_address: client.toLowerCase(),
              type: "SUBMITTED",
              escrow_id: Number(jobId),
              message: `Seller ${address?.slice(0, 8)}...${address?.slice(-4)} has submitted deliverables for JOB #${jobId}! Please review.`,
              read: false,
              metadata: { provider: address, file_name: fileName }
            });
            console.log("Submission notification sent to client.");
          } else {
            console.error("Supabase DB upsert error:", dbErr);
          }
        } catch (err) {
          console.error("Failed to insert submission into Supabase:", err);
        }
      }

      // Save to localStorage immediately as a client-side cache fallback
      const localSub = {
        fileUrl: finalFileUrl,
        fileName,
        status: initialStatus,
        result: initialResult
      };
      try {
        localStorage.setItem(`arc_web_submission_${jobId}`, JSON.stringify(localSub));
      } catch (err) {
        console.warn("Failed to write to localStorage:", err);
      }

      // If we didn't save directly to the DB (e.g. Supabase credentials missing), or if we need to notify
      // the bot API as a fallback, run this:
      if (!dbSaved && !isCustomEvaluator) {
        try {
          const res = await fetch("/api/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: Number(jobId),
              fileUrl: finalFileUrl,
              fileName
            })
          });

          const data = await res.json();
          if (res.ok) {
            alert("Deliverable submitted successfully! AI Agent verification in progress.");
          } else {
            alert(`Deliverable submitted onchain, but bot returned: ${data.error}`);
          }
        } catch (postErr) {
          alert("Deliverable submitted onchain! Note: Verification backend is offline, please notify the buyer to approve manually.");
        }
      } else {
        if (isCustomEvaluator) {
          alert("Deliverable submitted onchain! Awaiting buyer approval.");
        } else {
          alert("Deliverable submitted successfully! AI Agent verification triggered in the cloud.");
        }
      }

      await fetchSubmission();
      refetch();
    } catch (err: any) {
      alert(`Submission failed: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = async () => {
    // If the contract is not funded yet onchain (status === 0), fund it first!
    if (status === 0) {
      console.log("Escrow contract is not funded yet. Triggering handleApproveAndFund first...");
      await handleApproveAndFund();
      return;
    }

    setIsReleasing(true);
    try {
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // Check if buyer IS the evaluator onchain (e.g. self-testing / custom arbitrator)
      if (evaluator.toLowerCase() === address?.toLowerCase()) {
        const reasonHash = keccak256(toHex("buyer_manual_approved"));
        const txHash = await writeContract(
          DEPLOYED_ESCROW_ADDRESS,
          escrowAbi,
          "complete",
          [jobId, reasonHash, "0x"]
        );
        await waitForReceipt(publicClient, txHash);

        // Update Supabase if available
        if (hasSupabase) {
          try {
            await supabase.from("escrow_submissions").update({
              status: "Approved",
              result: `Escrow payment released manually by buyer. Tx Hash: ${txHash}`
            }).eq("job_id", Number(jobId));
          } catch (dbErr) {
            console.error("Failed to update Supabase status to Approved:", dbErr);
          }
        }

        // Update local storage status & completed tx hash
        try {
          localStorage.setItem(`arc_completed_tx_${jobId}`, txHash);
          const localSub = {
            fileUrl,
            fileName,
            status: "Approved",
            result: `Escrow payment released manually by buyer. Tx Hash: ${txHash}`
          };
          localStorage.setItem(`arc_web_submission_${jobId}`, JSON.stringify(localSub));
        } catch (err) {}

        refetch();
        alert(`Payment released successfully!\nTransaction Hash: ${txHash}`);
      } else {
        // Delegate to bot backend (since evaluator is the bot address)
        // Try writing directly to Supabase first to keep records in sync
        if (hasSupabase) {
          try {
            await supabase.from("escrow_submissions").upsert({
              job_id: Number(jobId),
              buyer_authorized: true,
              status: "Approved",
              result: "Escrow payment released manually by buyer.",
              file_url: fileUrl || "",
              file_name: fileName || "",
              source: "web"
            });
            console.log("Manual release authorization saved to Supabase.");
          } catch (err) {
            console.error("Failed to save manual release authorization to Supabase:", err);
          }
        }

        // Call the bot gateway API route to execute the transaction on-chain
        const res = await fetch("/api/escrow-release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: Number(jobId),
            buyerAddress: address || client
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to release escrow payment.");
        }
        
        if (data.txHash) {
          try {
            localStorage.setItem(`arc_completed_tx_${jobId}`, data.txHash);
          } catch (err) {}
        }
        alert(`Payment released successfully via bot gateway!\nTransaction Hash: ${data.txHash}`);

        // Update local storage status
        try {
          const localSub = {
            fileUrl,
            fileName,
            status: "Approved",
            result: "Escrow payment released manually by buyer."
          };
          localStorage.setItem(`arc_web_submission_${jobId}`, JSON.stringify(localSub));
        } catch (err) {}

        refetch();
      }
    } catch (err: any) {
      alert(`Payout failed: ${err.message || err}`);
    } finally {
      setIsReleasing(false);
    }
  };

  const handleDispute = async () => {
    try {
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "dispute",
        [jobId]
      );
      console.log("Dispute registered:", txHash);

      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        try {
          const isPhysical = qrConfirmationHash && qrConfirmationHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          const disputerRole = address?.toLowerCase() === client.toLowerCase() ? "Client" : "Provider";
          const counterpartyAddress = address?.toLowerCase() === client.toLowerCase() ? provider : client;

          // 1. Update the submission record in Supabase
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            status: "Disputed",
            result: `Job disputed by ${disputerRole}. Waiting for arbitrator verdict. Tx Hash: ${txHash}`,
            file_url: isPhysical ? (submission?.fileUrl || "") : "",
            file_name: isPhysical ? "meetup_code" : "",
            source: "web"
          });

          // 2. Notify the counterparty via the in-app notifications system
          await supabase.from("notifications").insert({
            recipient_address: counterpartyAddress.toLowerCase(),
            type: "DISPUTE",
            escrow_id: Number(jobId),
            message: `⚠️ The ${disputerRole.toLowerCase()} has initiated a dispute on JOB #${jobId}. The transaction has been frozen.`,
            read: false,
            metadata: { disputer: address, txHash }
          });
          console.log("Dispute notification inserted successfully.");
        } catch (dbErr) {
          console.error("Failed to sync dispute details to Supabase:", dbErr);
        }
      }

      refetch();
    } catch (err) {
      alert("Dispute registration failed!");
    }
  };

  const handleRefundExpired = async () => {
    setIsRefunding(true);
    try {
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "refundExpired",
        [jobId]
      );
      await waitForReceipt(publicClient, txHash);
      alert(`Refund successful! Your USDC has been returned.\nTx: ${txHash}`);
      refetch();
    } catch (err: any) {
      alert(`Refund failed: ${err.message || err}`);
    } finally {
      setIsRefunding(false);
    }
  };

  const handleResolveDispute = async (resolution: number) => {
    try {
      await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "resolveDispute",
        [jobId, resolution]
      );
      refetch();
    } catch (err) {
      alert("Dispute resolution failed!");
    }
  };


  // Try to find a transaction hash in submission logs, API responses, or local storage
  const getTransactionHash = () => {
    if (completedTxHash && completedTxHash !== "0x") return completedTxHash;

    try {
      const savedTx = localStorage.getItem(`arc_completed_tx_${jobId}`);
      if (savedTx && savedTx !== "0x") return savedTx;
    } catch (e) {}

    if (submission && submission.result) {
      const match = submission.result.match(/0x[a-fA-F0-9]{64}/);
      if (match) return match[0];
    }
    return null;
  };

  const txHashResolved = getTransactionHash();

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px 0" }}>
      <div className="glass-card" style={{ padding: "40px", display: "flex", flexDirection: "column", gap: "32px" }}>
        
        {/* Header Block */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "24px" }}>
          <div>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontFamily: "Space Grotesk" }}>JOB ESCROW ID: #{id}</span>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "4px" }}>{description}</h1>
            {/* Expiry countdown */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" }}>
              <Clock size={13} style={{ color: status === 5 ? "var(--danger)" : "var(--text-muted)" }} />
              {status === 5 ? (
                <span style={{ fontSize: "0.8rem", color: "var(--danger)", fontWeight: 500 }}>Contract Expired</span>
              ) : timeLeft ? (
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Expires in {timeLeft}</span>
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--danger)", fontWeight: 500 }}>Expired</span>
              )}
            </div>
          </div>
          <div className={`badge ${
            status === 3 ? "badge-success" : 
            status === 6 ? "badge-danger" : 
            status === 1 ? "badge-info" : "badge-warning"
          }`}>
            {status === 3 && <ShieldCheck size={14} />}
            {status === 6 && <ShieldAlert size={14} />}
            {statuses[status]}
          </div>
        </div>

        {/* Roles Dashboard */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Client / Buyer</span>
            <div style={{ fontFamily: "Space Grotesk", fontSize: "0.95rem", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis" }}>
              {client} {isClient && <span style={{ color: "var(--primary)" }}>(You)</span>}
            </div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Seller / Provider</span>
            <div style={{ fontFamily: "Space Grotesk", fontSize: "0.95rem", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis" }}>
              {provider} {isProvider && <span style={{ color: "var(--secondary)" }}>(You)</span>}
            </div>
          </div>
        </div>

        {/* AI & Safety Analysis */}
        {(aiSummary || (fraudData && fraudData.flags?.length > 0)) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Fraud warning block */}
            {fraudData && fraudData.flags?.length > 0 && (
              <div style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: "12px",
                padding: "16px",
                color: "#f87171",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.88rem", marginBottom: "8px" }}>
                  <ShieldAlert size={16} />
                  <span>Safety Analysis: {fraudData.riskLevel} Risk Detected</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {fraudData.flags.map((flag: string, i: number) => (
                    <li key={i}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI Summary Block */}
            {aiSummary && (
              <div style={{
                background: "rgba(99,102,241,0.04)",
                border: "1px solid rgba(99,102,241,0.15)",
                borderRadius: "12px",
                padding: "16px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.88rem", color: "#818cf8", marginBottom: "8px" }}>
                  <span>✨ AI Contract Summary</span>
                </div>
                <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  {aiSummary.plainSummary}
                </p>
                {aiSummary.priceRange && (aiSummary.priceRange.min || aiSummary.priceRange.max) && (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", gap: "12px" }}>
                    <span>💡 Estimated Price: {aiSummary.priceRange.min ?? "?"} - {aiSummary.priceRange.max ?? "?"} USDC</span>
                    {aiSummary.estimatedDuration && (
                      <span>⏱ Est. Time: {aiSummary.estimatedDuration}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Budget detail */}
        <div style={{ textAlign: "center", padding: "24px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "16px" }}>
          <span style={{
            fontSize: "0.9rem",
            color: isUpdating
              ? "var(--warning)"
              : status === 0 && (negotiationState === "buyer_rejected" || negotiationState === "seller_declined")
              ? "var(--danger)"
              : status === 0 && negotiationState === "proposed"
              ? "var(--warning)"
              : "var(--text-secondary)"
          }}>
            {isUpdating
              ? "Syncing New Price Quote (Mining Block...)"
              : status === 0
              ? negotiationState === "proposed"
                ? submission?.result?.startsWith("Proposed budget:")
                  ? "Proposed Budget (Pending Confirmation)"
                  : "Proposed Counter-Offer (Pending)"
                : negotiationState === "accepted"
                ? "Agreed Price (Pending Deposit)"
                : negotiationState === "buyer_rejected"
                ? "Quoted Price (Rejected by Buyer)"
                : negotiationState === "seller_declined"
                ? "Counter-Offer (Declined by Seller)"
                : budgetRaw === BigInt(0) && proposedBudget
                ? "Proposed Budget (Pending Confirmation)"
                : "Quoted Price (Pending Deposit)"
              : "Escrow Balance"
            }
          </span>
          <div style={{
            fontSize: "2.8rem",
            fontWeight: 800,
            color: isUpdating
              ? "var(--warning)"
              : status === 0 && (negotiationState === "buyer_rejected" || negotiationState === "seller_declined")
              ? "var(--danger)"
              : status === 0 && (negotiationState === "proposed" || (budgetRaw === BigInt(0) && proposedBudget))
              ? "var(--warning)"
              : "var(--text-primary)",
            fontFamily: "Space Grotesk",
            marginTop: "4px",
            opacity: isUpdating ? 0.6 : 1,
            textDecoration: !isUpdating && status === 0 && (negotiationState === "buyer_rejected" || negotiationState === "seller_declined") ? "line-through" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px"
          }}>
            {isUpdating && <RefreshCw className="animate-spin" size={28} style={{ color: "var(--warning)" }} />}
            {status === 0 && negotiationState === "proposed"
              ? negotiatedAmount
              : budgetRaw === BigInt(0) && proposedBudget
              ? proposedBudget
              : budget
            } <span style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              color: isUpdating
                ? "var(--warning)"
                : status === 0 && (negotiationState === "buyer_rejected" || negotiationState === "seller_declined")
                ? "var(--danger)"
                : "var(--primary)",
              textDecoration: "none",
              display: "inline-block"
            }}>USDC</span>
          </div>
          {usdRate !== null && (
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "4px", fontWeight: 500, opacity: isUpdating ? 0.6 : 1 }}>
              ≈ ${(parseFloat(
                status === 0 && negotiationState === "proposed"
                  ? negotiatedAmount || "0"
                  : budgetRaw === BigInt(0) && proposedBudget
                  ? proposedBudget || "0"
                  : budget
              ) * usdRate).toFixed(2)} USD <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>(Live Price Lock)</span>
            </div>
          )}
        </div>


        {/* Transaction Hash */}
        {txHashResolved && (
          <div style={{
            background: "rgba(16, 185, 129, 0.03)",
            border: "1px solid rgba(16, 185, 129, 0.12)",
            borderRadius: "16px",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "-16px",
            textAlign: "left"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--success)", fontWeight: 600, fontSize: "0.95rem" }}>
              <ShieldCheck size={18} />
              <span>Escrow Transaction Confirmed</span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontFamily: "Space Grotesk", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Tx Hash: <a href={`https://testnet.arcscan.app/tx/${txHashResolved}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline" }}>{txHashResolved}</a>
            </div>
          </div>
        )}

        {/* Deliverable Section & AI Watermark */}
        {status >= 1 && (
          <div className="glass-card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Deliverable File & Preview</h3>
            
            {status === 1 && isProvider && (
              <div style={{ border: "2px dashed var(--border-color)", borderRadius: "12px", padding: "40px", textAlign: "center" }}>
                <input type="file" id="file" onChange={handleFileUpload} style={{ display: "none" }} />
                <label htmlFor="file" style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <Upload size={32} style={{ color: "var(--text-secondary)" }} />
                  <span>{isUploading ? "Uploading..." : "Click to select deliverable file"}</span>
                </label>
                {fileName && <p style={{ marginTop: "12px", fontSize: "0.9rem", color: "var(--primary)" }}>Selected: {fileName}</p>}
                
                {fileUrl && (
                  <div style={{ marginTop: "24px", padding: "12px", background: "rgba(255, 255, 255, 0.03)", borderRadius: "8px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0px" }}>
                      File watermarked locally for preview. Send this file directly inside your Telegram chat captioning it with <code>#submit {id}</code> or trigger the verification scan directly below.
                    </p>
                    <button onClick={handleWebSubmit} className="btn-primary" disabled={isSubmitting} style={{ alignSelf: "center", minWidth: "160px", justifyContent: "center" }}>
                      {isSubmitting ? "Submitting..." : "Submit Deliverable"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Display Deliverable Image Preview with Watermark based on status */}
            {(fileUrl || status >= 2) && (
              <div style={{ position: "relative", width: "100%", height: "240px", background: "#161722", borderRadius: "12px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* Simulated mockup image */}
                <img 
                  src={fileUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=600"} 
                  alt="Deliverable" 
                  style={{ width: "100%", height: "100%", objectFit: "contain", filter: (status === 3 || submission?.status === "Approved") ? "none" : "blur(2px)" }}
                />

                {/* Watermark Overlay (removed when completed) */}
                {status !== 3 && submission?.status !== "Approved" && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(10, 11, 16, 0.7)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "20px",
                    textAlign: "center"
                  }}>
                    <span style={{
                      fontSize: "1.4rem",
                      fontWeight: 700,
                      color: "var(--accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      border: "2px solid var(--accent)",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      transform: "rotate(-10deg)",
                      boxShadow: "0 4px 12px rgba(239,68,68,0.2)"
                    }}>Escrow Preview</span>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "16px", maxWidth: "300px" }}>
                      Locked in Escrow. Complete payment onchain to download the high-resolution vector original.
                    </p>
                  </div>
                )}
              </div>
            )}

            {submission && (
              <div style={{ marginTop: "16px", padding: "16px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "8px", textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Verification Status:</span>
                  <span className={`badge ${
                    submission.status === "Approved" ? "badge-success" :
                    submission.status === "Rejected" ? "badge-danger" : "badge-warning"
                  }`}>
                    {submission.status}
                  </span>
                </div>
                {submission.fileName && (
                  <p style={{ fontSize: "0.9rem", margin: 0 }}>
                    📁 Submitted File: <b>{submission.fileName}</b>
                  </p>
                )}
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
                  🤖 AI Agent Logs: {submission.result}
                </p>
              </div>
            )}
            {(status === 3 || submission?.status === "Approved") && isClient && (
              <a href={fileUrl || "#"} download={fileName || "deliverable.svg"} className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "16px" }}>
                <Download size={18} /> Download Original Deliverable
              </a>
            )}
          </div>
        )}

        {/* Action Controls & Live Chat/Bidding */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* OTC / Digital Escrows: Real-Time Off-Chain Chat & Bidding Room */}
          {!isPhysical && (
            <EscrowChatBidding
              jobId={Number(jobId)}
              clientAddress={client}
              providerAddress={provider}
              evaluatorAddress={evaluator}
              currentAddress={address}
              jobStatus={status}
              onChainBudget={budget}
              onCommitBudget={handleSetBudget}
              isCommittingBudget={isSettingBudget}
            />
          )}

          {/* Physical Escrows: In-Person Meetup Info Card */}
          {isPhysical && (
            <div style={{
              background: "rgba(16, 185, 129, 0.05)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              borderRadius: "14px",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "12px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#10b981", fontWeight: 600, fontSize: "1.05rem" }}>
                <span>📍 In-Person Physical Meetup Escrow</span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, margin: 0 }}>
                This is a physical exchange escrow. Communication and handover happen in person. Funds will be securely held on Arc Network until the physical meetup QR code or release word is scanned upon item inspection.
              </p>
              {status >= 1 && (
                <button
                  onClick={() => router.push(`/meetup/${jobId}`)}
                  className="btn-primary"
                  style={{ alignSelf: "flex-start", marginTop: "4px", background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", borderColor: "#10b981" }}
                >
                  Open In-Person Meetup & QR Verification →
                </button>
              )}
            </div>
          )}

          {/* Physical Escrow: Seller set budget input if not set yet */}
          {isPhysical && isProvider && status === 0 && budgetRaw === BigInt(0) && (
            <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <DollarSign size={20} style={{ color: "var(--primary)" }} />
                <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>Set In-Person Meetup Price (Seller Action)</span>
              </div>
              
              {proposedBudget ? (
                <div style={{ padding: "12px 16px", background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "10px", color: "var(--warning)", fontSize: "0.9rem" }}>
                  💡 The buyer proposed an initial meetup budget of <b>{proposedBudget} USDC</b>. You can accept it below or enter your own price quote.
                </div>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, margin: 0 }}>
                  Enter the agreed USDC price for this in-person physical exchange:
                </p>
              )}

              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="number"
                  placeholder={proposedBudget ? `Amount in USDC (e.g. ${proposedBudget})` : "Amount in USDC"}
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => handleSetBudget()}
                  className="btn-primary"
                  disabled={isSettingBudget || !budgetInput}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {isSettingBudget ? "Confirming..." : proposedBudget && budgetInput === proposedBudget ? `Accept & Set ${proposedBudget} USDC` : "Confirm Price"}
                </button>
              </div>
            </div>
          )}

          {/* BUYER Funding Action Card — Shown once budget is set on-chain and status is Open */}
          {isClient && status === 0 && budgetRaw > BigInt(0) && (
            <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "14px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Wallet size={20} style={{ color: "var(--primary)" }} />
                <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>Fund Escrow (Buyer Action)</span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, margin: 0 }}>
                On-chain budget is locked at <b style={{ color: "#10b981" }}>{budget} USDC</b>. Approve and deposit to activate the escrow{isPhysical ? " and generate your physical release code" : ""}.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                <button
                  onClick={handleApproveAndFund}
                  className="btn-primary"
                  disabled={isFunding}
                  style={{ justifyContent: "center", padding: "12px", fontSize: "0.95rem" }}
                >
                  {isFunding ? "Processing Confirmations..." : `Approve & Deposit ${budget} USDC`}
                </button>
              </div>
            </div>
          )}

          {/* Waiting state — budget not set on-chain yet for digital escrow */}
          {!isPhysical && status === 0 && budgetRaw === BigInt(0) && (
            <div style={{ padding: "14px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-secondary)", fontSize: "0.85rem", textAlign: "center" }}>
              💡 <b>Tip:</b> Propose bids and negotiate in the chat above. Once a bid is accepted, the seller can submit the final amount on-chain in 1 transaction.
            </div>
          )}

          {/* Waiting state — physical escrow waiting for seller to set price */}
          {isPhysical && isClient && status === 0 && budgetRaw === BigInt(0) && (
            <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-secondary)", fontSize: "0.9rem", textAlign: "center" }}>
              ⏳ Waiting for the seller to set the meetup price before you can fund this escrow.
            </div>
          )}

          {/* Waiting state — budget set but viewer is seller and not yet funded */}
          {isProvider && status === 0 && budgetRaw > BigInt(0) && !isNegotiationActive && (
            <div style={{ padding: "14px 16px", background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "8px", color: "var(--success)", fontSize: "0.9rem" }}>
              ✅ Budget set to <b>{budget} USDC</b>. Waiting for the buyer to approve and fund the escrow.
            </div>
          )}


          
          {submission?.status === "Approved" && (status === 1 || status === 2) ? (
            <div style={{ 
              padding: "18px 20px", 
              background: "rgba(16, 185, 129, 0.08)", 
              border: "1px solid rgba(16, 185, 129, 0.25)", 
              borderRadius: "12px", 
              color: "var(--success)", 
              fontSize: "0.95rem",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "10px"
            }}>
              <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>✅ Deliverable Approved by AI!</div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", maxWidth: "480px" }}>
                {isClient
                  ? "The AI verification passed. Click below to release the locked payment to the seller, or wait for the arbitrator bot to broadcast."
                  : isProvider
                  ? "Your deliverable passed AI verification! Waiting for the buyer to confirm payment release, or for the arbitrator bot to broadcast onchain."
                  : "The deliverable passed AI verification. Waiting for final payout release onchain."}
              </div>
              {isClient && (
                <button
                  onClick={handleComplete}
                  className="btn-primary"
                  disabled={isReleasing}
                  style={{ marginTop: "4px", padding: "10px 24px" }}
                >
                  {isReleasing ? "Releasing Payout..." : "💸 Release Payment on Arc Network"}
                </button>
              )}
            </div>
          ) : submission?.status === "Approved" && status === 0 ? (
            <div style={{
              padding: "20px 24px",
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: "14px",
              color: "var(--success)",
              fontSize: "0.95rem",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px"
            }}>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>✅ Deliverable Approved by AI!</div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", maxWidth: "520px", margin: 0 }}>
                {isClient
                  ? `The deliverable passed AI verification. Click below to deposit the ${budget} USDC and complete payout to the seller.`
                  : `Your deliverable is verified by AI! Waiting for the buyer to deposit and finalize payment.`}
              </p>
              {isClient && (
                <button
                  onClick={handleApproveAndFund}
                  className="btn-primary"
                  disabled={isFunding}
                  style={{ marginTop: "4px", padding: "12px 28px", fontSize: "0.95rem" }}
                >
                  {isFunding ? "Processing Confirmations..." : `💸 Approve & Deposit ${budget} USDC (Complete Payout)`}
                </button>
              )}
            </div>
          ) : (status === 1 || status === 2) && isClient && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <button onClick={handleComplete} className="btn-primary" disabled={isReleasing} style={{ justifyContent: "center" }}>
                {isReleasing ? "Releasing Payout..." : "Approve & Release Payment"}
              </button>
              <button onClick={handleDispute} className="btn-secondary" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                File Dispute
              </button>
            </div>
          )}

          {/* Expired state — buyer can claim refund */}
          {isClient && (status === 5 || (status === 1 && Date.now() / 1000 > Number(expiredAtRaw))) && (
            <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "12px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--danger)", fontWeight: 600 }}>
                <Clock size={20} />
                <span>Escrow Expired</span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.4 }}>
                This escrow has expired without completion. You can claim back your <b>{budget} USDC</b>.
              </p>
              <button
                onClick={handleRefundExpired}
                className="btn-primary"
                disabled={isRefunding}
                style={{ background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)", borderColor: "#ef4444", justifyContent: "center" }}
              >
                {isRefunding ? "Processing Refund..." : `💸 Claim ${budget} USDC Refund`}
              </button>
            </div>
          )}

          {status === 6 && (
            <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "12px", padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--danger)", fontWeight: 600 }}>
                <AlertCircle size={20} />
                <span>Job Disputed</span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "8px", lineHeight: 1.4 }}>
                This transaction has been frozen. The designated AI Agent arbitrator (@evaluator) is analyzing the chat logs and submission file to resolve the payout.
              </p>

              {isEvaluator && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 500 }}>Arbitrator Verdict Options:</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    <button onClick={() => handleResolveDispute(0)} className="btn-secondary" style={{ color: "var(--danger)" }}>Refund Buyer</button>
                    <button onClick={() => handleResolveDispute(1)} className="btn-secondary" style={{ color: "var(--success)" }}>Pay Seller</button>
                    <button onClick={() => handleResolveDispute(2)} className="btn-secondary">50/50 Split</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed State Review Option */}
          {status === 3 && (isClient || isProvider) && (
            <div style={{ background: "rgba(16, 185, 129, 0.04)", border: "1px solid rgba(16, 185, 129, 0.15)", borderRadius: "12px", padding: "20px", textAlign: "center" }}>
              <span style={{ fontSize: "1.1rem" }}>🌟</span>
              <p style={{ margin: "6px 0 12px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                {hasReviewed 
                  ? "You have already reviewed this transaction. Thank you!" 
                  : "This escrow is completed. Leave a review for the counterparty to build their reputation score."
                }
              </p>
              {!hasReviewed && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  className="btn-primary"
                  style={{ margin: "0 auto", padding: "8px 16px", fontSize: "0.82rem" }}
                >
                  Leave a Review
                </button>
              )}
            </div>
          )}

          {/* Admin Support Section */}
          {(isClient || isProvider) && (
            <div style={{
              marginTop: "24px",
              padding: "16px 20px",
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              boxSizing: "border-box"
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>Need Human Assistance?</span>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  If you encounter any issues with AI verification, or need dispute mediation, click to contact human support.
                </p>
                {(status === 3 || status === 4 || status === 5) && (
                  <span style={{ fontSize: "0.72rem", color: "var(--danger)", marginTop: "4px", fontWeight: 500 }}>
                    ⚠️ Note: This transaction is finalized. Funds have been released/returned onchain and cannot be reversed by Admin.
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => window.open("https://t.me/HandshakeBot", "_blank")}
                className="btn-secondary"
                style={{
                  padding: "8px 16px",
                  fontSize: "0.8rem",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                💬 Admin Support
              </button>
            </div>
          )}

        </div>
        
        {toast && (
          <div style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: toast.type === "error" ? "rgba(220, 38, 38, 0.95)" : "rgba(5, 150, 105, 0.95)",
            color: "#fff",
            padding: "16px 24px",
            borderRadius: "12px",
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
            fontSize: "0.95rem",
            fontWeight: 500,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            maxWidth: "380px",
            backdropFilter: "blur(8px)",
            border: toast.type === "error" ? "1px solid rgba(220, 38, 38, 0.2)" : "1px solid rgba(5, 150, 105, 0.2)",
            transition: "all 0.2s ease"
          }}>
            {toast.type === "error" ? <AlertCircle size={20} /> : <ShieldCheck size={20} />}
            <span>{toast.message}</span>
          </div>
        )}

      </div>

      {showReviewModal && (
        <ReviewModal
          escrowId={Number(jobId)}
          revieweeAddress={isClient ? provider : client}
          revieweeName={isClient ? "Seller" : "Buyer"}
          onClose={() => setShowReviewModal(false)}
          onSubmitted={() => {
            setHasReviewed(true);
            setShowReviewModal(false);
          }}
        />
      )}
    </div>
  );
}
