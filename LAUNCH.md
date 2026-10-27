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

1. Your docs, as a help center that answers with sources (54)
2. Open-source AI help center that runs on your machine (52)
3. Drop in Markdown, get a help center your agents can ask (56)

**Description** (under 260 characters):

> Point Helpdock at a folder of Markdown and get a help center that answers questions in plain words, with a link to every page it used. Works with no API key (it quotes your docs); add a Claude key for written answers. MCP server included. MIT, self-hosted.

**Tags:** Open Source, Customer Success, Developer Tools.

**Gallery (5):**

1. The page answering "How do I fix a port that is already in use?", with citations [1] [2] under it.
2. The same question with no API key: quoted passages, still cited.
3. Claude Code calling `ask_help_center` over MCP.
4. The terminal: `git clone … && flisk up agents`, then the page opening.
5. The architecture: agent + Postgres full-text search + migrator + MCP server, laid out by Flisk.

## Maker first comment

> Hi, I'm one of the people behind Flisk. Help centers break in a familiar way: search finds the page, but not the answer in it. Helpdock splits your Markdown into sections, searches them with Postgres full-text search (no vector database, no embeddings to keep in sync), and answers with numbered links to the sections it used. With no key it quotes the passages; with a Claude key it writes the answer and cites them.
>
> It's also an MCP server, so Claude Code or Cursor can ask the same help center your users do.
>
> One question for you: would you point this at public docs, or at internal runbooks first?

## Before launch

- [x] Public repo: https://github.com/flisk-sh/helpdock (published 2026-10-27).
- [ ] Record the gallery from a real run; no mockups.
- [ ] Ask Product Hunt support whether a product built on Flisk, launched by Flisk's makers, counts as separate from the Flisk listing.
- [ ] Post the night-before note to the people who already use Flisk (no vote ask).
