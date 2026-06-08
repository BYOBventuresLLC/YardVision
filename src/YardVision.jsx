import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Upload, Plus, Trash2, Check, Sparkles, Eye, Pencil, DollarSign, ArrowRight, Leaf, Settings, AlertTriangle } from "lucide-react";

// ───────────────────────────────────────────────────────────
// YardVision — now wired to a REAL image-edit backend.
// Set your deployed endpoint (the /api/generate function) below
// or paste it into the Settings field in the header.
// ───────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "/api/generate"; // same-domain on Vercel — no change needed

const fmt = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SWATCHES = ["#6b8f3e", "#c98a3a", "#3f6f6b", "#8a5a3c", "#4a7a99", "#9c6b9e"];

// Build a self-contained "after" placeholder (SVG data URL) so the full flow
// can be demoed with no backend. Clearly a mock — labeled DEMO in the UI.
function demoAfterImage(taskNames) {
  const labels = taskNames.slice(0, 4);
  const chips = labels
    .map(
      (n, i) =>
        `<g transform="translate(24,${230 - i * 34})">
           <rect width="${Math.min(260, 60 + n.length * 8)}" height="24" rx="12" fill="rgba(0,0,0,0.45)"/>
           <text x="12" y="16" fill="#fff" font-family="sans-serif" font-size="12" font-weight="600">${escapeXml(n)}</text>
         </g>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#bcd9e8"/><stop offset="1" stop-color="#e4f0e0"/>
      </linearGradient>
      <linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7cae4a"/><stop offset="1" stop-color="#5a8a34"/>
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#sky)"/>
    <rect y="150" width="400" height="150" fill="url(#lawn)"/>
    <path d="M150 300 Q200 210 250 300 Z" fill="#cbb58a"/>
    <ellipse cx="70" cy="150" rx="46" ry="52" fill="#3f7a37"/>
    <ellipse cx="330" cy="158" rx="40" ry="46" fill="#46874a"/>
    <circle cx="120" cy="185" r="10" fill="#d96a8f"/><circle cx="140" cy="195" r="9" fill="#e89b3c"/>
    <circle cx="270" cy="190" r="10" fill="#c77fb0"/><circle cx="290" cy="198" r="9" fill="#e0c24a"/>
    ${chips}
  </svg>`;
  // Unicode-safe base64 (btoa throws on em-dashes, accents, etc.)
  const b64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}


// Downscale + re-encode the photo BEFORE sending it to the backend.
// WHY: phone photos are several MB; once base64-inflated (~+33%) they blow
// past Vercel's ~4.5MB serverless request-body limit → a 413 "Payload Too
// Large" error and no image. Resizing to 1536px on the long edge as JPEG
// drops it to a few hundred KB — and that's the resolution Gemini wants
// anyway, so the render quality is unaffected.
function fileToBase64(file, maxDim = 1536, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      // toDataURL → "data:image/jpeg;base64,<data>"; we want just the data.
      const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      resolve({ base64, mimeType: "image/jpeg" });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image file."));
    };
    img.src = url;
  });
}

export default function YardVision() {
  const [mode, setMode] = useState("build");
  const [beforeImg, setBeforeImg] = useState(null);
  const [beforeFile, setBeforeFile] = useState(null);
  const [afterImg, setAfterImg] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [showSettings, setShowSettings] = useState(false);
  const [demoMode, setDemoMode] = useState("auto"); // "auto" | "on" | "off"
  const [isDemoResult, setIsDemoResult] = useState(false); // was the current after-img a placeholder?
  const [tasks, setTasks] = useState([
    { id: 1, name: "Sod installation — front lawn", price: 2400, on: true, color: "#6b8f3e" },
    { id: 2, name: "Flagstone walkway", price: 3100, on: true, color: "#c98a3a" },
    { id: 3, name: "Mulch + perennial beds", price: 950, on: true, color: "#3f6f6b" },
  ]);
  const fileRef = useRef(null);
  const nextId = useRef(4);
  const lastSignature = useRef(null); // what we last generated, to avoid duplicate calls

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBeforeImg(URL.createObjectURL(f));
    setBeforeFile(f);
    setAfterImg(null);
    setError(null);
    lastSignature.current = null; // new photo → allow a fresh generation
  };

  // ── Generation: real backend call, with demo fallback. ──
  const generateAfter = useCallback(async () => {
    if (!beforeFile) return;
    const activeTasks = tasks.filter((t) => t.on && t.name.trim()).map((t) => ({ name: t.name.trim() }));
    if (activeTasks.length === 0) return; // nothing to visualize yet

    const signature = `${demoMode}|${beforeFile.name}:${beforeFile.size}|${activeTasks.map((t) => t.name).join("||")}`;
    if (signature === lastSignature.current) return;

    const names = activeTasks.map((t) => t.name);

    // Forced demo mode: skip the network entirely.
    if (demoMode === "on") {
      setGenerating(true);
      setError(null);
      setTimeout(() => {
        setAfterImg(demoAfterImage(names));
        setIsDemoResult(true);
        lastSignature.current = signature;
        setGenerating(false);
      }, 1400);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const { base64, mimeType } = await fileToBase64(beforeFile);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType, tasks: activeTasks }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.image) throw new Error("No image came back from the server.");
      setAfterImg(data.image);
      setIsDemoResult(false);
      lastSignature.current = signature;
    } catch (err) {
      // In auto mode, a missing/unreachable backend (preview, no deploy yet)
      // falls back to the demo placeholder instead of a scary error.
      const looksLikeNoBackend =
        demoMode === "auto" &&
        (err.message.includes("Failed to fetch") ||
          err.message.includes("404") ||
          err.message.includes("Unexpected token")); // HTML 404 page parsed as JSON
      if (looksLikeNoBackend) {
        setAfterImg(demoAfterImage(names));
        setIsDemoResult(true);
        lastSignature.current = signature;
      } else {
        setError(
          err.message.includes("Failed to fetch")
            ? "Couldn't reach the backend. Check your endpoint URL in Settings and that the function is deployed."
            : err.message
        );
      }
    } finally {
      setGenerating(false);
    }
  }, [beforeFile, tasks, endpoint, demoMode]);

  // ── AUTO-GENERATE: once there's a photo + at least one named task, fire
  //    automatically — but debounced 1.5s so it waits until the landscaper
  //    stops typing, and the signature guard prevents duplicate billing. ──
  const activeTaskKey = tasks.filter((t) => t.on && t.name.trim()).map((t) => t.name.trim()).join("||");
  useEffect(() => {
    if (!beforeFile || !activeTaskKey) return;
    const timer = setTimeout(() => { generateAfter(); }, 1500);
    return () => clearTimeout(timer); // reset the clock on every edit
  }, [beforeFile, activeTaskKey, generateAfter]);

  const addTask = () =>
    setTasks((t) => [
      ...t,
      { id: nextId.current++, name: "", price: 0, on: true, color: SWATCHES[t.length % SWATCHES.length] },
    ]);
  const updateTask = (id, patch) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeTask = (id) => setTasks((t) => t.filter((x) => x.id !== id));

  const selected = useMemo(() => tasks.filter((t) => t.on), [tasks]);
  const total = useMemo(() => selected.reduce((s, t) => s + (Number(t.price) || 0), 0), [selected]);
  const fullTotal = useMemo(() => tasks.reduce((s, t) => s + (Number(t.price) || 0), 0), [tasks]);

  return (
    <div style={styles.app}>
      <style>{css}</style>

      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.logoBadge}><Leaf size={20} strokeWidth={2.4} /></div>
          <div>
            <div style={styles.brandName}>YardVision</div>
            <div style={styles.brandSub}>See it before you dig.</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.toggle}>
            <button onClick={() => setMode("build")} style={{ ...styles.toggleBtn, ...(mode === "build" ? styles.toggleOn : {}) }}>
              <Pencil size={15} /> Landscaper
            </button>
            <button onClick={() => setMode("review")} style={{ ...styles.toggleBtn, ...(mode === "review" ? styles.toggleOn : {}) }}>
              <Eye size={15} /> Customer
            </button>
          </div>
          <button style={styles.gearBtn} onClick={() => setShowSettings((s) => !s)}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      {showSettings && (
        <div style={styles.settingsBar}>
          <label style={styles.settingsLabel}>Backend endpoint</label>
          <input
            style={styles.endpointInput}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://your-app.vercel.app/api/generate"
          />
          <span style={styles.settingsHint}>This is your deployed /api/generate function. The API key stays server-side.</span>

          <label style={{ ...styles.settingsLabel, marginTop: 12 }}>Demo mode</label>
          <div style={styles.demoToggle}>
            {[
              ["auto", "Auto"],
              ["on", "Always demo"],
              ["off", "Real only"],
            ].map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => { setDemoMode(val); lastSignature.current = null; }}
                style={{ ...styles.demoBtn, ...(demoMode === val ? styles.demoBtnOn : {}) }}
              >
                {lbl}
              </button>
            ))}
          </div>
          <span style={styles.settingsHint}>
            Auto: uses the real backend, falls back to a placeholder if none is deployed (great for previews).
            Always demo: never calls the API. Real only: always calls the backend and shows errors.
          </span>
        </div>
      )}

      <main style={styles.main}>
        <section style={styles.visualCol}>
          <div style={styles.imageGrid}>
            <ImagePane label="Before" img={beforeImg} empty="Upload a photo of the yard" onClick={() => mode === "build" && fileRef.current?.click()} clickable={mode === "build"} />
            <ImagePane label="After" img={afterImg} overlay={afterImg && selected} generating={generating} isDemo={isDemoResult} empty={beforeImg ? "Generate the vision →" : "Add a before photo first"} />
          </div>

          {error && (
            <div style={styles.errorBox}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {mode === "build" && (
            <>
              <div style={styles.visualActions}>
                <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{ display: "none" }} />
                <button style={styles.ghostBtn} onClick={() => fileRef.current?.click()}>
                  <Upload size={16} /> {beforeImg ? "Replace photo" : "Upload photo"}
                </button>
                <button style={{ ...styles.primaryBtn, opacity: beforeImg ? 1 : 0.45 }} onClick={() => { lastSignature.current = null; generateAfter(); }} disabled={!beforeImg || generating}>
                  <Sparkles size={16} /> {generating ? "Generating…" : "Regenerate"}
                </button>
              </div>
              <p style={styles.hint}>
                The after-photo generates automatically a moment after you upload a photo and name your
                tasks — no button needed. Hit Regenerate any time you want a fresh take on the same setup.
              </p>
            </>
          )}
        </section>

        <section style={styles.taskCol}>
          {mode === "build" ? (
            <>
              <div style={styles.colHead}>
                <h2 style={styles.h2}>Scope & pricing</h2>
                <span style={styles.count}>{tasks.length} tasks</span>
              </div>
              <div style={styles.taskList}>
                {tasks.map((t) => (
                  <div key={t.id} style={styles.editRow}>
                    <span style={{ ...styles.dot, background: t.color }} />
                    <input style={styles.nameInput} placeholder="Task name (e.g. Retaining wall)" value={t.name} onChange={(e) => updateTask(t.id, { name: e.target.value })} />
                    <div style={styles.priceWrap}>
                      <DollarSign size={14} style={{ opacity: 0.5 }} />
                      <input style={styles.priceInput} type="number" value={t.price} onChange={(e) => updateTask(t.id, { price: e.target.value })} />
                    </div>
                    <button style={styles.iconBtn} onClick={() => removeTask(t.id)}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <button style={styles.addBtn} onClick={addTask}><Plus size={16} /> Add task</button>
              <div style={styles.totalCard}><span>Full project total</span><strong>{fmt(fullTotal)}</strong></div>
              <button style={styles.sendBtn} onClick={() => setMode("review")}>Preview customer view <ArrowRight size={16} /></button>
            </>
          ) : (
            <>
              <div style={styles.colHead}>
                <h2 style={styles.h2}>Build your project</h2>
                <span style={styles.count}>Pick what you want</span>
              </div>
              <p style={styles.custIntro}>Tap any item to add or remove it. Your total updates instantly.</p>
              <div style={styles.taskList}>
                {tasks.map((t) => (
                  <button key={t.id} style={{ ...styles.pickRow, ...(t.on ? styles.pickOn : {}) }} onClick={() => updateTask(t.id, { on: !t.on })}>
                    <span style={{ ...styles.check, background: t.on ? t.color : "transparent", borderColor: t.on ? t.color : "#cdc7bb" }}>
                      {t.on && <Check size={14} strokeWidth={3} color="#fff" />}
                    </span>
                    <span style={styles.pickName}>{t.name || "Untitled task"}</span>
                    <span style={styles.pickPrice}>{fmt(Number(t.price) || 0)}</span>
                  </button>
                ))}
              </div>
              <div style={styles.totalCardBig}>
                <div>
                  <div style={styles.totalLabel}>Your total</div>
                  <div style={styles.totalNote}>{selected.length} of {tasks.length} selected</div>
                </div>
                <strong style={styles.totalBig}>{fmt(total)}</strong>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function ImagePane({ label, img, empty, onClick, clickable, generating, overlay, isDemo }) {
  return (
    <div style={{ ...paneStyles.pane, cursor: clickable ? "pointer" : "default" }} onClick={onClick}>
      <span style={paneStyles.tag}>{label}</span>
      {isDemo && img && !generating && <span style={paneStyles.demoBadge}>DEMO</span>}
      {generating && (
        <div style={paneStyles.gen}><Sparkles size={26} className="spin" /><span>Visualizing…</span></div>
      )}
      {!generating && img && (
        <>
          <img src={img} alt={label} style={paneStyles.img} />
          {overlay && (
            <div style={paneStyles.afterOverlay}>
              {overlay.slice(0, 4).map((t) => (
                <span key={t.id} style={{ ...paneStyles.chip, background: t.color }}>{t.name || "Task"}</span>
              ))}
            </div>
          )}
        </>
      )}
      {!generating && !img && (
        <div style={paneStyles.placeholder}>
          {clickable ? <Upload size={24} /> : <Sparkles size={24} />}<span>{empty}</span>
        </div>
      )}
    </div>
  );
}

const css = `
  * { box-sizing: border-box; }
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Albert+Sans:wght@400;500;600&display=swap');
  .spin { animation: spin 1.1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input:focus { outline: none; }
  button { font-family: inherit; cursor: pointer; }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
`;

const styles = {
  app: { fontFamily: "'Albert Sans', sans-serif", background: "radial-gradient(circle at 20% 0%, #f3efe4 0%, #e8e2d2 55%, #ddd5c1 100%)", minHeight: "100vh", color: "#2b2a24", padding: "0 0 48px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 32px", maxWidth: 1180, margin: "0 auto" },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  logoBadge: { width: 42, height: 42, borderRadius: 13, background: "#3a5a2c", color: "#eef3e3", display: "grid", placeItems: "center", boxShadow: "0 6px 18px rgba(58,90,44,.35)" },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 23, fontWeight: 700, lineHeight: 1 },
  brandSub: { fontSize: 12.5, opacity: 0.6, marginTop: 3, fontStyle: "italic" },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  toggle: { display: "flex", gap: 4, background: "#00000010", padding: 4, borderRadius: 12 },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: "9px 16px", borderRadius: 9, fontSize: 14, fontWeight: 600, color: "#5c574b" },
  toggleOn: { background: "#fff", color: "#3a5a2c", boxShadow: "0 2px 8px rgba(0,0,0,.08)" },
  gearBtn: { border: "none", background: "#00000010", width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", color: "#5c574b" },
  settingsBar: { maxWidth: 1180, margin: "0 auto", padding: "0 32px 8px", display: "flex", flexDirection: "column", gap: 5 },
  settingsLabel: { fontSize: 12.5, fontWeight: 600, color: "#5c574b" },
  endpointInput: { padding: "10px 13px", borderRadius: 10, border: "1.5px solid #c3bba7", background: "#fdfcf8", fontSize: 13.5, fontFamily: "monospace", color: "#2b2a24" },
  settingsHint: { fontSize: 11.5, opacity: 0.55 },
  demoToggle: { display: "flex", gap: 4, background: "#00000010", padding: 4, borderRadius: 10, width: "fit-content" },
  demoBtn: { border: "none", background: "transparent", padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#5c574b" },
  demoBtnOn: { background: "#fff", color: "#3a5a2c", boxShadow: "0 2px 6px rgba(0,0,0,.08)" },
  main: { maxWidth: 1180, margin: "0 auto", padding: "8px 32px", display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 28, alignItems: "start" },
  visualCol: { display: "flex", flexDirection: "column", gap: 16 },
  imageGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  errorBox: { display: "flex", gap: 9, padding: "12px 14px", background: "#fbe9e4", border: "1px solid #e7b8a8", borderRadius: 11, color: "#9c4022", fontSize: 13, lineHeight: 1.45 },
  visualActions: { display: "flex", gap: 10 },
  ghostBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "12px", borderRadius: 11, border: "1.5px solid #c3bba7", background: "#fdfcf8", fontWeight: 600, fontSize: 14, color: "#4a4636" },
  primaryBtn: { flex: 1.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "12px", borderRadius: 11, border: "none", background: "linear-gradient(135deg,#4a7a35,#3a5a2c)", color: "#f3f7ec", fontWeight: 600, fontSize: 14, boxShadow: "0 6px 16px rgba(58,90,44,.3)" },
  hint: { fontSize: 12, opacity: 0.55, margin: 0, lineHeight: 1.5 },
  taskCol: { background: "#fdfcf8", borderRadius: 20, padding: 24, boxShadow: "0 18px 50px rgba(60,50,30,.12)", border: "1px solid #ece5d4" },
  colHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 },
  h2: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, margin: 0 },
  count: { fontSize: 12.5, opacity: 0.55, fontWeight: 500 },
  custIntro: { fontSize: 13.5, opacity: 0.65, margin: "0 0 16px", lineHeight: 1.5 },
  taskList: { display: "flex", flexDirection: "column", gap: 9 },
  editRow: { display: "flex", alignItems: "center", gap: 10, background: "#f6f2e7", padding: "9px 11px", borderRadius: 12 },
  dot: { width: 11, height: 11, borderRadius: "50%", flexShrink: 0 },
  nameInput: { flex: 1, border: "none", background: "transparent", fontSize: 14, fontWeight: 500, color: "#2b2a24", minWidth: 0 },
  priceWrap: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 8, padding: "5px 9px", border: "1px solid #e4ddca" },
  priceInput: { width: 64, border: "none", background: "transparent", fontSize: 14, fontWeight: 600, textAlign: "right" },
  iconBtn: { border: "none", background: "transparent", color: "#b04a3a", padding: 4, display: "grid", placeItems: "center" },
  addBtn: { marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px", borderRadius: 11, border: "1.5px dashed #bdb39a", background: "transparent", fontWeight: 600, fontSize: 14, color: "#5c574b" },
  totalCard: { marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#efeadb", borderRadius: 13, fontSize: 15, fontWeight: 600 },
  sendBtn: { marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", borderRadius: 12, border: "none", background: "#2b2a24", color: "#f3efe4", fontWeight: 600, fontSize: 14.5 },
  pickRow: { display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "14px 15px", borderRadius: 13, border: "1.5px solid #ece5d4", background: "#faf7ef", transition: "all .15s" },
  pickOn: { background: "#fff", borderColor: "#cdd9bd", boxShadow: "0 4px 14px rgba(74,122,53,.12)" },
  check: { width: 24, height: 24, borderRadius: 7, border: "2px solid", flexShrink: 0, display: "grid", placeItems: "center", transition: "all .15s" },
  pickName: { flex: 1, fontSize: 14.5, fontWeight: 500 },
  pickPrice: { fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  totalCardBig: { marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px", background: "linear-gradient(135deg,#3a5a2c,#2b4220)", borderRadius: 16, color: "#f3f7ec" },
  totalLabel: { fontSize: 13, opacity: 0.8, fontWeight: 500 },
  totalNote: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  totalBig: { fontFamily: "'Fraunces', serif", fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
};

const paneStyles = {
  pane: { position: "relative", aspectRatio: "4/3", borderRadius: 16, overflow: "hidden", background: "#e3ddcc", border: "1px solid #d3cab4", display: "grid", placeItems: "center" },
  tag: { position: "absolute", top: 10, left: 10, zIndex: 3, fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", background: "#00000088", color: "#fff", padding: "4px 9px", borderRadius: 7, backdropFilter: "blur(4px)" },
  demoBadge: { position: "absolute", top: 10, right: 10, zIndex: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", background: "#e0a93c", color: "#3a2c00", padding: "4px 8px", borderRadius: 7 },
  img: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  placeholder: { display: "flex", flexDirection: "column", alignItems: "center", gap: 9, color: "#8c8369", fontSize: 13, fontWeight: 500, textAlign: "center", padding: 16 },
  gen: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#3a5a2c", fontSize: 13.5, fontWeight: 600 },
  afterOverlay: { position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 3, display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontSize: 11, fontWeight: 600, color: "#fff", padding: "4px 9px", borderRadius: 20, boxShadow: "0 2px 6px rgba(0,0,0,.25)" },
};
