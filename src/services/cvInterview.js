/**
 * Interview helper — answers grounded only on the user's master resume JSON.
 */

const db = require('../db');
const llm = require('./llmClient');
const resumeTailor = require('./resumeTailor');

function compactResume(resume) {
  if (!resume || typeof resume !== 'object') return {};
  return {
    basics: {
      name: resume.basics?.name,
      label: resume.basics?.label,
      summary: resume.basics?.summary,
      location: resume.basics?.location,
    },
    work: (resume.work || []).map((w) => ({
      name: w.name,
      position: w.position,
      startDate: w.startDate,
      endDate: w.endDate,
      summary: w.summary,
      highlights: (w.highlights || []).slice(0, 8),
    })),
    education: (resume.education || []).map((e) => ({
      institution: e.institution,
      area: e.area,
      studyType: e.studyType,
      startDate: e.startDate,
      endDate: e.endDate,
    })),
    skills: (resume.skills || []).slice(0, 20).map((s) =>
      typeof s === 'string' ? s : { name: s.name, keywords: (s.keywords || []).slice(0, 8) }
    ),
    projects: (resume.projects || []).slice(0, 6).map((p) => ({
      name: p.name,
      description: p.description,
      highlights: (p.highlights || []).slice(0, 5),
    })),
    certificates: (resume.certificates || []).slice(0, 8),
    languages: resume.languages || [],
  };
}

async function loadMaster(userId) {
  const { resume } = await resumeTailor.ensureMasterResume(userId);
  return compactResume(resume);
}

/**
 * @returns {{ text: string, missing: boolean }}
 */
async function answerInterviewQuestion(userId, question) {
  const q = String(question || '').trim().slice(0, 800);
  if (q.length < 4) {
    const err = new Error('Send the interview question as a full sentence.');
    err.status = 400;
    throw err;
  }
  if (!llm.isConfigured()) {
    const err = new Error('Interview helper needs OPENROUTER_API_KEY.');
    err.status = 503;
    throw err;
  }

  const ctx = await loadMaster(userId);
  const hasWork = Array.isArray(ctx.work) && ctx.work.length;
  if (!hasWork && !(ctx.skills || []).length) {
    const err = new Error('I don’t have enough on your CV yet. Send a PDF first.');
    err.status = 400;
    throw err;
  }

  const { content } = await llm.chat({
    temperature: 0.25,
    maxTokens: 700,
    timeoutMs: 45000,
    messages: [
      {
        role: 'system',
        content:
          'You are an interview coach for a job seeker. Answer ONLY using CONTEXT JSON (their CV). ' +
          'Never invent employers, titles, dates, tools, metrics, or degrees. ' +
          'If the CV does not support the answer, say so in one line, then offer the closest honest answer from what IS on the CV. ' +
          'Write in first person as the candidate. Spoken style, 8–14 sentences max. ' +
          'For behavioural questions use STAR (Situation, Task, Action, Result) only with facts from CONTEXT. ' +
          'Then add a short "Say it in 20 seconds:" one-paragraph recap. ' +
          'No markdown headings. No preamble.',
      },
      {
        role: 'user',
        content: `INTERVIEW QUESTION:\n${q}\n\nCONTEXT (CV JSON):\n${JSON.stringify(ctx)}`,
      },
    ],
  });

  const text = String(content || '').trim();
  if (!text) {
    const err = new Error('Could not draft an answer. Try again in a moment.');
    err.status = 502;
    throw err;
  }

  const missing = /not (on|in) (the )?(cv|resume)|don't have that|do not have that|isn't on your cv/i.test(
    text
  );
  return { text: text.slice(0, 3500), missing };
}

async function getUserIdByChat(chatId) {
  const r = await db.query('SELECT id FROM users WHERE telegram_chat_id = $1 LIMIT 1', [
    String(chatId),
  ]);
  return r.rows[0]?.id || null;
}

module.exports = {
  compactResume,
  answerInterviewQuestion,
  getUserIdByChat,
};
