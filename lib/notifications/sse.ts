import { subscribe, type RealtimeEvent } from "@/lib/notifications/bus";

/** Server-Sent Events stream over one or more bus topics, with heartbeats and cleanup. */
export function sseResponse(signal: AbortSignal, topicList: string[]): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (e: RealtimeEvent) => send(`id: ${e.id}\nevent: message\ndata: ${JSON.stringify(e)}\n\n`);
      const unsubs = topicList.map((t) => subscribe(t, onEvent));
      // Tell the client how long to wait before reconnecting, then confirm the subscription.
      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: {}\n\n`);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 20_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubs.forEach((u) => u());
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
