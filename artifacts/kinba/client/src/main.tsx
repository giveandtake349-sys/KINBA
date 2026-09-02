import { apiUrl } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();
const API_FETCH_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof globalThis.fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await globalThis.fetch(input, { ...(init ?? {}), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error("KINBA backend request timed out after 10 seconds. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
};

const logApiError = (error: unknown) => {
  if (error instanceof TRPCClientError) console.error("[API Error]", error.message, error.data);
  else console.error("[API Error]", error);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") logApiError(event.query.state.error);
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") logApiError(event.mutation.state.error);
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: apiUrl("/api/trpc"),
      transformer: superjson,
      async headers() {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      },
      fetch(input, init) {
        return fetchWithTimeout(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
