"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatUnits, keccak256, toHex, encodeFunctionData } from "viem";
import { escrowAbi, DEPLOYED_ESCROW_ADDRESS } from "@/lib/contracts";
import { QrCode, Camera, ShieldCheck, AlertCircle, Copy, Check } from "lucide-react";
import confetti from "canvas-confetti";
import { supabase } from "@/lib/supabase";
import { useTgBackButton, isTelegram, getTgWebApp } from "@/lib/telegram";
import { useWallet } from "@/hooks/useWallet";
import { useCircleWallet } from "@/components/CircleWalletContext";
import { publicClient } from "@/lib/publicClient";
import { waitForReceipt } from "@/lib/utils";
import { ReviewModal } from "@/components/ReviewModal";

export default function MeetupDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { address, isConnected } = useWallet();
  const { executeContractCall } = useCircleWallet();
  const isNumeric = typeof id === "string" && /^\d+$/.test(id);
  const jobId = isNumeric ? BigInt(id as string) : 0n;

  const [copied, setCopied] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [isTxPending, setIsTxPending] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [secretConfirmationCode, setSecretConfirmationCode] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(`arc_physical_code_${id}`);
        if (cached) return cached;
      } catch (e) {}
    }
    return "laptop-received";
  });
  const [submission, setSubmission] = useState<{ fileUrl: string; fileName: string; status: string; result: string } | null>(null);
  const [completedTxHash, setCompletedTxHash] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

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
                    lower.includes("not set");
    setToast({ message: message.replace(/\n/g, " "), type: isError ? "error" : "success" });
    setTimeout(() => {
      setToast(null);
    }, 5000);
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
          if (data.file_name === "meetup_code" && data.file_url) {
            setSecretConfirmationCode(data.file_url);
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
        if (localCode) {
          setSecretConfirmationCode(localCode);
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
                if (newRow.file_name === "meetup_code" && newRow.file_url) {
                   setSecretConfirmationCode(newRow.file_url);
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
    navigator.clipboard.writeText(secretConfirmationCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQrRelease = async (codeToSubmit: string) => {
    // Validate the confirmation code locally first to prevent sending invalid transactions
    const computedHash = keccak256(toHex(codeToSubmit));
    if (computedHash !== qrConfirmationHash) {
      alert("Invalid verification code! Please check the code and try again.");
      return;
    }

    setIsTxPending(true);
    try {
      const txHash = await writeContract(
        DEPLOYED_ESCROW_ADDRESS,
        escrowAbi,
        "qrRelease",
        [jobId, codeToSubmit]
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
            file_url: codeToSubmit,
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
    } catch (err) {
      alert("Invalid verification code or transaction failed!");
    } finally {
      setIsTxPending(false);
    }
  };

  const simulateCameraScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      handleQrRelease(secretConfirmationCode);
    }, 2500); // Simulate scanning duration
  };

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
        // Try writing directly to Supabase first to keep records in sync
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

          // Save the transaction hash to Supabase so the seller can see it too
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
  // Show TG's native bottom button as the primary CTA when running in Telegram
  useEffect(() => {
    const app = getTgWebApp();
    if (!app) return;
    // Only show for the buyer role (isClient becomes true after jobRaw loads)
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
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Meetup Successfully Settle!</h2>
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
                  padding: "12px 16px",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: "8px"
                }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Transaction Hash</span>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "0.85rem", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline" }}>
                      {txHash}
                    </a>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
            
            {/* Buyer View (Displays QR Code) */}
            {isClient && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
                <div style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--border-color)", padding: "16px", borderRadius: "12px", display: "inline-block" }}>
                  {/* Google Charts QR API generating a code for the confirmation value */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(secretConfirmationCode)}`}
                    alt="Release QR Code"
                    style={{ background: "white", padding: "8px", borderRadius: "8px", maxWidth: "100%" }}
                  />
                </div>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Show this QR Code to Seller</h3>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "4px", maxWidth: "340px", margin: "4px auto 0" }}>
                    Once you inspect the item in person and are fully satisfied, let the seller scan this code to release the USDC instantly.
                  </p>
                </div>
                
                {/* Manual Code Fallback */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "8px 16px" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Backup Code:</span>
                  <code style={{ fontFamily: "Space Grotesk", color: "var(--primary)" }}>{secretConfirmationCode}</code>
                  <button onClick={handleCopyCode} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                    {copied ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Direct Release Button — hidden in Telegram (handled by TG Main Button) */}
                {!isTelegram() && (
                  <button
                    onClick={handleComplete}
                    className="btn-primary"
                    disabled={isReleasing}
                    style={{ width: "100%", justifyContent: "center", marginTop: "12px", background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", borderColor: "#10B981" }}
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
            {isProvider && (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                
                {isScanning ? (
                  <div style={{ border: "2px dashed var(--border-color)", borderRadius: "16px", padding: "60px 20px", background: "rgba(255, 255, 255, 0.02)", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                    <Camera className="animate-pulse" size={32} style={{ color: "var(--primary)" }} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--primary)" }}>Initializing Camera Scan...</span>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", maxWidth: "240px" }}>Simulating optical QR alignment. Keep screen facing the camera.</p>
                  </div>
                ) : (
                  <button onClick={simulateCameraScan} className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "16px" }}>
                    <Camera size={20} /> Scan Buyer's QR Code
                  </button>
                )}

                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", margin: "10px 0" }}>
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
                    disabled={isTxPending || !manualCode}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Release USDC
                  </button>
                </div>

                <div style={{ display: "flex", gap: "10px", background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.15)", borderRadius: "8px", padding: "12px", textAlign: "left" }}>
                  <AlertCircle size={18} style={{ color: "var(--warning)", flexShrink: 0, marginTop: "2px" }} />
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    Do not hand over the physical item until this page shows <b>Settle!</b>. Payout is processed instantly using Arc's deterministic finality.
                  </p>
                </div>

              </div>
            )}

            {/* Non-participants view */}
            {!isClient && !isProvider && (
              <div style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                Connect your wallet as either the Buyer or Seller to access the meetup QR code controls.
              </div>
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
