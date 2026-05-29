/// <reference lib="webworker" />

/** Decode + JSON.parse off the main thread so Android WebView stays responsive. */
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const text = new TextDecoder().decode(event.data);
    const data = JSON.parse(text) as unknown;
    self.postMessage({ ok: true as const, data });
  } catch (err) {
    self.postMessage({ ok: false as const, error: err instanceof Error ? err.message : String(err) });
  }
};
