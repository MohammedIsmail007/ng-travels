// =============================================================
// NG TRAVELS ERP - UNIVERSAL SYNC & NETWORK ENGINE (PRODUCTION)
// Supports:
// 1. Real-Time Remote Cloud/LAN Cross-Device Sync (Owner & Driver APKs)
// 2. Real-Time Server-Sent Events (SSE) Stream
// 3. Automatic Supabase Auth Token Injection
// 4. Mobile / Web Unified Fetch Routing
// =============================================================

import { supabase } from "@/lib/supabase/client";

export type SyncMode = "remote";
export type ConnectionStatus = "connected" | "connecting" | "offline";

export interface SyncState {
  mode: SyncMode;
  status: ConnectionStatus;
  serverUrl: string;
  lastSyncTime?: string;
  errorMessage?: string;
}

const STORAGE_SERVER_URL = "ng_server_url";

export function getDefaultServerUrl(): string {
  // 1. In regular Web Browser: ALWAYS route relative to current origin (same-origin on Vercel)
  if (typeof window !== "undefined") {
    const isCapacitor = Boolean(
      (window as any).Capacitor?.isNativePlatform?.() ||
      window.location.protocol === "capacitor:" ||
      (window.location.hostname === "localhost" && (window as any).NG_APP_ROLE)
    );

    if (!isCapacitor) {
      return window.location.origin.replace(/\/+$/, "");
    }
  }

  // 2. Mobile Native APK (Capacitor): Use configured remote server URL
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }

  return "https://ng-travels-operations-black.vercel.app";
}

class SyncEngine {
  private mode: SyncMode = "remote";
  private status: ConnectionStatus = "connecting";
  private serverUrl: string = "";
  private lastSyncTime?: string;
  private errorMessage?: string;
  private listeners: Set<(state: SyncState) => void> = new Set();
  private eventSource: EventSource | null = null;
  private initialized = false;

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    try {
      const savedUrl = localStorage.getItem(STORAGE_SERVER_URL);
      this.serverUrl = savedUrl ? savedUrl.replace(/\/+$/, "") : getDefaultServerUrl();
    } catch {
      this.serverUrl = getDefaultServerUrl();
    }
  }

  public init() {
    if (this.initialized) return;
    this.initialized = true;

    this.patchGlobalFetch();
    this.connectRemote();

    // Reconnect on online event
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.status = "connecting";
        this.notify();
        this.connectRemote();
      });

      window.addEventListener("offline", () => {
        this.status = "offline";
        this.errorMessage = "You're offline. Check your internet connection.";
        this.notify();
      });
    }
  }

  public getState(): SyncState {
    return {
      mode: this.mode,
      status: this.status,
      serverUrl: this.serverUrl,
      lastSyncTime: this.lastSyncTime,
      errorMessage: this.errorMessage,
    };
  }

  public subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error("[SyncEngine] Listener error:", err);
      }
    }
  }

  public async setServerUrl(url: string): Promise<boolean> {
    const cleanUrl = url.trim().replace(/\/+$/, "");
    this.serverUrl = cleanUrl;
    try {
      localStorage.setItem(STORAGE_SERVER_URL, cleanUrl);
    } catch {}

    return this.connectRemote();
  }

  public async testConnection(targetUrl?: string): Promise<{ success: boolean; message: string }> {
    const testUrl = (targetUrl || this.serverUrl).trim().replace(/\/+$/, "");
    if (!testUrl) {
      return { success: false, message: "Please enter a valid server URL" };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await (window as any)._originalFetch(`${testUrl}/api/health`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (res.ok) {
        return { success: true, message: `Connected to NG Travels Backend at ${testUrl}` };
      }
      return { success: false, message: `Server responded with HTTP ${res.status}` };
    } catch (err: any) {
      return {
        success: false,
        message: err.name === "AbortError" ? "Connection timed out" : `Cannot reach server: ${err.message}`,
      };
    }
  }

  private async connectRemote(): Promise<boolean> {
    if (!this.serverUrl) {
      this.status = "offline";
      this.errorMessage = "No server endpoint configured";
      this.notify();
      return false;
    }

    this.status = "connecting";
    this.notify();

    const test = await this.testConnection(this.serverUrl);
    if (!test.success) {
      // In web browser, if test to external URL fails, try relative /api/health
      if (typeof window !== "undefined" && window.location.origin !== this.serverUrl) {
        const localTest = await this.testConnection(window.location.origin);
        if (localTest.success) {
          this.serverUrl = window.location.origin;
          this.status = "connected";
          this.errorMessage = undefined;
          this.lastSyncTime = new Date().toLocaleTimeString();
          this.notify();
          this.startRemoteSSE();
          return true;
        }
      }

      this.status = "offline";
      this.errorMessage = test.message;
      this.notify();
      return false;
    }

    this.status = "connected";
    this.errorMessage = undefined;
    this.lastSyncTime = new Date().toLocaleTimeString();
    this.notify();

    this.startRemoteSSE();
    return true;
  }

  private startRemoteSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      const isAbsolute = this.serverUrl.startsWith("http");
      const sseUrl = isAbsolute ? `${this.serverUrl}/api/realtime/stream` : `/api/realtime/stream`;

      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        this.status = "connected";
        this.lastSyncTime = new Date().toLocaleTimeString();
        this.notify();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.lastSyncTime = new Date().toLocaleTimeString();
          window.dispatchEvent(new CustomEvent("ng_realtime_sync", { detail: payload }));
          this.notify();
        } catch {}
      };

      this.eventSource.onerror = () => {
        if (this.status === "connected") {
          this.status = "connecting";
          this.notify();
        }
      };
    } catch (e) {
      console.warn("[SyncEngine] Failed to initialize SSE:", e);
    }
  }

  // -------------------------------------------------------------
  // GLOBAL FETCH PATCHING FOR AUTH TOKEN & ROUTING
  // -------------------------------------------------------------
  private patchGlobalFetch() {
    if (typeof window === "undefined" || (window as any)._originalFetch) return;

    (window as any)._originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let urlStr = "";
      if (typeof input === "string") {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if ("url" in input) {
        urlStr = input.url;
      }

      // Check if this is an API call
      const isApiCall = urlStr.startsWith("/api") || urlStr.includes("/api/");

      if (!isApiCall) {
        return (window as any)._originalFetch(input, init);
      }

      // Resolve Target URL
      let targetUrl = urlStr;
      const isCapacitor = Boolean(
        (window as any).Capacitor?.isNativePlatform?.() ||
        (typeof window !== "undefined" && (window.location.protocol === "capacitor:" || ((window as any).NG_APP_ROLE && window.location.hostname === "localhost")))
      );

      if (urlStr.startsWith("/api") && (isCapacitor || (this.serverUrl && this.serverUrl !== window.location.origin))) {
        targetUrl = `${this.serverUrl}${urlStr}`;
      }

      // Attach the current Supabase Auth access token, if signed in
      const existingHeaders = new Headers(init?.headers);
      if (!existingHeaders.has("Authorization")) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            existingHeaders.set("Authorization", `Bearer ${session.access_token}`);
          }
        } catch (err) {
          console.warn("[SyncEngine] Unable to read Supabase session for request auth:", err);
        }
      }

      // Reads give up after 12s; writes (trip saves recompute the route
      // server-side, uploads, etc.) get 60s — aborting a write early only
      // hides a save that the server still completes.
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const isWrite = method !== "GET" && method !== "HEAD";
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, isWrite ? 60000 : 12000);

      const modifiedInit: RequestInit = {
        ...init,
        headers: existingHeaders,
        signal: init?.signal || controller.signal,
      };

      try {
        const response = await (window as any)._originalFetch(targetUrl, modifiedInit);
        clearTimeout(timeout);
        return response;
      } catch (err: any) {
        clearTimeout(timeout);
        console.warn("[SyncEngine] Network request failed:", targetUrl, err.message);

        // Standardized offline / network error response so React Query and UI handle it cleanly
        const errorPayload = {
          success: false,
          error: timedOut
            ? {
                code: "TIMEOUT",
                message: isWrite
                  ? "The server is taking too long to respond. Your change may still have been saved — please check before trying again."
                  : "The server is taking too long to respond. Please try again.",
              }
            : {
                code: "NETWORK_ERROR",
                message: "Unable to reach server. Please check your internet connection.",
              },
        };

        return new Response(JSON.stringify(errorPayload), {
          status: timedOut ? 504 : 503,
          statusText: timedOut ? "Gateway Timeout" : "Service Unavailable",
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  }
}

declare global {
  interface Window {
    _originalFetch: typeof fetch;
    NG_APP_ROLE?: string;
  }
}

export const syncEngine = new SyncEngine();
