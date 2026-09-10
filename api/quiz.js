// ============================================================
// /api/quiz  (Vercel Serverless Function)
//
// Single entry point for the quiz batch API. Handles all four actions that
// previously lived in separate api/quiz-batch-{create,get,answer,complete}.js
// files (each of which counted against the Vercel Hobby 12-function limit).
//
// Accepts BOTH the flat client paths and the legacy nested paths — vercel.json
// rewrites them onto this function while preserving the original req.url:
//   POST /api/quiz-batch-create  |  /api/quiz/batch-create    -> create
//   GET  /api/quiz-batch-get?id= |  /api/quiz/batch-get?id=   -> get
//   POST /api/quiz-batch-answer  |  /api/quiz/batch-answer    -> answer
//   POST /api/quiz-batch-complete|  /api/quiz/batch-complete  -> complete
//
// All server-authoritative behavior (quota, cooldown, difficulty progression,
// framework/course validation, question selection, grading) lives in
// _questionSelectionService.js and the Supabase RPCs it calls — unchanged.
// ============================================================

import { applyCors } from './_utils.js';
import { handleCreate, handleGet, handleAnswer, handleComplete } from './_quiz-batches.js';

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Dispatch on the ORIGINAL path (query strings are irrelevant to routing).
  const path = (req.url || '').split('?')[0];
  const action = path.match(/batch-(create|get|answer|complete)$/)?.[1];

  switch (action) {
    case 'create':
      return handleCreate(req, res);
    case 'get':
      return handleGet(req, res);
    case 'answer':
      return handleAnswer(req, res);
    case 'complete':
      return handleComplete(req, res);
    default:
      // Never the SPA HTML: unmatched /api/quiz/* paths fall through to the
      // /api/:path* -> /api/not-found rewrite (JSON 404) on Vercel; serve-api
      // mirrors that.
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Unknown quiz endpoint.',
        path,
      });
  }
}