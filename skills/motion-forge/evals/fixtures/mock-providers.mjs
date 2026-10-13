// Local stand-in for the fal / Replicate / ElevenLabs HTTP APIs, used by run-evals case L to check each adapter's request
// shape, auth header, polling and download handling without real keys or network. It records every request it sees.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

export async function startMock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mfmock-"));
  const png = path.join(dir, "x.png"), mp3 = path.join(dir, "x.mp3"), mp4 = path.join(dir, "x.mp4");
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x3366aa:s=64x64", "-frames:v", "1", png]);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=0.5", "-c:a", "libmp3lame", mp3]);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x226644:s=64x64:d=1", "-pix_fmt", "yuv420p", mp4]);
  const seen = []; let polls = 0;
  const srv = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
      const u = req.url, base = `http://127.0.0.1:${srv.address().port}`;
      seen.push({ method: req.method, url: u, auth: req.headers.authorization || req.headers["xi-api-key"] || "", prefer: req.headers.prefer || "", body: body ? JSON.parse(body) : null });
      const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const file = (f, type) => { res.writeHead(200, { "content-type": type }); res.end(fs.readFileSync(f)); };
      if (u === "/files/x.png") return file(png, "image/png");
      if (u === "/files/x.mp4") return file(mp4, "video/mp4");
      if (u.startsWith("/fal-ai/flux")) return json({ images: [{ url: `${base}/files/x.png` }] });
      if (u.startsWith("/fal-ai/ltx-video")) return json({ video: { url: `${base}/files/x.mp4` } });
      if (u.startsWith("/v1/models/") && req.method === "POST") return json({ status: "starting", urls: { get: `${base}/v1/predictions/p1` } });
      if (u === "/v1/predictions/p1") return json(++polls < 2 ? { status: "processing", urls: { get: `${base}/v1/predictions/p1` } } : { status: "succeeded", output: [`${base}/files/x.png`] });
      if (u.startsWith("/v1/text-to-speech/") || u === "/v1/sound-generation") return file(mp3, "audio/mpeg");
      if (u.startsWith("/fail")) return json({ error: "boom" }, 500);
      json({ error: "not found " + u }, 404);
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
