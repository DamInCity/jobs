# ATS tailoring pipeline + CV Q&A bot

## Goal

1. Stop treating “more skills / more repetition” as ATS optimization.
2. Put a **model-agnostic pipeline** around Resume AI so any free OpenRouter
   model follows the same rules.
3. Scope a later **CV Q&A bot** that answers only from the user’s stored
   resume (Telegram / site).

No code in this phase.

## Diagnosis (your current master resume)

Parsed CV: 4 roles, **16 skill groups**, each with 3–5 keywords.

Overlaps that look like stuffing to a 2026 ATS:

| Cluster | Groups that say the same thing |
|---|---|
| Linux | Operating Systems + System Administration |
| Networks | Networking + Network Administration + Security |
| Script | Scripting & Tools + Automation (Python/Bash twice) |
| Web | Web & Platforms + Web Development + Digital Marketing |
| Docs | Data & Reporting + Monitoring & Documentation |

That’s ~50 phrases. HireFlow / Resumefast / ResumeSquad 2026 write-ups
agree: **10–15 targeted skills beat long lists**; long lists trigger
keyword-stuffing flags; **context in experience bullets beats a dump**.

Repetition of the *same* skill in Skills + a *real* experience bullet is
good. Repeating “Linux / networking / Python” across 4 group titles is not.

## What actually gets you past AI HR (2026)

Three layers every modern ATS/AI screen uses:

1. **Parse** — standard headers, single column, selectable text (we already
   render this in `renderResumePdf`).
2. **Keyword / taxonomy match** — exact JD terms still matter (~40–60% of
   older ATS scores).
3. **Evidence / semantics** — Workday/Greenhouse-class systems infer skills
   from bullets and **penalize** lists with no supporting experience.

So the algorithm is not “ask a smarter LLM”. It is a **pipeline**:

```
JD → extract must-have / nice-to-have terms (tier 1 / 2 / 3)
Master resume → evidence map (skill → witnessing bullet or drop it)
Select 10–15 skills = JD ∩ evidenced, using the JD’s own wording
Rewrite summary + 3–6 bullets to embed Tier-1 terms in results
Score: coverage, stuffing, unverifiable claims
PDF: single column, SUMMARY / SKILLS / EXPERIENCE / EDUCATION
```

The LLM only does rewrite + phrasing. Selection and scoring are
deterministic so `openrouter/free` (random model each call) stays consistent.

## Assumptions

- Never invent employers, titles, dates, tools, or metrics.
- Master JSON on `users.master_resume_json` is the source of truth.
- Telegram `/resume` and site tailor both call `tailorAndSave`.
- Q&A is a **second** feature; can ship after the pipeline.

## Approach

### A. Durable “ATS tailor” skill (the consistent thing)

New Hermes/project skill: `jobs-ats-tailor` (or a section in
`job-board-scraping` + `src/services/atsPipeline.js`).

Hard rules the model cannot override:

1. Skills section: **8–15** items, JD-ordered, no duplicate clusters.
2. A skill may appear only if a work/project highlight supports it
   (or it was an explicit master-resume skill *and* the JD asks for it).
3. Each Tier-1 JD term appears **at most once in Skills** and **once in a
   bullet**. No third echo in the summary unless it’s the job title.
4. Prefer the JD’s exact string (“Linux system administration” not
   “Linux fundamentals” + “Linux system administration”).
5. Soft skills only if the JD names them.
6. Output still JSON Resume; PDF renderer unchanged except maybe
   comma-separated skills (cleaner parse) instead of
   `Group (kw, kw, kw)`.

### B. Wire into existing tailor

Today `tailorResumeJson()` is one vague prompt
(`src/services/resumeTailor.js` ~307–328). Replace with:

1. `extractJdTerms(job.description)` — rules + optional LLM JSON.
2. `buildEvidenceMap(master)` — tokenize highlights/summary.
3. `selectSkills(jd, evidence, master)` — deterministic.
4. LLM rewrite with the **selected skill list locked** (model may not
   add skills).
5. `scoreTailored(resume, jd)` stored on `tailored_resumes` for the UI
   (`coverage 11/14 · stuffing low`).

Telegram `/resume` then shows the score in the caption.

### C. CV Q&A bot (separate, cheaper than it sounds)

One user’s resume is ~4–8k tokens. **No vector DB required** for v1.

| Piece | v1 | later |
|---|---|---|
| Context | `master_resume_json` + raw extract text stuffed into the prompt | pgvector chunks if we add multi-doc (cover letters, transcripts) |
| Surface | Telegram: any question after link, or `/ask …` | Profile page chat |
| Grounding | “Answer only from CONTEXT. If missing, say you don’t have that.” | Cite role + date |
| Modes | Recruiter Q&A (“walk me through X”) | Interview drill, salary range (never invent) |
| Auth | Existing `telegram_chat_id` | same session as `/resume` |

Estimate: ~1 day for Telegram Q&A on stored JSON; ~2–3 more for web UI +
history. Embeddings only if we add many docs.

Files (when approved):

- `src/services/atsPipeline.js` — extract / evidence / select / score
- `src/services/resumeTailor.js` — call pipeline; lock skills in prompt
- `src/jobs/telegramBot.js` — `/ask` + free-text Q&A; score in `/resume` caption
- `src/routes/users.js` — optional `POST /resume/ask`
- Skill: `references/ats-tailor-rules.md`

## Step-by-step (after approval)

1. Freeze ATS rules in `references/ats-tailor-rules.md`.
2. Implement `extractJdTerms` + unit fixtures from 2 live JDs (IT support +
   digital/marketing).
3. Implement evidence map + skill selector; run on Elias master JSON
   (expect ~12 skills, Linux/network/script clusters collapsed).
4. Change tailor prompt to receive **locked skill list**.
5. Add `scoreTailored`; persist + show in Telegram caption + profile.
6. (Optional second PR) Telegram `/ask` grounded on master resume.
7. Smoke: tailor one saved job; confirm skills ≤ 15 and no new employers.

## Tests / verification

- Fixture: master JSON + sample JD → selected skills snapshot.
- Parser: no skill in output that is absent from master ∪ JD-synonym of master.
- PDF still single-column; `pdftotext` contains `SKILLS` and `EXPERIENCE`.
- Telegram: `/resume` caption includes `Match 10/13 · 12 skills`.

## Risks

- Free models ignore “locked skills” — mitigate by **overwriting**
  `tailored.skills` with the deterministic list after the LLM returns.
- Over-aggressive cutting hides transferable skills — keep 2–3
  adjacent evidenced skills even if not in the JD.
- Q&A hallucination — refuse when not in context; log answers.

## Decisions (2026-08-27)

- **Approved:** plan + rules (`jobs-ats-tailor` skill).
- Implementation shipped in `src/services/atsPipeline.js` (Telegram `/ask` still later).

## Open questions

See chat. Implementation waits on answers + approval.
