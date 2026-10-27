# FairShift 🏗️🎓

**Equitable shift scheduling, safety reporting, and fairness analytics for workers and employers.**

FairShift is a hackathon MVP built with zero production npm dependencies — pure Node.js built-ins only.  
It serves two sectors out of the box: **Construction Site** and **College Work-Study**.

---

## ✨ Features

| Feature | Workers | Employers/Admins |
|---|---|---|
| Shift marketplace with pay estimates | ✅ View & claim | ✅ Create |
| Eligibility checks (rest gap, weekly cap, conflicts) | ✅ Instant feedback | ✅ Configurable per sector |
| Safety & grievance reporting | ✅ Submit + track by reference ID | ✅ Advance status |
| Fairness & fatigue analytics | — | ✅ Equity score, rest alerts, overlap warnings |
| Sector switching (Construction / College) | ✅ | ✅ |

> **Demo assumption notice:** Rest-gap and weekly-hour thresholds are configurable demonstration values, not statutory legal requirements. See the UI disclaimer banner for details.

---

## 🚀 Quick Start

```bash
# No install step — zero production dependencies
node server.js
# → Listening on http://localhost:8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## 🧪 Tests

```bash
node --test
# 52 tests — 0 failures
```

Tests cover: shift eligibility, time-overlap detection, pay calculation, report status transitions, REST API endpoints, security headers, and path-traversal blocking.

---

## 🐳 Docker / Cloud Run

```bash
# Build
docker build -t fairshift .

# Run locally
docker run -p 8080:8080 fairshift

# Cloud Run (after gcloud auth)
gcloud run deploy fairshift \
  --image gcr.io/YOUR_PROJECT/fairshift \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

Cloud Run automatically sets the `PORT` environment variable; the server reads it with `process.env.PORT || 8080`.

---

## 📁 Project Structure

```
fairshift/
├── lib/
│   ├── fairshift.js   # Core domain logic (eligibility, pay, fairness metrics)
│   └── store.js       # In-memory demo store with seeded data
├── public/
│   ├── index.html     # Accessible, mobile-first semantic HTML
│   ├── styles.css     # WCAG-compliant dark theme, mobile-first CSS
│   └── app.js         # Vanilla ES6 client (no framework)
├── test/
│   ├── fairshift.test.js  # 25 unit tests
│   └── api.test.js        # 27 integration tests
├── server.js          # Native Node.js HTTP server (9 API endpoints)
├── Dockerfile
└── package.json
```

---

## 🔒 Security

- **No secrets in source** — `.gitignore` and `.dockerignore` exclude all `.env` files
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- **Path traversal blocked** — static file server rejects `../` escapes (integration test confirms)
- **64 KB request body limit** — enforced in the HTTP server
- **Non-root Docker user** — `USER node` in Dockerfile

---

## ⚠️ Limitations (Demo)

- **In-memory store**: All data resets on server restart. There is no persistent database.
- **No authentication**: This is a demonstration MVP. All workers and employers share the same session.
- **Rest/hour thresholds**: Configurable demo values, not verified statutory requirements.
- **No anonymous reporting**: Report submissions are stored with an in-memory reference only. Full anonymity is not guaranteed.

---

## 🏆 Built for

**PromptWars Hackathon — FairShift Problem Statement**  
Team: Solo | Stack: Node.js (built-ins only) | Deployment: Google Cloud Run
