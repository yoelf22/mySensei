# mySensei — one-time setup

You only do this once. After it's wired up, lessons arrive on their own. The
`/mySensei` skill walks you through these steps interactively, but here they are
in full. Replace `yoelf22/mySensei` with your own GitHub owner/repo if different.

## What you'll need

- A GitHub account (you have `yoelf22`) with this repo pushed to it.
- An **Anthropic API key** — lets the cloud job call Claude to write lessons.
- A **Gmail app password** — lets the cloud job email you.
- A free **Cloudflare account** — hosts the ~20-line quiz helper.

---

## 1. Push the repo to GitHub

```bash
gh repo create mySensei --private --source=. --remote=origin --push
```

(or create it in the GitHub UI and `git push -u origin main`). The two workflows
under `.github/workflows/` activate automatically once pushed.

## 2. Anthropic API key

Get a key from the Anthropic Console, then store it as a repo secret:

```bash
gh secret set ANTHROPIC_API_KEY        # paste the key when prompted
```

## 3. Gmail sending

1. On the Google account you'll send from, enable 2-Step Verification, then
   create an **App Password** (Google Account → Security → App passwords).
2. Store it and the addresses:

```bash
gh secret set GMAIL_APP_PASSWORD               # paste the 16-char app password
gh variable set MAIL_FROM --body "you@gmail.com"        # the Gmail that owns the app password
gh variable set MAIL_TO   --body "yoel@theroadtlv.com"  # where lessons land
```

> Gmail SMTP requires the app password to belong to a Gmail/Workspace account.
> `MAIL_FROM` must be that account; `MAIL_TO` can be any address.

## 4. The quiz helper (Cloudflare Worker)

The lesson page can't safely hold a GitHub token, so the quiz result goes
through this tiny worker.

1. Create a **GitHub fine-grained token** scoped to this repo with
   **Contents: Read and write** (this lets it fire the `repository_dispatch`
   that triggers the next lesson). Copy it.
2. Edit `worker/wrangler.toml` and confirm `GITHUB_OWNER` / `GITHUB_REPO` match
   your repo.
3. Deploy:

```bash
cd worker
npx wrangler login            # one-time browser auth
npx wrangler secret put GITHUB_TOKEN   # paste the fine-grained token
npx wrangler deploy           # prints the worker URL, e.g. https://mysensei-quiz-helper.<you>.workers.dev
cd ..
```

4. Store that URL so lessons know where to send quiz results:

```bash
gh variable set QUIZ_WEBHOOK_URL --body "https://mysensei-quiz-helper.<you>.workers.dev"
```

## 4b. Lesson hosting (Cloudflare Pages)

Lessons are published to Cloudflare Pages and emailed as a one-click link (the repo
stays private). One-time:

1. **Create a Cloudflare API token** with Pages edit rights: Cloudflare dashboard →
   My Profile → API Tokens → Create Token → Custom token → Permissions:
   **Account · Cloudflare Pages · Edit**. Copy it, then:
   ```
   gh secret set CLOUDFLARE_API_TOKEN     # paste the token, hidden
   ```
   (`CLOUDFLARE_ACCOUNT_ID` is already set as a repo variable.)
2. **Create the Pages project** (you're already wrangler-authed):
   ```
   cd ~/Desktop/mySensei && npx wrangler pages project create mysensei-lessons --production-branch=main
   ```
   This gives you the site URL, `https://mysensei-lessons.pages.dev` (or a variant).
3. **Record the site URL** so emails can link to it:
   ```
   gh variable set LESSONS_BASE_URL --body "https://mysensei-lessons.pages.dev"
   ```

The cadence workflow then publishes each lesson to Pages before emailing the link.

## 4c. Disputes

- **Disputes:** apply the new D1 migration after pulling this change —
  `cd worker && npx wrangler d1 migrations apply <DB_NAME> --remote` — then
  redeploy the worker (`npm run deploy`). The `dispute` workflow needs the same
  secrets/vars the other workflows already use (`ANTHROPIC_API_KEY`,
  `INTERNAL_TOKEN`, `APP_BASE_URL`, `MAIL_FROM`, `MAIL_TO`, `GMAIL_APP_PASSWORD`,
  `OWNER_EMAIL`) — no new ones.

## 5. Send the first lesson

GitHub Actions → **cadence** → **Run workflow** (keep "force" checked) sends one
right now. Or:

```bash
gh workflow run cadence.yml -f force=true
```

Check your inbox, open the attached `.html`, take the quiz. Passing advances you;
failing re-teaches with different material next cadence. From then on the hourly
schedule delivers on your chosen day(s) and time automatically.

---

## Changing settings later

Edit `curriculum.json` directly (language, cadence, delivery time, timezone,
workweek days, model, pass threshold) and push — the next run picks it up. Or
re-run `/mySensei` to start a different subject or, once you hit level 10, pick a
specialization.
