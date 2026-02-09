// src/lib/quotes.ts

const localQuotes = [
  "Oggi non serve perfetto: serve fatto.",
  "La costanza batte il talento quando il talento non è costante.",
  "Un passo alla volta, ogni giorno.",
  "Se è difficile, è perché ti sta cambiando.",
  "Non stai perdendo tempo: stai costruendo disciplina.",
  "Allenati per la persona che vuoi diventare.",
  "La motivazione ti avvia, l’abitudine ti porta lontano.",
  "Piccoli progressi = grandi risultati.",
];

function pickLocal(exclude?: string) {
  const pool = localQuotes.filter(q => q !== exclude);
  const arr = pool.length ? pool : localQuotes;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fetchWithTimeout(url: string, ms = 7000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Restituisce SEMPRE una frase:
 * 1) prova Quotable (CORS ok)
 * 2) prova ZenQuotes via CORS proxy
 * 3) fallback locale (sempre)
 */
export async function fetchQuote(prev?: string): Promise<string> {
  // 1) Quotable (di solito funziona bene da browser)
  try {
    const res = await fetchWithTimeout("https://api.quotable.io/random", 7000);
    if (res.ok) {
      const data = await res.json();
      const content = String(data?.content ?? "").trim();
      const author = String(data?.author ?? "").trim();
      if (content) {
        const out = author ? `“${content}” — ${author}` : `“${content}”`;
        if (out !== prev) return out;
      }
    }
  } catch {
    // ignore
  }

  // 2) ZenQuotes (spesso CORS -> proxy)
  try {
    const target = "https://zenquotes.io/api/random";
    const url = "https://corsproxy.io/?" + encodeURIComponent(target);
    const res = await fetchWithTimeout(url, 7000);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.q) {
        const q = String(data[0].q).trim();
        const a = data[0].a ? String(data[0].a).trim() : "";
        const out = a ? `“${q}” — ${a}` : `“${q}”`;
        if (out !== prev) return out;
      }
    }
  } catch {
    // ignore
  }

  // 3) Fallback locale: sempre funzionante
  return pickLocal(prev);
}
