"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatUnits, keccak256, toHex, encodeFunctionData } from "viem";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";
import { QrCode, Camera, ShieldCheck, AlertCircle, Copy, Check, CheckCircle2, ArrowRight, KeyRound, Sparkles, RefreshCw, ExternalLink } from "lucide-react";
import confetti from "canvas-confetti";
import { supabase } from "@/lib/supabase";
import { useTgBackButton, isTelegram, getTgWebApp } from "@/lib/telegram";
import { useWallet } from "@/hooks/useWallet";
import { useCircleWallet } from "@/components/CircleWalletContext";
import { publicClient } from "@/lib/publicClient";
import { waitForReceipt } from "@/lib/utils";
import { ReviewModal } from "@/components/ReviewModal";
import { QrCameraScanner } from "@/components/QrCameraScanner";

// Helper to extract the confirmation code from either a full URL or raw text
function extractCodeFromQrData(data: string): string {
  if (!data) return "";
  const trimmed = data.trim();
  try {
    if (trimmed.includes("?code=") || trimmed.includes("&code=")) {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://dummy.com/${trimmed}`);
      const code = url.searchParams.get("code");
      if (code) return code.trim();
    }
  } catch (e) {}
  return trimmed;
}

export default function MeetupDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { address, isConnected } = useWallet();
  const { executeContractCall } = useCircleWallet();
  const isNumeric = typeof id === "string" && /^\d+$/.test(id);
  const jobId = isNumeric ? BigInt(id as string) : 0n;

  const [copied, setCopied] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [isTxPending, setIsTxPending] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [qrMode, setQrMode] = useState<"url" | "raw">("url");
  const [buyerRecoveryInput, setBuyerRecoveryInput] = useState("");
  const [isReleasing, setIsReleasing] = useState(false);
  const [secretConfirmationCode, setSecretConfirmationCode] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(`arc_physical_code_${id}`);
        if (cached) return cached.trim();
      } catch (e) {}
    }
    return "laptop-received";
  });
  const [submission, setSubmission] = useState<{ fileUrl: string; fileName: string; status: string; result: string } | null>(null);
  const [completedTxHash, setCompletedTxHash] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [activeTab, setActiveTab] = useState<"buyer" | "seller">("buyer");

  // Custom toast notification state and alert helper to replace native browser popups
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const alert = useCallback((message: string) => {
    const lower = message.toLowerCase();
    const isError = lower.includes("failed") || 
                    lower.includes("error") || 
                    lower.includes("offline") || 
                    lower.includes("invalid") || 
                    lower.includes("incorrect") || 
                    lower.includes("wrong") || 
                    lower.includes("not set") ||
                    lower.includes("mismatch");
    setToast({ message: message.replace(/\n/g, " "), type: isError ? "error" : "success" });
    setTimeout(() => {
      setToast(null);
    }, 5000);
  }, []);

  // Check URL query parameters for ?code= on page load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get("code");
      if (urlCode) {
        setManualCode(urlCode.trim());
      }
    }
  }, []);

  // TG Back Button — wired after mount, placed at top per hooks rules
  useTgBackButton();

  // Read Job Details from contract manually using publicClient
  const [jobRaw, setJobRaw] = useState<any>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await publicClient.readContract({
        address: DEPLOYED_ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "jobs",
        args: [jobId],
      });
      setJobRaw(data);
    } catch (e) {}
  }, [jobId]);

  const fetchCompletedTxHash = useCallback(async () => {
    try {
      const blockNumber = await publicClient.getBlockNumber();
      const fromBlock = blockNumber > 2000n ? blockNumber - 2000n : 0n;
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
        fromBlock,
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

  // Redirect back to escrow detail page if this is a digital escrow OR it's not funded yet
  useEffect(() => {
    if (jobRaw) {
      const qrHash = jobRaw[10];
      const isPhysical = qrHash && qrHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
      const status = jobRaw[7];
      if (!isPhysical || status === 0) {
        router.replace(`/escrow/${id}`);
      }
    }
  }, [jobRaw, id, router]);

  const fetchSubmission = async () => {
    let codeFound = false;
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
          if (data.file_name === "meetup_code" && data.file_url && data.file_url.trim()) {
            setSecretConfirmationCode(data.file_url.trim());
            codeFound = true;
          }
        }
      } catch (err) {
        console.error("Failed to fetch submission from Supabase:", err);
      }
    }

    // LocalStorage Fallback for code if not successfully fetched from database
    if (!codeFound) {
      try {
        const localCode = localStorage.getItem(`arc_physical_code_${jobId}`);
        if (localCode && localCode.trim()) {
          setSecretConfirmationCode(localCode.trim());
        }
      } catch (err) {
        console.warn("Failed to read local physical code cache:", err);
      }
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
          .channel(`meetup_submission_${jobId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "escrow_submissions",
              filter: `job_id=eq.${jobId}`,
            },
            (payload) => {
              if (payload.new) {
                const newRow = payload.new as any;
                setSubmission({
                  fileUrl: newRow.file_url,
                  fileName: newRow.file_name,
                  status: newRow.status,
                  result: newRow.result,
                });
                if (newRow.file_name === "meetup_code" && newRow.file_url && newRow.file_url.trim()) {
                   setSecretConfirmationCode(newRow.file_url.trim());
                }
                refetch();
              }
            }
          )
          .subscribe();
      } catch (err) {}
    }

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
  }, [jobRaw, jobId]);

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

  const budget = budgetRaw ? formatUnits(budgetRaw, 6) : "0";
  const isClient = address && client ? address.toLowerCase() === client.toLowerCase() : false;
  const isProvider = address && provider ? address.toLowerCase() === provider.toLowerCase() : false;
  const isBoth = isClient && isProvider;

  // Validate confirmation code against onchain hash
  const isCodeValid = useCallback((code: string) => {
    if (!code || !qrConfirmationHash || qrConfirmationHash === "0x0000000000000000000000000000000000000000000000000000000000000000") return false;
    try {
      return keccak256(toHex(code.trim())) === qrConfirmationHash;
    } catch {
      return false;
    }
  }, [qrConfirmationHash]);

  const isCurrentSecretCodeValid = isCodeValid(secretConfirmationCode);
  const isManualCodeValid = isCodeValid(manualCode);

  // Auto-switch tabs if only one role matches
  useEffect(() => {
    if (isProvider && !isClient) {
      setActiveTab("seller");
    } else if (isClient && !isProvider) {
      setActiveTab("buyer");
    }
  }, [isClient, isProvider]);

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

  const handleCopyCode = () => {
    navigator.clipboard.writeText(secretConfirmationCode.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Buyer secret code verification & display recovery
  const handleVerifyBuyerCode = async () => {
    const trimmed = buyerRecoveryInput.trim();
    if (!trimmed) {
      alert("Please enter your secret confirmation word.");
      return;
    }
    if (isCodeValid(trimmed)) {
      setSecretConfirmationCode(trimmed);
      try {
        localStorage.setItem(`arc_physical_code_${jobId}`, trimmed);
      } catch (e) {}
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        try {
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            file_url: trimmed,
            file_name: "meetup_code",
            source: "web"
          });
        } catch (e) {}
      }
      alert("Verification successful! Valid release QR code is now displayed.");
      setBuyerRecoveryInput("");
    } else {
      alert("The code entered does not match the on-chain escrow hash. Please check spelling or capitalization.");
    }
  };

  // Execute release transaction using the secret code
  const handleQrRelease = async (codeToSubmit: string) => {
    const cleanCode = (codeToSubmit || "").trim();
    if (!cleanCode) {
      alert("Please enter or scan a confirmation code.");
      return;
    }

    // Validate the confirmation code locally first to prevent sending invalid transactions
    const computedHash = keccak256(toHex(cleanCode));
    if (computedHash !== qrConfirmationHash) {
      alert("Invalid verification code! The code does not match the buyer's on-chain escrow hash. Please verify the code and try again.");
      return;
    }

    setIsTxPending(true);
    try {
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "qrRelease",
        [jobId, cleanCode]
      );

      try {
        localStorage.setItem(`arc_completed_tx_${jobId}`, txHash);
      } catch (e) {}

      // Save the release transaction hash to Supabase so the buyer is notified
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (hasSupabase) {
        try {
          await supabase.from("escrow_submissions").upsert({
            job_id: Number(jobId),
            status: "Approved",
            result: `Escrow payment released by QR code. Tx Hash: ${txHash}`,
            file_url: cleanCode,
            file_name: "meetup_code",
            source: "web"
          });
          console.log("Release transaction hash saved to Supabase.");
        } catch (dbErr) {
          console.error("Failed to save release tx hash to Supabase:", dbErr);
        }
      }

      confetti({
        particleCount: 100,
        spread: 60,
        origin: { y: 0.6 }
      });
      refetch();
      alert(`Payment released successfully!\nTransaction Hash: ${txHash}`);
    } catch (err: any) {
      alert(`Release transaction failed: ${err?.message || err}`);
    } finally {
      setIsTxPending(false);
    }
  };

  // Callback when camera or image upload scans a QR code
  const handleScannedQrResult = async (decodedText: string) => {
    setShowScanner(false);
    const code = extractCodeFromQrData(decodedText);
    if (!code) {
      alert("No valid confirmation code found in the scanned QR.");
      return;
    }
    setManualCode(code);
    await handleQrRelease(code);
  };

  // Buyer Direct Release Fallback
  const handleComplete = async () => {
    setIsReleasing(true);
    try {
      const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // Check if buyer IS the arbitrator/evaluator onchain (e.g. self-testing / custom arbitrator)
      if (evaluator.toLowerCase() === address?.toLowerCase()) {
        const reasonHash = keccak256(toHex("buyer_manual_approved"));
        const txHash = await writeContract(
          DEPLOYED_ESCROW_ADDRESS,
          escrowAbi,
          "complete",
          [jobId, reasonHash, "0x"]
        );
        
        const receipt = await waitForReceipt(publicClient, txHash);
        if (!receipt) {
          throw new Error("Transaction receipt not found.");
        }

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

        try {
          localStorage.setItem(`arc_completed_tx_${jobId}`, txHash);
        } catch (e) {}

        refetch();
        alert(`Payment released successfully!\nTransaction Hash: ${txHash}`);
      } else {
        // Delegate to bot backend (since evaluator is the bot address)
        if (hasSupabase) {
          try {
            await supabase.from("escrow_submissions").upsert({
              job_id: Number(jobId),
              buyer_authorized: true,
              status: "Approved",
              result: "Escrow payment released manually by buyer.",
              file_url: secretConfirmationCode || "",
              file_name: "meetup_code",
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
            buyerAddress: address
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

          if (hasSupabase) {
            try {
              await supabase.from("escrow_submissions").upsert({
                job_id: Number(jobId),
                buyer_authorized: true,
                status: "Approved",
                result: `Escrow payment released manually by buyer. Tx Hash: ${data.txHash}`,
                file_url: secretConfirmationCode || "",
                file_name: "meetup_code",
                source: "web"
              });
            } catch (dbErr) {}
          }
        }
        alert(`Payment released successfully via bot gateway!\nTransaction Hash: ${data.txHash}`);
        refetch();
      }
    } catch (err: any) {
      alert(`Payout failed: ${err.message || err}`);
    } finally {
      setIsReleasing(false);
    }
  };

  // ── TG Main Button — wire after all handlers are defined ────────────────────
  useEffect(() => {
    const app = getTgWebApp();
    if (!app) return;
    if (!isClient) {
      app.MainButton.hide();
      return;
    }
    const btn = app.MainButton;
    btn.setText(isReleasing ? "Releasing…" : "Approve & Release Funds");
    btn.show();
    if (isReleasing) { btn.disable(); btn.showProgress(true); }
    else             { btn.enable();  btn.hideProgress(); }
    btn.onClick(handleComplete);
    return () => {
      btn.offClick(handleComplete);
      btn.hide();
    };
  }, [isClient, isReleasing]);

  // Generate QR content (URL or raw code)
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://handshake.app";
  const smartLinkUrl = `${currentOrigin}/meetup/${id}?code=${encodeURIComponent(secretConfirmationCode.trim())}`;
  const qrDataToEncode = qrMode === "url" ? smartLinkUrl : secretConfirmationCode.trim();

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "16px 0" }}>
      {!jobRaw ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
          Loading meetup contract details...
        </div>
      ) : (
        <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "28px", textAlign: "center" }}>
        
        {/* Title */}
        <div>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontFamily: "Space Grotesk" }}>PHYSICAL MEETUP ESCROW: #{id}</span>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginTop: "4px", lineHeight: 1.2 }}>{description}</h1>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary)", marginTop: "8px", fontFamily: "Space Grotesk" }}>{budget} USDC</p>
        </div>

        {/* Tab switch for self-testing or when both roles apply */}
        {(isBoth || (!isClient && !isProvider)) && (
          <div style={{
            display: "flex",
            background: "rgba(255, 255, 255, 0.04)",
            padding: "4px",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            width: "100%",
            boxSizing: "border-box"
          }}>
            <button
              type="button"
              onClick={() => setActiveTab("buyer")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "buyer" ? "var(--primary)" : "transparent",
                color: activeTab === "buyer" ? "#000" : "var(--text-secondary)",
                transition: "all 0.2s ease"
              }}
            >
              Buyer View (Show QR)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("seller")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "seller" ? "var(--primary)" : "transparent",
                color: activeTab === "seller" ? "#000" : "var(--text-secondary)",
                transition: "all 0.2s ease"
              }}
            >
              Seller View (Scan QR)
            </button>
          </div>
        )}

        {status === 3 ? (
          /* Completed State */
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "center" }}>
            <div style={{
              background: "rgba(16, 185, 129, 0.1)",
              color: "var(--success)",
              width: "70px",
              height: "70px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <ShieldCheck size={38} />
            </div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Meetup Successfully Settled!</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.4, textAlign: "center" }}>
              {address && provider && address.toLowerCase() === provider.toLowerCase()
                ? "Funds have been transferred to your wallet on the Arc network. You are safe to part ways."
                : "Funds have been transferred to the seller on the Arc network. You are safe to part ways."
              }
            </p>
            
            {/* Transaction Hash */}
            {(() => {
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

              const txHash = getTransactionHash();
              if (!txHash) return null;

              return (
                <div style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "12px",
                  padding: "14px 16px",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: "12px",
                  boxSizing: "border-box"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>Settlement Transaction Hash</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(txHash);
                          setCopiedTx(true);
                          setTimeout(() => setCopiedTx(false), 2000);
                        }}
                        style={{
                          background: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid var(--border-color)",
                          color: copiedTx ? "var(--success)" : "var(--text-secondary)",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "0.72rem",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px"
                        }}
                      >
                        {copiedTx ? <Check size={12} /> : <Copy size={12} />}
                        {copiedTx ? "Copied" : "Copy"}
                      </button>
                      <a
                        href={`https://testnet.arcscan.app/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          background: "rgba(99, 102, 241, 0.1)",
                          border: "1px solid rgba(99, 102, 241, 0.25)",
                          color: "var(--primary)",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "0.72rem",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px"
                        }}
                      >
                        Explorer <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                  <div style={{
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    lineHeight: "1.5",
                    wordBreak: "break-all",
                    color: "var(--primary)",
                    userSelect: "all"
                  }}>
                    {txHash}
                  </div>
                </div>
              );
            })()}

            {/* Leave Review Card */}
            <div style={{
              background: "rgba(16, 185, 129, 0.04)",
              border: "1px solid rgba(16, 185, 129, 0.15)",
              borderRadius: "12px",
              padding: "20px",
              width: "100%",
              boxSizing: "border-box",
              marginBottom: "12px",
              textAlign: "center"
            }}>
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
                  style={{ width: "100%", padding: "8px 16px", fontSize: "0.82rem", margin: "0 auto" }}
                >
                  Leave a Review
                </button>
              )}
            </div>

            <button onClick={() => router.push("/")} className="btn-secondary" style={{ width: "100%" }}>
              Back to Dashboard
            </button>
          </div>
        ) : (
          /* Active Escrow State */
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            
            {/* Buyer View (Displays QR Code) */}
            {((isClient && activeTab === "buyer") || (!isClient && !isProvider && activeTab === "buyer")) && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
                
                {/* Warning if code does not match on-chain hash */}
                {!isCurrentSecretCodeValid && (
                  <div style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    borderRadius: "12px",
                    padding: "16px",
                    textAlign: "left",
                    width: "100%",
                    boxSizing: "border-box"
                  }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--warning)", marginBottom: "6px" }}>
                      <AlertCircle size={18} />
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Verification Code Mismatch</span>
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
                      Your browser's cached code doesn't match the on-chain hash. Please enter the secret word you set when creating this escrow to display the valid QR code:
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        placeholder="Enter secret word (e.g. get)"
                        value={buyerRecoveryInput}
                        onChange={(e) => setBuyerRecoveryInput(e.target.value)}
                        style={{ flex: 1, fontSize: "0.85rem", padding: "8px 12px" }}
                      />
                      <button
                        onClick={handleVerifyBuyerCode}
                        className="btn-primary"
                        style={{ fontSize: "0.82rem", padding: "8px 16px", whiteSpace: "nowrap" }}
                      >
                        Verify & Reveal
                      </button>
                    </div>
                  </div>
                )}

                {/* QR Code Container */}
                <div style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid var(--border-color)",
                  padding: "16px",
                  borderRadius: "16px",
                  display: "inline-block",
                  position: "relative"
                }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(qrDataToEncode)}`}
                    alt="Release QR Code"
                    style={{ background: "white", padding: "8px", borderRadius: "10px", maxWidth: "100%", display: "block" }}
                  />
                  {isCurrentSecretCodeValid && (
                    <div style={{
                      position: "absolute",
                      bottom: "-10px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "rgba(16, 185, 129, 0.95)",
                      color: "#fff",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: "20px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      whiteSpace: "nowrap"
                    }}>
                      <CheckCircle2 size={12} /> On-chain Verified
                    </div>
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Show this QR Code to Seller</h3>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "4px", maxWidth: "360px", margin: "4px auto 0" }}>
                    Once you inspect the item in person and are fully satisfied, let the seller scan this QR code with their camera to receive the USDC instantly.
                  </p>
                </div>

                {/* QR Mode Toggle */}
                <div style={{ display: "flex", gap: "8px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", padding: "4px", borderRadius: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setQrMode("url")}
                    style={{
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "0.76rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      background: qrMode === "url" ? "rgba(255, 255, 255, 0.1)" : "transparent",
                      color: qrMode === "url" ? "var(--text-primary)" : "var(--text-muted)"
                    }}
                  >
                    📱 Universal Camera Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrMode("raw")}
                    style={{
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "0.76rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      background: qrMode === "raw" ? "rgba(255, 255, 255, 0.1)" : "transparent",
                      color: qrMode === "raw" ? "var(--text-primary)" : "var(--text-muted)"
                    }}
                  >
                    🔑 Raw Code
                  </button>
                </div>
                
                {/* Manual Backup Code */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "8px 16px" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Backup Code:</span>
                  <code style={{ fontFamily: "Space Grotesk", color: "var(--primary)", fontWeight: 600 }}>{secretConfirmationCode.trim()}</code>
                  <button onClick={handleCopyCode} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                    {copied ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Direct Release Button */}
                {!isTelegram() && (
                  <button
                    onClick={handleComplete}
                    className="btn-primary"
                    disabled={isReleasing}
                    style={{ width: "100%", justifyContent: "center", marginTop: "8px", background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", borderColor: "#10B981" }}
                  >
                    {isReleasing ? "Releasing Payout..." : "Approve & Release Funds Directly"}
                  </button>
                )}
                {isTelegram() && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    Tap the <strong>Approve & Release</strong> button below to complete the payout.
                  </p>
                )}
              </div>
            )}

            {/* Seller View (Scans QR Code) */}
            {((isProvider && activeTab === "seller") || (!isClient && !isProvider && activeTab === "seller")) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                
                {/* Detected valid code from URL */}
                {isManualCodeValid && (
                  <div style={{
                    background: "rgba(16, 185, 129, 0.1)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: "14px",
                    padding: "16px",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--success)" }}>
                      <CheckCircle2 size={20} />
                      <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>Verified QR Code Detected!</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                      The scanned secret code <code style={{ color: "var(--primary)", fontWeight: 600 }}>{manualCode}</code> is valid on-chain. Tap below to claim your payout.
                    </p>
                    <button
                      onClick={() => handleQrRelease(manualCode)}
                      disabled={isTxPending}
                      className="btn-primary"
                      style={{ width: "100%", justifyContent: "center", padding: "14px", background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
                    >
                      {isTxPending ? "Releasing Payout..." : `Claim ${budget} USDC to Your Wallet`}
                    </button>
                  </div>
                )}

                {/* Scan Button opens live camera scanner */}
                <button
                  onClick={() => setShowScanner(true)}
                  className="btn-primary"
                  style={{ width: "100%", justifyContent: "center", padding: "16px", fontSize: "1rem", gap: "10px" }}
                >
                  <Camera size={22} /> Scan Buyer's QR Code
                </button>

                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", margin: "8px 0" }}>
                  <div style={{ position: "absolute", left: 0, right: 0, height: "1px", background: "var(--border-color)" }}></div>
                  <span style={{ position: "relative", background: "var(--bg-card)", padding: "0 12px", color: "var(--text-muted)", fontSize: "0.85rem" }}>OR ENTER BACKUP CODE</span>
                </div>

                {/* Manual input form */}
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="text"
                    placeholder="Enter backup confirmation code"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={() => handleQrRelease(manualCode)}
                    className="btn-secondary"
                    disabled={isTxPending || !manualCode.trim()}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {isTxPending ? "Releasing..." : "Release USDC"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: "10px", background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.15)", borderRadius: "8px", padding: "12px", textAlign: "left" }}>
                  <AlertCircle size={18} style={{ color: "var(--warning)", flexShrink: 0, marginTop: "2px" }} />
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4, margin: 0 }}>
                    Do not hand over the physical item until this page shows <b>Settled!</b>. Payout is processed instantly using Arc's deterministic finality.
                  </p>
                </div>

              </div>
            )}

          </div>
        )}

        {/* Live Camera Scanner Modal */}
        {showScanner && (
          <QrCameraScanner
            onScan={handleScannedQrResult}
            onClose={() => setShowScanner(false)}
          />
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
            flexDirection: "column",
            gap: "12px",
            textAlign: "left",
            boxSizing: "border-box"
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>Need Human Assistance?</span>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                If you encounter any issues with verification, or need dispute mediation, contact admin support.
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
                width: "100%",
                padding: "10px 16px",
                fontSize: "0.82rem",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              💬 Admin Support
            </button>
          </div>
        )}

        </div>
      )}

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
          zIndex: 100000,
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
