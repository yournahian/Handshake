"use client";

import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, RefreshCw, Upload, AlertCircle, CheckCircle2 } from "lucide-react";

interface QrCameraScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export function QrCameraScanner({ onScan, onClose }: QrCameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerElementId = "qr-reader-viewport";

  useEffect(() => {
    let isMounted = true;

    async function startScanner() {
      try {
        // Wait a tick for DOM element to render
        await new Promise((resolve) => setTimeout(resolve, 100));

        const html5QrCode = new Html5Qrcode(readerElementId);
        scannerRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (!isMounted) return;
            setScannedCode(decodedText);
            // Stop scanning once detected to avoid duplicate callbacks
            html5QrCode
              .stop()
              .then(() => {
                onScan(decodedText);
              })
              .catch(() => {
                onScan(decodedText);
              });
          },
          () => {
            // ignore scan frame misses
          }
        );

        if (isMounted) {
          setIsInitializing(false);
        }
      } catch (err: any) {
        console.error("Camera scanner error:", err);
        if (isMounted) {
          setIsInitializing(false);
          const msg = err?.message || String(err);
          if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
            setError("Camera permission denied. Please allow camera access in your browser settings or upload a QR image.");
          } else if (msg.includes("NotFoundError") || msg.includes("DevicesNotFoundError")) {
            setError("No camera device found on your device. You can upload an image/screenshot of the QR code instead.");
          } else {
            setError("Could not start camera. You can upload a photo of the QR code or enter the backup code.");
          }
        }
      }
    }

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().then(() => {
              try {
                scannerRef.current?.clear();
              } catch (e) {}
            });
          } else {
            scannerRef.current.clear();
          }
        } catch (e) {}
      }
    };
  }, [onScan]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(readerElementId);
        scannerRef.current = scanner;
      }

      // If scanner is actively running video, stop it first before file scanning
      if (scanner.isScanning) {
        await scanner.stop();
      }

      const decodedText = await scanner.scanFile(file, true);
      setScannedCode(decodedText);
      onScan(decodedText);
    } catch (err: any) {
      console.error("File scan failed:", err);
      setError("No valid QR code found in the selected image. Please try another image or enter the backup code.");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "440px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "20px",
          padding: "24px",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          alignItems: "center",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Camera size={20} style={{ color: "var(--primary)" }} />
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Scan Meetup QR Code</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-color)",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Viewport container */}
        <div
          style={{
            width: "100%",
            borderRadius: "16px",
            overflow: "hidden",
            background: "#000",
            position: "relative",
            minHeight: "280px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div id={readerElementId} style={{ width: "100%" }} />

          {isInitializing && !error && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                background: "rgba(0,0,0,0.7)",
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
              }}
            >
              <RefreshCw className="animate-spin" size={28} style={{ color: "var(--primary)" }} />
              <span>Starting camera viewfinder...</span>
            </div>
          )}

          {scannedCode && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                background: "rgba(16, 185, 129, 0.95)",
                color: "#fff",
                fontWeight: 600,
                fontSize: "1.05rem",
              }}
            >
              <CheckCircle2 size={40} />
              <span>QR Code Detected!</span>
            </div>
          )}
        </div>

        {/* Error notification */}
        {error && (
          <div
            style={{
              width: "100%",
              display: "flex",
              gap: "10px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "10px",
              padding: "10px 14px",
              fontSize: "0.82rem",
              color: "#f87171",
              textAlign: "left",
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>{error}</span>
          </div>
        )}

        {/* Instructions & File Upload Option */}
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.4 }}>
          Hold your camera steady over the QR code on the buyer's screen to automatically complete the release.
        </p>

        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary"
            style={{ flex: 1, justifyContent: "center", fontSize: "0.82rem", padding: "10px" }}
          >
            <Upload size={15} /> Upload QR Screenshot
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ fontSize: "0.82rem", padding: "10px 16px" }}
          >
            Enter Code Manually
          </button>
        </div>
      </div>
    </div>
  );
}
