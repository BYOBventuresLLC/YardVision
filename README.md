# YardVision — Dead-Simple Deploy Guide

You're deploying a web app + a secure backend to Vercel, all free.
Total time: ~15 minutes. No coding. Follow in order, don't skip.

There are 5 parts:
  1. Get a Google API key
  2. Put these files on GitHub
  3. Connect GitHub to Vercel
  4. Paste your key into Vercel
  5. Open your live app

═══════════════════════════════════════════════════════════════
PART 1 — Get your Google (Gemini) API key
═══════════════════════════════════════════════════════════════

1. Open: https://aistudio.google.com/apikey
2. Sign in with your Google account.
3. Click the blue "Create API key" button.
4. Click "Create API key in new project" if it asks.
5. A long string appears (starts with "AIza..."). Click Copy.
6. Paste it into a note on your phone/computer for 10 minutes.
   You'll need it in Part 4.

   ⚠️ DO NOT put this key in any file. DO NOT text it to anyone.
      It goes ONLY into Vercel in Part 4. Treat it like a password.

═══════════════════════════════════════════════════════════════
PART 2 — Put these files on GitHub
═══════════════════════════════════════════════════════════════

First, UNZIP the yardvision-deploy.zip somewhere you can find it
(like your Desktop). You should see folders named "api" and "src"
plus some loose files. Keep that window open.

1. Go to: https://github.com/signup  (skip if you already have an account)
   - Pick a username, email, password. Verify your email.

2. Go to: https://github.com/new
   - "Repository name": type  yardvision
   - Leave everything else as-is.
   - Click the green "Create repository" button.

3. On the next page, find the small link that says
   "uploading an existing file" (it's in a sentence of text).
   Click it.

4. Open the unzipped yardvision-deploy folder on your computer.
   Select EVERYTHING inside it and drag it into the GitHub upload box.

   ✅ INCLUDE: the "api" folder, the "src" folder, index.html,
      package.json, vite.config.js, vercel.json, .gitignore
   ❌ If you see a "node_modules" folder, DO NOT upload it.
      (It shouldn't be there, but skip it if it is.)

   NOTE: Drag the FILES AND FOLDERS, not the outer "yardvision-deploy"
   folder itself. GitHub should show "api/generate.js", "src/YardVision.jsx",
   etc. — NOT "yardvision-deploy/api/...". If you see the wrapper folder
   name, you dragged the wrong thing — start the drag over.

5. Scroll down, click the green "Commit changes" button.
   Your code is now on GitHub. ✅

═══════════════════════════════════════════════════════════════
PART 3 — Connect Vercel to your GitHub
═══════════════════════════════════════════════════════════════

1. Go to: https://vercel.com/signup
2. Click "Continue with GitHub" and approve the connection.
   (Using GitHub to sign in saves you a step later.)
3. Once in, go to: https://vercel.com/new
4. You'll see your "yardvision" repo listed. Click "Import" next to it.
   - If you don't see it, click "Adjust GitHub App Permissions"
     and give Vercel access to the yardvision repo.

5. Vercel auto-detects it's a Vite app. The settings it shows
   (Framework: Vite, Build Command, Output Directory) are correct.
   DON'T change them. DON'T click Deploy yet — do Part 4 first.

═══════════════════════════════════════════════════════════════
PART 4 — Paste your API key (the important part)
═══════════════════════════════════════════════════════════════

Still on that Vercel import screen:

1. Find and click "Environment Variables" to expand it.
2. In the "Key" (or "Name") box, type EXACTLY:
      GEMINI_API_KEY
   (all caps, with underscores, no spaces — copy it from here to be safe)
3. In the "Value" box, paste the "AIza..." key from Part 1.
4. Click "Add".
5. NOW click the big "Deploy" button.

Wait ~1 minute while it builds. You'll see confetti when it's done.

═══════════════════════════════════════════════════════════════
PART 5 — Use your live app
═══════════════════════════════════════════════════════════════

1. Click "Continue to Dashboard", then click the "Visit" button
   (or the preview image) to open your live site.
2. Your URL looks like: https://yardvision-xxxx.vercel.app
   This is the link you share with landscapers/customers.
3. In Landscaper mode: upload a yard photo, name a task, wait ~2 sec.
   The real AI after-photo appears.

═══════════════════════════════════════════════════════════════
IF SOMETHING GOES WRONG
═══════════════════════════════════════════════════════════════

The app has a built-in error banner. Whatever it says, that's your clue.

• "Request failed (404)" or "model not found"
    → The model name needs adjusting for your account. Open
      api/generate.js on GitHub, and someone (or your AI helper) tweaks
      the GEMINI_MODEL line. Commit the change; Vercel auto-redeploys.

• "billing" / "quota" / "permission" in the banner
    → Google needs billing enabled. Go to https://aistudio.google.com,
      open your project, enable billing. (Free credits usually cover testing.)

• "Server missing GEMINI_API_KEY"
    → Part 4 didn't save. In Vercel: your project → Settings →
      Environment Variables → confirm GEMINI_API_KEY is there →
      then Deployments tab → "..." on the latest → Redeploy.

• Build failed (red, before the app even loads)
    → In Vercel, click the failed deployment → read the build log.
      The error line tells you the file and problem. Send it to your
      AI helper for a one-line fix, commit, auto-redeploys.

• Image looks generic / not like the real yard
    → Make task names specific: "gray flagstone walkway, 4ft wide"
      beats "walkway". Better descriptions = better edits.

═══════════════════════════════════════════════════════════════
HOW UPDATES WORK (good to know)
═══════════════════════════════════════════════════════════════

Every time you change a file on GitHub and commit it, Vercel
automatically rebuilds and redeploys within a minute. You never
touch the deploy button again. Edit on GitHub → commit → done.

═══════════════════════════════════════════════════════════════
DEMO MODE (for showing prospects before billing kicks in)
═══════════════════════════════════════════════════════════════

In the live app, click the gear icon (top right). Under "Demo mode":
  • Auto  — real backend, falls back to placeholder if it can't reach it (default)
  • Always demo — never calls the API, always shows a labeled placeholder
  • Real only — always calls the API, shows errors instead of placeholders

Use "Always demo" to show the flow to prospects without spending API money.
The placeholder is clearly marked DEMO so no one is misled.
