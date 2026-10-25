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
import { handleLicenseStatus, handleLicenseStart, handleLicenseSubmit } from './_license.js';
import {
  handleLoanList, handleLoanRequest, handleLoanOffer, handleLoanAccept, handleLoanRepay,
  handleLoanReject, handleLoanCancel, handleLoanSharkBuy, handleLoanDefault,
} from './_loans.js';
import {
  handleEconomyOverview, handleTransfer, handleBankStatus, handleBorrow, handleRepay,
  handlePinStatus, handlePinSetup, handlePinChange, handlePinReset,
} from './_economy.js';
import {
  handleBlitzCreate, handleBlitzState, handleBlitzAnswer, handleBlitzSkip,
  handleBlitzFlow, handleBlitzSettle, handleBlitzRematch,
} from './_blitz-duel.js';

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Dispatch on the ORIGINAL path (query strings are irrelevant to routing).
  const path = (req.url || '').split('?')[0];

  // Nursing License Renewal (S8) sub-routes (/api/license/status|start|submit).
  const license = path.match(/license[-/](status|start|submit)$/)?.[1];
  if (license === 'status') return handleLicenseStatus(req, res);
  if (license === 'start') return handleLicenseStart(req, res);
  if (license === 'submit') return handleLicenseSubmit(req, res);

  // Economy sub-routes (/api/economy/overview|transfer|bank|borrow|repay|pin/*).
  // Thin wrappers over the v81 RPCs, which own every amount and cap.
  const economy = path.match(/economy[-/](overview|transfer|bank|borrow|repay|pin\/(?:status|setup|change|reset))$/)?.[1];
  if (economy === 'overview') return handleEconomyOverview(req, res);
  if (economy === 'transfer') return handleTransfer(req, res);
  if (economy === 'bank') return handleBankStatus(req, res);
  if (economy === 'borrow') return handleBorrow(req, res);
  if (economy === 'repay') return handleRepay(req, res);
  if (economy === 'pin/status') return handlePinStatus(req, res);
  if (economy === 'pin/setup') return handlePinSetup(req, res);
  if (economy === 'pin/change') return handlePinChange(req, res);
  if (economy === 'pin/reset') return handlePinReset(req, res);

  // Loan Shark (S9) sub-routes (/api/loans/list|request|offer|accept|repay|...).
  const loan = path.match(/loans?\/(list|request|offer|accept|repay|reject|cancel|shark-buy|default)$/)?.[1];
  if (loan === 'list') return handleLoanList(req, res);
  if (loan === 'request') return handleLoanRequest(req, res);
  if (loan === 'offer') return handleLoanOffer(req, res);
  if (loan === 'accept') return handleLoanAccept(req, res);
  if (loan === 'repay') return handleLoanRepay(req, res);
  if (loan === 'reject') return handleLoanReject(req, res);
  if (loan === 'cancel') return handleLoanCancel(req, res);
  if (loan === 'shark-buy') return handleLoanSharkBuy(req, res);
  if (loan === 'default') return handleLoanDefault(req, res);

  // Blitz Duel with Flow State sub-routes
  // (/api/blitz-duel/create|state|answer|skip|flow|settle|rematch).
  // Every rule lives in the service_role-only blitz_duel_* RPCs; this router
  // exists only to map each refusal onto a meaningful HTTP status.
  const blitz = path.match(/blitz[-/]?duel[-/](create|state|answer|skip|flow|settle|rematch)$/)?.[1];
  if (blitz === 'create') return handleBlitzCreate(req, res);
  if (blitz === 'state') return handleBlitzState(req, res);
  if (blitz === 'answer') return handleBlitzAnswer(req, res);
  if (blitz === 'skip') return handleBlitzSkip(req, res);
  if (blitz === 'flow') return handleBlitzFlow(req, res);
  if (blitz === 'settle') return handleBlitzSettle(req, res);
  if (blitz === 'rematch') return handleBlitzRematch(req, res);

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