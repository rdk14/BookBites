import { useState, useRef, useEffect, useCallback } from "react";

// ── Google Fonts ──────────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap";
document.head.appendChild(fontLink);

// ── PDF.js loaded via CDN script tag ─────────────────────────────────────────
function loadPdfJs() {
  return new Promise((resolve) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    document.head.appendChild(script);
  });
}

// ── Palette & card themes ─────────────────────────────────────────────────────
const CARD_THEMES = [
  { bg: "#0d0d0d", accent: "#f5c842", text: "#f0ece4" },
  { bg: "#1a0a2e", accent: "#c77dff", text: "#e8d5ff" },
  { bg: "#042a2b", accent: "#5eb1bf", text: "#dff6f0" },
  { bg: "#1c1c1e", accent: "#ff6b6b", text: "#fff0f0" },
  { bg: "#0a1628", accent: "#4ecdc4", text: "#e0f7f6" },
  { bg: "#2d1515", accent: "#ff9a3c", text: "#fff4e8" },
  { bg: "#141414", accent: "#a8e063", text: "#f0ffe4" },
  { bg: "#1a1a2e", accent: "#e94560", text: "#ffe0e8" },
];

const TYPE_ICONS = {
  insight: "💡",
  quote: "❝",
  concept: "🧠",
  takeaway: "✦",
  story: "📖",
  stat: "◆",
};

// ── Google Sheets integration ─────────────────────────────────────────────────
async function loadFromGoogleSheets(bookTitle, pdfFilename) {
  const sheetsUrl = process.env.REACT_APP_SHEETS_URL;
  if (!sheetsUrl) return null;
  try {
    const url = `${sheetsUrl}?bookTitle=${encodeURIComponent(bookTitle)}${pdfFilename ? `&pdfFilename=${encodeURIComponent(pdfFilename)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.cards?.length > 0 ? data.cards : null;
  } catch (e) {
    console.error("Sheets load failed:", e);
    return null;
  }
}

async function saveToGoogleSheets(bookTitle, pdfFilename, cards) {
  const sheetsUrl = process.env.REACT_APP_SHEETS_URL;
  if (!sheetsUrl) return;
  try {
    await fetch(sheetsUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookTitle, pdfFilename, cards }),
    });
  } catch (e) {
    console.error("Sheets save failed:", e);
  }
}

// ── Claude API call ───────────────────────────────────────────────────────────
async function callClaude(prompt, systemPrompt) {
  const apiKey = process.env.REACT_APP_ANTHROPIC_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing API key. Add REACT_APP_ANTHROPIC_KEY to your Vercel environment variables and redeploy."
    );
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content?.map((b) => b.text || "").join("") || "";
}

// ── PDF text extraction ───────────────────────────────────────────────────────
async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += tc.items.map((it) => it.str).join(" ") + "\n\n";
  }
  return fullText;
}

// ── Chapter detection ─────────────────────────────────────────────────────────
async function detectChapters(text) {
  const sample = text.slice(0, 50000);
  const raw = await callClaude(
    `Analyze this book text and identify the chapters/sections. Return ONLY a JSON array like:
[{"title":"Chapter 1: The Beginning","startHint":"first few words of chapter"},...]
Identify up to 50 chapters. Text sample:\n\n${sample}`,
    "You are a book analysis expert. Return only valid JSON, no markdown backticks."
  );
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return [{ title: "Full Book Summary", startHint: "" }];
  }
}

// ── Card generation per chapter ───────────────────────────────────────────────
async function generateCardsForChapter(chapterTitle, chapterText, chapterIndex) {
  const truncated = chapterText.slice(0, 10000);
  const raw = await callClaude(
    `Create 6 Instagram-style knowledge cards for this book chapter. Each card should be a bite-sized insight.

Chapter: "${chapterTitle}"
Content: ${truncated}

Return ONLY a JSON array of 10 cards:
[{
  "type": "insight|quote|concept|takeaway|story|stat",
  "headline": "Short punchy headline (max 8 words)",
  "body": "Core idea in 2-3 sentences. Dense, informative, no fluff.",
  "detail": "1 extra sentence with a specific example or nuance.",
  "tag": "one-word topic tag"
}]`,
    "You are an expert at distilling books into memorable, insight-dense cards. Return only valid JSON, no markdown backticks."
  );
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const cards = JSON.parse(clean);
    return cards.map((c, i) => ({
      ...c,
      id: `ch${chapterIndex}-card${i}`,
      chapter: chapterTitle,
      chapterIndex,
      theme: CARD_THEMES[(chapterIndex * 6 + i) % CARD_THEMES.length],
    }));
  } catch {
    return [];
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080808; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(30px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%,100% { opacity: 1; } 50% { opacity: 0.4; }
  }
  @keyframes cardIn {
    from { opacity: 0; transform: scale(0.92) translateY(40px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  .app-shell {
    min-height: 100vh; background: #080808; color: #f0ece4;
    font-family: 'DM Sans', sans-serif;
    display: flex; flex-direction: column; align-items: center;
  }

  .upload-screen {
    width: 100%; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 40px 20px; position: relative; overflow: hidden;
  }
  .upload-bg {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 80% 60% at 50% 20%, #1a0a2e 0%, #080808 70%);
    z-index: 0;
  }
  .upload-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(197,125,255,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(197,125,255,0.04) 1px, transparent 1px);
    background-size: 60px 60px; z-index: 0;
  }
  .upload-content { position: relative; z-index: 1; text-align: center; max-width: 580px; }

  .brand-badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(197,125,255,0.12); border: 1px solid rgba(197,125,255,0.25);
    border-radius: 100px; padding: 6px 16px;
    font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 0.12em;
    color: #c77dff; text-transform: uppercase; margin-bottom: 32px;
  }
  .brand-dot { width: 6px; height: 6px; background: #c77dff; border-radius: 50%; animation: pulse 2s infinite; }

  .upload-title {
    font-family: 'Playfair Display', serif; font-size: clamp(42px, 8vw, 72px);
    font-weight: 900; line-height: 1.0; color: #f0ece4; margin-bottom: 8px;
  }
  .upload-title em { font-style: italic; color: #c77dff; }
  .upload-subtitle { font-size: 17px; color: #888; margin-bottom: 48px; line-height: 1.6; font-weight: 300; }

  .drop-zone {
    border: 1.5px dashed rgba(197,125,255,0.35); border-radius: 20px;
    padding: 48px 40px; cursor: pointer; transition: all 0.25s;
    background: rgba(197,125,255,0.03);
  }
  .drop-zone:hover, .drop-zone.drag-over {
    border-color: #c77dff; background: rgba(197,125,255,0.08); transform: scale(1.01);
  }
  .drop-zone-icon { font-size: 48px; margin-bottom: 16px; display: block; }
  .drop-zone-title { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: #f0ece4; margin-bottom: 8px; }
  .drop-zone-sub { font-size: 14px; color: #666; }
  .drop-zone input { display: none; }

  .feature-pills { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 32px; }
  .feature-pill { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 8px 16px; font-size: 13px; color: #aaa; }

  .processing-screen {
    width: 100%; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 40px 20px;
    background: radial-gradient(ellipse 80% 60% at 50% 20%, #0a1628 0%, #080808 70%);
  }
  .processing-book { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #4ecdc4; margin-bottom: 8px; text-align: center; max-width: 400px; }
  .processing-sub { font-size: 14px; color: #666; margin-bottom: 48px; }
  .progress-track { width: 320px; height: 2px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-bottom: 16px; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #4ecdc4, #c77dff); border-radius: 2px; transition: width 0.5s ease; }
  .progress-label { font-family: 'Space Mono', monospace; font-size: 12px; color: #4ecdc4; text-align: center; max-width: 320px; }

  .error-banner {
    background: rgba(255,80,80,0.1); border: 1px solid rgba(255,80,80,0.3);
    border-radius: 14px; padding: 20px 24px; margin-top: 28px;
    max-width: 400px; text-align: center; font-size: 13px; color: #ff9090; line-height: 1.7;
  }
  .error-banner strong { display: block; font-size: 15px; margin-bottom: 6px; color: #ffaaaa; }
  .retry-btn {
    margin-top: 14px; background: rgba(255,80,80,0.15); border: 1px solid rgba(255,80,80,0.35);
    border-radius: 8px; padding: 9px 22px; color: #ff9090; cursor: pointer;
    font-family: 'DM Sans', sans-serif; font-size: 13px; transition: all 0.2s;
  }
  .retry-btn:hover { background: rgba(255,80,80,0.25); }

  .chapter-list { margin-top: 40px; width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 8px; }
  .chapter-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.03); border-radius: 10px; font-size: 13px; }
  .chapter-item.done { color: #4ecdc4; }
  .chapter-item.active { color: #c77dff; }
  .chapter-item.pending { color: #444; }
  .chapter-status { font-size: 16px; min-width: 20px; }

  .reader-screen { width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
  .reader-header {
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; background: rgba(8,8,8,0.92); backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .reader-book-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 700; color: #f0ece4; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .reader-progress-text { font-family: 'Space Mono', monospace; font-size: 11px; color: #666; }
  .new-book-btn { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 7px 14px; font-size: 12px; color: #aaa; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
  .new-book-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }

  .stats-bar { display: flex; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; overflow: hidden; margin: 16px 24px 0; }
  .stat-item { flex: 1; text-align: center; padding: 14px 8px; border-right: 1px solid rgba(255,255,255,0.06); }
  .stat-item:last-child { border-right: none; }
  .stat-num { font-family: 'Space Mono', monospace; font-size: 20px; font-weight: 700; color: #c77dff; display: block; }
  .stat-label { font-size: 11px; color: #555; margin-top: 2px; }

  .chapter-nav { display: flex; gap: 8px; overflow-x: auto; padding: 16px 24px 0; scrollbar-width: none; background: #080808; }
  .chapter-nav::-webkit-scrollbar { display: none; }
  .chapter-nav-pill { flex-shrink: 0; padding: 8px 16px; border-radius: 100px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #666; transition: all 0.2s; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
  .chapter-nav-pill.active { background: #c77dff; border-color: #c77dff; color: #fff; }
  .chapter-nav-pill:hover:not(.active) { border-color: #555; color: #aaa; }

  @keyframes loadingPulse {
    0%,100% { opacity: 1; transform: scaleX(1); }
    50% { opacity: 0.5; transform: scaleX(0.97); }
  }
  .loading-more-indicator {
    display: flex; align-items: center; gap: 8px;
    margin: 0 24px 12px;
    padding: 8px 16px; border-radius: 100px;
    background: rgba(199,125,255,0.08); border: 1px solid rgba(199,125,255,0.2);
    font-family: 'Space Mono', monospace; font-size: 11px; color: #c77dff;
    animation: loadingPulse 2s ease-in-out infinite;
    align-self: flex-start;
  }
  .loading-more-dot { width: 6px; height: 6px; background: #c77dff; border-radius: 50%; animation: pulse 1.2s infinite; }

  .cards-feed { flex: 1; padding: 24px 16px 80px; display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 480px; margin: 0 auto; width: 100%; }

  .book-card { width: 100%; border-radius: 24px; overflow: hidden; position: relative; animation: cardIn 0.5s ease both; }
  .card-inner { padding: 32px 28px 28px; min-height: 320px; display: flex; flex-direction: column; }
  .card-content { flex: 1; display: flex; flex-direction: column; }
  .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .card-type-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 100px; font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; }
  .card-chapter-num { font-family: 'Space Mono', monospace; font-size: 11px; opacity: 0.4; }
  .card-icon { font-size: 40px; margin-bottom: 16px; display: block; line-height: 1; }
  .card-headline { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 900; line-height: 1.15; margin-bottom: 16px; letter-spacing: -0.02em; }
  .card-body { font-size: 15px; line-height: 1.65; opacity: 0.82; font-weight: 300; margin-bottom: 12px; }
  .card-detail { font-size: 13px; line-height: 1.6; opacity: 0.5; font-style: italic; }
  .card-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); }
  .card-tag { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.5; }
  .card-save-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: inherit; transition: all 0.2s; font-family: 'DM Sans', sans-serif; }
  .card-save-btn:hover { background: rgba(255,255,255,0.15); }
  .card-save-btn.saved { background: rgba(255,255,255,0.15); }

  .chapter-divider { width: 100%; text-align: center; padding: 8px 0; }
  .chapter-divider-label { display: inline-block; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 8px 20px; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: #666; text-transform: uppercase; }

  .empty-state { text-align: center; padding: 60px 20px; color: #444; }
  .empty-state h3 { font-family: 'Playfair Display', serif; font-size: 22px; color: #666; margin-bottom: 8px; }

  .saved-fab { position: fixed; bottom: 28px; right: 24px; background: #c77dff; border: none; border-radius: 100px; padding: 12px 20px; display: flex; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500; color: #fff; cursor: pointer; z-index: 200; box-shadow: 0 8px 32px rgba(199,125,255,0.4); transition: all 0.2s; }
  .saved-fab:hover { transform: scale(1.04); }
  .saved-count { background: rgba(0,0,0,0.2); border-radius: 100px; padding: 2px 8px; font-size: 12px; }

  .saved-drawer { position: fixed; inset: 0; z-index: 300; display: flex; flex-direction: column; background: #0d0d0d; animation: fadeUp 0.25s ease; }
  .saved-drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.07); }
  .close-btn { background: rgba(255,255,255,0.07); border: none; border-radius: 8px; padding: 8px 14px; color: #aaa; cursor: pointer; font-size: 14px; font-family: 'DM Sans', sans-serif; }
  .saved-drawer-body { flex: 1; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;

// ── Card Component ────────────────────────────────────────────────────────────
function BookCard({ card, index, savedIds, onToggleSave }) {
  const { theme } = card;
  const isSaved = savedIds.has(card.id);

  return (
    <div className="book-card" style={{ animationDelay: `${(index % 10) * 0.05}s`, background: theme.bg }}>
      <div className="card-inner">
        <div className="card-content">
          <div className="card-top">
            <span className="card-type-badge" style={{ background: `${theme.accent}22`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>
              {TYPE_ICONS[card.type] || "✦"} {card.type}
            </span>
            <span className="card-chapter-num" style={{ color: theme.text }}>
              {card.chapter?.replace(/chapter/i, "Ch.").slice(0, 20)}
            </span>
          </div>
          <span className="card-icon">{TYPE_ICONS[card.type] || "✦"}</span>
          <h2 className="card-headline" style={{ color: theme.text }}>{card.headline}</h2>
          <p className="card-body" style={{ color: theme.text }}>{card.body}</p>
          {card.detail && <p className="card-detail" style={{ color: theme.text }}>{card.detail}</p>}
          <div className="card-bottom">
            <span className="card-tag" style={{ color: theme.accent }}>#{card.tag}</span>
            <button className={`card-save-btn ${isSaved ? "saved" : ""}`} style={{ color: theme.text }} onClick={() => onToggleSave(card.id)}>
              {isSaved ? "✦ Saved" : "✦ Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("upload");
  const [dragOver, setDragOver] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [chapters, setChapters] = useState([]);
  const [chapterStatus, setChapterStatus] = useState({});
  const [allCards, setAllCards] = useState([]);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [savedIds, setSavedIds] = useState(new Set());
  const [showSaved, setShowSaved] = useState(false);
  const [activeChapter, setActiveChapter] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = styles;
    document.head.appendChild(s);
    return () => s.remove();
  }, []);

  const resetToUpload = () => {
    setScreen("upload");
    setAllCards([]);
    setChapters([]);
    setErrorMsg("");
    setProgress(0);
    setProgressLabel("");
    setIsLoadingMore(false);
  };

  const processFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") return;
    setErrorMsg("");
    const pdfFilename = file.name;
    const bookTitle = pdfFilename.replace(/\.pdf$/i, "").trim();
    setBookTitle(bookTitle);
    setScreen("processing");
    setProgress(5);
    setProgressLabel("Checking for existing cards in Google Sheets…");
    setAllCards([]);
    setChapters([]);

    const existingCards = await loadFromGoogleSheets(bookTitle, pdfFilename);
    if (existingCards) {
      const uniqueChapters = [
        ...new Map(existingCards.map((c) => [c.chapter, { title: c.chapter }])).values(),
      ];
      setChapters(uniqueChapters);
      const statusMap = {};
      uniqueChapters.forEach((_, i) => { statusMap[i] = "done"; });
      setChapterStatus(statusMap);
      setAllCards(existingCards);
      setActiveChapter(0);
      setProgress(100);
      setProgressLabel("Loaded from Google Sheets!");
      setScreen("reader");
      return;
    }

    setProgressLabel("Extracting text from PDF…");

    let pdfText;
    try {
      pdfText = await extractPdfText(file);
    } catch (e) {
      setErrorMsg("Could not read this PDF. Make sure it's a text-based PDF (not a scanned image).");
      return;
    }

    setProgress(15);
    setProgressLabel("Detecting chapters…");

    let detectedChapters;
    try {
      detectedChapters = await detectChapters(pdfText);
    } catch (e) {
      setErrorMsg(e.message || "Failed to connect to AI. Check your REACT_APP_ANTHROPIC_KEY in Vercel.");
      return;
    }

    setChapters(detectedChapters);
    const initStatus = {};
    detectedChapters.forEach((_, i) => (initStatus[i] = "pending"));
    setChapterStatus(initStatus);

    const textLen = pdfText.length;
    const perChapter = Math.floor(textLen / detectedChapters.length);
    let collected = [];

    // ── Process chapter 0 first, then show reader ──
    setChapterStatus((s) => ({ ...s, 0: "active" }));
    setProgress(20);
    setProgressLabel(`Generating cards for "${detectedChapters[0].title}"…`);

    const start0 = 0;
    const end0 = detectedChapters.length === 1 ? textLen : perChapter;

    try {
      const cards0 = await generateCardsForChapter(detectedChapters[0].title, pdfText.slice(start0, end0), 0);
      collected = [...cards0];
      setAllCards([...collected]);
    } catch (e) {
      setErrorMsg(e.message || "API error while generating cards. Check your API key.");
      return;
    }
    setChapterStatus((s) => ({ ...s, 0: "done" }));

    // Transition to reader immediately after chapter 0 is ready
    setActiveChapter(0);
    setScreen("reader");

    // ── Continue loading remaining chapters in the background ──
    if (detectedChapters.length > 1) {
      setIsLoadingMore(true);
      for (let i = 1; i < detectedChapters.length; i++) {
        setChapterStatus((s) => ({ ...s, [i]: "active" }));
        setProgress(20 + Math.floor((i / detectedChapters.length) * 75));
        setProgressLabel(`Generating cards for "${detectedChapters[i].title}"…`);

        const start = i * perChapter;
        const end = i === detectedChapters.length - 1 ? textLen : (i + 1) * perChapter;

        try {
          const cards = await generateCardsForChapter(detectedChapters[i].title, pdfText.slice(start, end), i);
          collected = [...collected, ...cards];
          setAllCards([...collected]);
        } catch (e) {
          setErrorMsg(e.message || "API error while generating cards. Check your API key.");
          setIsLoadingMore(false);
          return;
        }
        setChapterStatus((s) => ({ ...s, [i]: "done" }));
      }
      setIsLoadingMore(false);
    }

    setProgress(100);
    setProgressLabel("Done! Your book is ready.");
    await saveToGoogleSheets(bookTitle, pdfFilename, collected);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  const toggleSave = (id) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const visibleCards = activeChapter === null ? allCards : allCards.filter((c) => c.chapterIndex === activeChapter);
  const savedCards = allCards.filter((c) => savedIds.has(c.id));

  // ── Upload ──
  if (screen === "upload") {
    return (
      <div className="app-shell">
        <div className="upload-screen">
          <div className="upload-bg" /><div className="upload-grid" />
          <div className="upload-content">
            <div className="brand-badge"><div className="brand-dot" />BookBites AI</div>
            <h1 className="upload-title">Read Smarter,<br /><em>Not Longer</em></h1>
            <p className="upload-subtitle">Drop any PDF book. AI extracts every chapter and transforms it into Instagram-style cards — zero fluff, zero lost insights.</p>
            <div className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}>
              <input ref={fileInputRef} type="file" accept="application/pdf" data-testid="file-input" onChange={(e) => processFile(e.target.files[0])} />
              <span className="drop-zone-icon">📚</span>
              <div className="drop-zone-title">Drop your PDF here</div>
              <div className="drop-zone-sub">or click to browse</div>
            </div>
            <div className="feature-pills">
              {["Chapter Detection", "6 Cards per Chapter", "Save Insights", "Zero Fluff"].map((f) => (
                <div key={f} className="feature-pill">{f}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Processing ──
  if (screen === "processing") {
    return (
      <div className="app-shell">
        <div className="processing-screen">
          <div className="brand-badge" style={{ marginBottom: 16 }}><div className="brand-dot" />Processing</div>
          <div className="processing-book">"{bookTitle}"</div>
          <div className="processing-sub">Turning pages into insights…</div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <div className="progress-label">{progress}% — {progressLabel}</div>

          {errorMsg && (
            <div className="error-banner">
              <strong>⚠ Something went wrong</strong>
              {errorMsg}
              <br />
              <button className="retry-btn" onClick={resetToUpload}>← Go Back</button>
            </div>
          )}

          {chapters.length > 0 && !errorMsg && (
            <div className="chapter-list">
              {chapters.slice(0, 8).map((ch, i) => (
                <div key={i} className={`chapter-item ${chapterStatus[i] || "pending"}`}>
                  <span className="chapter-status">
                    {chapterStatus[i] === "done" ? "✓" : chapterStatus[i] === "active" ? "◌" : "○"}
                  </span>
                  {ch.title}
                </div>
              ))}
              {chapters.length > 8 && (
                <div className="chapter-item pending"><span className="chapter-status">○</span>+{chapters.length - 8} more…</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Reader ──
  return (
    <div className="app-shell">
      <div className="reader-screen">
        <div className="reader-header">
          <div className="reader-book-title">📚 {bookTitle}</div>
          <div className="reader-progress-text">{allCards.length} cards · {chapters.length} chapters</div>
          <button className="new-book-btn" onClick={resetToUpload}>+ New Book</button>
        </div>

        <div className="stats-bar">
          <div className="stat-item"><span className="stat-num">{chapters.length}</span><div className="stat-label">Chapters</div></div>
          <div className="stat-item"><span className="stat-num">{allCards.length}</span><div className="stat-label">Cards</div></div>
          <div className="stat-item"><span className="stat-num">{savedIds.size}</span><div className="stat-label">Saved</div></div>
          <div className="stat-item"><span className="stat-num">{Math.round((visibleCards.length / Math.max(allCards.length, 1)) * 100)}%</span><div className="stat-label">Viewing</div></div>
        </div>

        <div className="chapter-nav">
          <button className={`chapter-nav-pill ${activeChapter === null ? "active" : ""}`} onClick={() => setActiveChapter(null)}>All</button>
          {chapters.map((ch, i) => (
            <button key={i} className={`chapter-nav-pill ${activeChapter === i ? "active" : ""}`} onClick={() => setActiveChapter(i)}>Ch.{i + 1}</button>
          ))}
        </div>

        {isLoadingMore && (
          <div className="loading-more-indicator">
            <div className="loading-more-dot" />
            Loading more chapters…
          </div>
        )}

        <div className="cards-feed">
          {visibleCards.length === 0 ? (
            <div className="empty-state"><h3>No cards yet</h3><p>Still generating…</p></div>
          ) : (
            visibleCards.map((card, idx) => {
              const showDivider = idx > 0 && card.chapterIndex !== visibleCards[idx - 1].chapterIndex;
              return (
                <div key={card.id} style={{ width: "100%" }}>
                  {showDivider && (
                    <div className="chapter-divider">
                      <span className="chapter-divider-label">{chapters[card.chapterIndex]?.title || `Chapter ${card.chapterIndex + 1}`}</span>
                    </div>
                  )}
                  <BookCard card={card} index={idx} savedIds={savedIds} onToggleSave={toggleSave} />
                </div>
              );
            })
          )}
        </div>
      </div>

      {savedIds.size > 0 && (
        <button className="saved-fab" onClick={() => setShowSaved(true)}>
          ✦ Saved <span className="saved-count">{savedIds.size}</span>
        </button>
      )}

      {showSaved && (
        <div className="saved-drawer">
          <div className="saved-drawer-header">
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700 }}>✦ Saved Insights</span>
            <button className="close-btn" onClick={() => setShowSaved(false)}>Close</button>
          </div>
          <div className="saved-drawer-body">
            {savedCards.length === 0
              ? <div className="empty-state"><h3>Nothing saved yet</h3><p>Tap ✦ Save on any card.</p></div>
              : savedCards.map((card, idx) => <BookCard key={card.id} card={card} index={idx} savedIds={savedIds} onToggleSave={toggleSave} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}