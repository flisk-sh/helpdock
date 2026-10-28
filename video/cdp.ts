// Minimal Chrome DevTools Protocol driver: launch headless Chrome, open a page, run commands.
import { spawn } from "bun";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Extra flags, e.g. CHROME_FLAGS="--no-sandbox" inside a container
const EXTRA = (process.env.CHROME_FLAGS ?? "").split(" ").filter(Boolean);

export async function launch(port = 9333) {
  const profile = `${import.meta.dir}/.chrome-profile`;
  const proc = spawn([CHROME, "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--no-first-run", ...EXTRA, "about:blank"],
    { stdout: "ignore", stderr: "ignore" });
  let targets: any[] = [];
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await Bun.sleep(200);
  }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const listeners: ((m: any) => void)[] = [];
  ws.onmessage = e => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    else listeners.forEach(l => l(m));
  };
  const send = (method: string, params: any = {}) => new Promise<any>((res, rej) => {
    const i = ++id; pending.set(i, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Page.enable");
  const loaded = () => new Promise<void>(r => { const l = (m: any) => { if (m.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
  return {
    send,
    async viewport(width: number, height: number, scale = 1) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    },
    async goto(url: string, settle = 1500) {
      const l = loaded(); await send("Page.navigate", { url }); await Promise.race([l, Bun.sleep(15000)]); await Bun.sleep(settle);
    },
    async evaluate(expr: string) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async png(format: "png" | "jpeg" = "png", quality = 92): Promise<Uint8Array> {
      const r = await send("Page.captureScreenshot", { format, quality: format === "jpeg" ? quality : undefined, fromSurface: true });
      return Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
    },
    close() { ws.close(); proc.kill(); },
  };
}
