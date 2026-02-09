import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("public");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// SVG base (logo: quadrato con gradiente + "GS")
function makeSvg(size, { padded = false } = {}) {
  // Per maskable: aggiungiamo padding/area sicura
  const pad = padded ? Math.round(size * 0.12) : 0; // 12% padding
  const inner = size - pad * 2;
  const fontSize = Math.round(inner * 0.42);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#22c55e"/>
        <stop offset="55%" stop-color="#16a34a"/>
        <stop offset="100%" stop-color="#3b82f6"/>
      </linearGradient>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="rgba(0,0,0,0.45)"/>
      </filter>
    </defs>

    <rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size*0.22)}" fill="url(#g)"/>
    <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${Math.round(inner*0.22)}"
          fill="rgba(0,0,0,0.18)" filter="url(#s)"/>

    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
          font-size="${fontSize}" font-weight="900" fill="rgba(255,255,255,0.92)"
          letter-spacing="-0.04em">GS</text>
  </svg>`;
}

async function writePng(filename, size, opts = {}) {
  const svg = makeSvg(size, opts);
  const buf = Buffer.from(svg);
  const outPath = path.join(outDir, filename);

  await sharp(buf)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);

  console.log("✅ generated", outPath);
}

(async () => {
  await writePng("pwa-192.png", 192);
  await writePng("pwa-512.png", 512);
  await writePng("pwa-512-maskable.png", 512, { padded: true });
  await writePng("apple-touch-icon.png", 180);
  console.log("\n🎉 Icons done! (public/)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
