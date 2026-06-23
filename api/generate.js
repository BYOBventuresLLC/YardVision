// ===========================================================================
// YardVision — secure image-edit backend (Vercel / Netlify serverless function)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS:
//   The browser must NEVER hold your Gemini API key. This function runs on a
//   server, holds the key in an environment variable, and is the only thing
//   that talks to Google. Your frontend calls THIS, never Google directly.
//
// DEPLOY (Vercel example):
//   1. Put this file at:  /api/generate.js  in your project root
//   2. In Vercel project settings → Environment Variables, add:
//        GEMINI_API_KEY = <your key from https://aistudio.google.com/apikey>
//   3. Deploy. Your endpoint is now:  https://yourapp.vercel.app/api/generate
//
//   Netlify: rename to /netlify/functions/generate.js — the handler signature
//   differs slightly; see the NETLIFY note at the bottom.
//
// COST NOTE: each call bills image tokens. gemini-3.1-flash-image (Nano Banana 2)
//   is the cheap/fast one — right for high-volume quoting. Swap to
//   gemini-3-pro-image for max fidelity if a render looks weak.
// ===========================================================================

// Model is overridable via the GEMINI_MODEL env var so you can swap to
// gemini-3-pro-image (max fidelity) without touching code — just set it in
// Vercel and redeploy. Defaults to Nano Banana 2 (cheap/fast).
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-image"; // Nano Banana 2
// IMPORTANT: image-generation models are served from the **v1beta** API
// surface, NOT v1. Calling /v1/ returns 404 "model not found" and no image
// ever comes back. Keep this on v1beta.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Turn the landscaper's task list into a scene description. Gemini responds
// FAR better to a narrative paragraph than a list of keywords — so we write
// one. This is the single most important function for output quality; tune
// the wording here as you see what the model produces.
function buildPrompt(tasks) {
  const items = tasks
    .filter((t) => t && t.name)
    .map((t) => t.name.trim())
    .filter(Boolean);

  if (items.length === 0) {
    return "Show this same yard professionally landscaped and tidied, keeping the house, fence lines, and overall perspective exactly as they are in the photo.";
  }

  const list =
    items.length === 1
      ? items[0]
      : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];

  return (
    `Edit this photograph of a real residential yard to show it after the following landscaping work is completed: ${list}. ` +
    `Keep the house, property boundaries, neighboring structures, camera angle, and lighting exactly as they appear in the original photo — ` +
    `only change the landscaped areas. The result should look like a real photograph taken from the same spot after the work was done, ` +
    `with natural materials, realistic plant maturity, and professional installation quality. Photorealistic, not illustrated.`
  );
}

// ---- Main handler (Vercel-style: req, res) -------------------------------
// NOTE: written as an ESM `export default` because package.json sets
// "type": "module". Using CommonJS `module.exports` here makes Vercel fail to
// detect the function ("doesn't match any Serverless Functions") and the build
// dies. Keep this an ESM default export.
export default async function handler(req, res) {
  // CORS — lock origin down to your real domain in production.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server missing GEMINI_API_KEY env var." });
  }

  try {
    // Frontend sends: { imageBase64, mimeType, tasks: [{name}, ...] }
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { imageBase64, mimeType = "image/jpeg", tasks = [] } = body;

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64." });
    }

    const prompt = buildPrompt(tasks);

    const geminiBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        // Image-only output. We deliberately DON'T set responseFormat /
        // aspectRatio / imageSize: this model rejects the friendly "4:3" /
        // "2K" values (INVALID_ARGUMENT), and for an image EDIT the result
        // should track the input photo's framing anyway — which it does by
        // default. Leave sizing to the model so the before/after match.
        responseModalities: ["IMAGE"],
      },
    };

    const r = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiBody),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "Gemini call failed", detail });
    }

    const data = await r.json();

    // Pull the first image part out of the response. Skip "thought" images.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(
      (p) => p?.inlineData?.data && !p.thought
    ) || parts.find((p) => p?.inline_data?.data && !p.thought);

    const outData = imgPart?.inlineData?.data || imgPart?.inline_data?.data;
    const outMime =
      imgPart?.inlineData?.mimeType ||
      imgPart?.inline_data?.mime_type ||
      "image/png";

    if (!outData) {
      return res.status(502).json({ error: "No image returned by model.", raw: data });
    }

    // Hand back a ready-to-use data URL the <img> tag can render directly.
    return res.status(200).json({
      image: `data:${outMime};base64,${outData}`,
      prompt,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}

// ---- NETLIFY variant -------------------------------------------------------
// If deploying to Netlify Functions, replace the handler signature with:
//
// exports.handler = async (event) => {
//   const body = JSON.parse(event.body || "{}");
//   ... (same logic) ...
//   return { statusCode: 200, body: JSON.stringify({ image, prompt }) };
// };
//
// Set GEMINI_API_KEY in Netlify → Site settings → Environment variables.
