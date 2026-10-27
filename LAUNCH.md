# Helpdock: Product Hunt listing draft

Nothing here has been posted. The maker posts from their own personal account. No vote requests, no vote swaps, no new accounts.

## Why this product, and why it is easy (ICE)

| Idea (from the Oct 1 leaderboard) | Impact | Confidence | Ease | ICE |
| --- | --- | --- | --- | --- |
| **AI help center** (like #8 Chat.sh, #9 Bracket) | 7 | 7 | 8 | **7.3** |
| Drop files, get a live URL (like #12 Buddy Drop) | 5 | 4 | 9 | 6.0 |
| Night-shift stack fixer (like #5 Polylane) | 6 | 5 | 6 | 5.7 |
| Natural-language control for a SaaS (like #2 Yedric) | 7 | 5 | 4 | 5.3 |

The Flisk launch on Oct 27 was never featured: infrastructure is hard to feature. Helpdock is something an end user wants, with one clear outcome, and Flisk is the story underneath it ("clone, `flisk up`, done").

## Listing

**Name:** Helpdock

**Tagline** (60 characters max), chosen first:

1. Any GitHub repo's docs as a help center and MCP server (55)
2. Replace github.com with helpdock.flisk.sh. Instant docs. (55)
3. Cited answers from any repo's docs, for you and your AI (55)

**Description** (under 260 characters):

> Replace github.com with helpdock.flisk.sh and any public repo gets a help center: ask in plain words, get passages quoted from the docs with links to the exact page. Plus an MCP server per repo for your AI. No signup, no API key, open source.

**Tags:** Developer Tools, Open Source, Artificial Intelligence.

**Gallery (5):**

1. The URL swap: `github.com/vercel/next.js` → `helpdock.flisk.sh/vercel/next.js`, and the help center it opens.
2. A question ("how do I add middleware?") answered with cited passages and code from the Next.js docs, linked to GitHub.
3. "Use in your AI": `claude mcp add --transport http nextjs https://helpdock.flisk.sh/vercel/next.js/mcp`, then Claude Code answering from it.
4. *Ask your AI*: ChatGPT opened with the question and the cited passages.
5. How it works: one GitHub API call, Markdown fetched in parallel, SQLite full-text search, no model; built and run with Flisk.

## Maker first comment

> Hi! Docs on GitHub are great until you need one answer: search finds the file, not the paragraph. Helpdock turns any public repo into a help center by URL: put helpdock.flisk.sh in place of github.com. It reads the repo's Markdown, indexes it with SQLite full-text search (no embeddings, no model), and answers with the passages themselves, each linked to the exact heading on GitHub.
>
> Every repo also gets an MCP endpoint, so your Claude, ChatGPT or Cursor can search those docs directly. And if you want a written answer, one click hands the question and the cited passages to your own AI; we never call one.
>
> What repo should we try first? Drop one in the comments.

## Before launch

- [x] Public repo: https://github.com/flisk-sh/helpdock (published 2026-10-27).
- [x] Live: https://helpdock.flisk.sh (Render free plan; it sleeps after 15 idle minutes, so switch to Starter for launch day).
- [ ] Record the gallery from a real run; no mockups.
- [ ] Ask Product Hunt support whether a product built on Flisk, launched by Flisk's makers, counts as separate from the Flisk listing.
- [ ] Post the night-before note to the people who already use Flisk (no vote ask).
