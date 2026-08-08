/* ---------------------------------------------------------------------
 * fallbackContent.js — a small, static, per-category question bank and
 * locally-computed feedback/summary logic. Serves two purposes:
 *
 *  1. Quick Practice mode's entire content source — instant, offline,
 *     no API key, by design (not a degraded state).
 *  2. Adaptive AI mode's safety net — if Gemini fails twice in a row on
 *     a call, the interview falls back to this same static content
 *     rather than dead-ending, clearly labeled as a backup when it
 *     happens (see main.js's fallback-tag / notice-banner handling).
 *
 * Nothing here ever calls the network or touches localStorage — it's
 * pure, synchronous, offline content.
 *
 * The role the candidate typed is free text, not a fixed list, so this
 * matches it against a handful of broad finance-career categories by
 * keyword; anything that doesn't match falls back to a general-finance
 * question set. It's intentionally small — a genuinely useful practice
 * set for Quick Practice, and just enough that a rate limit never fully
 * breaks Adaptive AI mode, not a replacement for live tailored AI.
 * ------------------------------------------------------------------- */

const FallbackContentModule = (() => {
  const CATEGORIES = [
    {
      id: 'equity-research',
      label: 'Equity Research',
      match: /equity research|research analyst|buy-side|sell-side|investment research|portfolio manag/i,
      foundational: [
        'Walk me through how you would value a company using a discounted cash flow model.',
        'What is the difference between enterprise value and equity value, and when would you use each?',
        'How does a change in a company\'s cost of capital affect its valuation?',
        'What are the key drivers of a company\'s P/E ratio, and how would you use it to compare peers?',
      ],
      scenario: 'A company you cover just missed earnings and the stock is down 12% in early trading. Walk me through what you\'d do in the first hour after the print.',
    },
    {
      id: 'accounting-tax',
      label: 'Accounting & Tax',
      match: /tax|accounting|audit|\bcpa\b|controller|bookkeep/i,
      foundational: [
        'Walk me through the three financial statements and how they connect to each other.',
        'What is the difference between a deferred tax asset and a deferred tax liability?',
        'How would you account for a large piece of equipment your company just purchased?',
        'What\'s the difference between cash-basis and accrual-basis accounting, and why does it matter?',
      ],
      scenario: 'During a routine reconciliation, you find that the trial balance is off by a small but non-trivial amount. Walk me through how you\'d track down the discrepancy.',
    },
    {
      id: 'actuarial-insurance',
      label: 'Actuarial & Insurance',
      match: /actuar|insurance|underwrit|claims/i,
      foundational: [
        'Explain the difference between frequency and severity in claims analysis.',
        'What is the purpose of a loss reserve, and how might it change over time?',
        'How would you explain the time value of money to someone outside the field?',
        'What factors would you consider when pricing a new insurance product?',
      ],
      scenario: 'Claims costs in one line of business have risen sharply over the past two quarters with no clear single cause. Walk me through how you\'d investigate.',
    },
    {
      id: 'investment-banking',
      label: 'Investment Banking',
      match: /investment bank|\bm&a\b|mergers|capital markets|corporate finance|banking analyst/i,
      foundational: [
        'Walk me through the three main valuation methodologies used in banking.',
        'What happens to the three financial statements when depreciation increases by $10?',
        'Why might a company choose debt financing over equity financing, or vice versa?',
        'What is accretion/dilution analysis, and why does it matter in an M&A deal?',
      ],
      scenario: 'A client is deciding between an all-cash and an all-stock acquisition offer for a target company. Walk me through the tradeoffs you\'d lay out for them.',
    },
    {
      id: 'risk',
      label: 'Risk',
      match: /credit risk|credit analy|lending|loan officer|underwriting.*loan|\brisk\b|market risk|operational risk|enterprise risk/i,
      foundational: [
        'What are the "5 Cs of credit," and how would you apply them to evaluate a borrower?',
        'What\'s the difference between probability of default and loss given default?',
        'How would you assess whether a company can service its debt obligations?',
        'What covenants might a lender put on a loan, and why?',
        'How would you distinguish between market risk, credit risk, and operational risk?',
        'What is Value at Risk, and what does it not tell you about a portfolio?',
      ],
      scenario: 'A long-standing borrower\'s revenue has declined for two consecutive quarters while their debt load has stayed flat. Walk me through your credit reassessment.',
    },
    {
      id: 'private-equity',
      label: 'Private Equity',
      match: /private equity|venture capital|\bpe\b\W|\bvc\b\W|buyout|growth equity/i,
      foundational: [
        'Walk me through how a leveraged buyout creates equity returns.',
        'What operational levers would you pull to improve a portfolio company\'s performance?',
        'What are the main exit routes for a private equity investment, and how do you choose between them?',
        'How would you evaluate whether a target company is a good buyout candidate?',
      ],
      scenario: 'A portfolio company is underperforming its investment thesis 18 months into the hold period. Walk me through how you\'d approach it.',
    },
    {
      id: 'markets-trading',
      label: 'Markets & Trading',
      match: /trading|trader|\bmarkets?\b|sales and trading|market making|broker|execution desk/i,
      foundational: [
        'What is the bid-ask spread, and what determines how wide or narrow it is?',
        'How would you explain the difference between a market order and a limit order to a client?',
        'What factors drive a market maker\'s willingness to take on inventory risk?',
        'What\'s the difference between hedging a position and speculating on one?',
      ],
      scenario: 'A position you\'re holding moves sharply against you in the middle of the trading session, and liquidity is thinning out. Walk me through how you\'d react in real time.',
    },
    {
      id: 'strategy-consulting',
      label: 'Strategy & Consulting',
      match: /strategy|consult|management consultant/i,
      foundational: [
        'Walk me through a framework you\'d use to structure an open-ended business problem.',
        'How would you assess whether a company should enter a new market?',
        'What\'s the difference between a company\'s cost structure and its revenue model, and why does that distinction matter for strategy?',
        'How would you evaluate whether a proposed cost-cutting initiative is actually a good idea?',
      ],
      scenario: 'A client\'s profits have been declining for three straight quarters despite flat revenue. Walk me through how you\'d structure the problem to find out why.',
    },
    {
      id: 'fpna-corporate',
      label: 'FP&A / Corporate Finance',
      match: /fp&a|financial planning|budget|corporate finance|treasury/i,
      foundational: [
        'Walk me through how you\'d build a rolling 12-month revenue forecast.',
        'What\'s the difference between a fixed and a flexible budget, and when would you use each?',
        'How would you explain a variance between budgeted and actual results to a non-finance stakeholder?',
        'What key metrics would you track to monitor a company\'s cash runway?',
      ],
      scenario: 'Actual results are coming in well below the forecast you built two months ago. Walk me through how you\'d investigate and what you\'d tell leadership.',
    },
  ];

  const GENERAL_CATEGORY = {
    id: 'general-finance',
    label: 'General Finance',
    foundational: [
      'Walk me through the three financial statements and how they connect.',
      'What\'s the difference between profit and cash flow, and why does the distinction matter?',
      'How would you explain the time value of money to someone with no finance background?',
      'What factors would you weigh when comparing two investment opportunities?',
    ],
    scenario: 'You\'re given a dataset with a surprising, unexplained trend the week before a major decision is due. Walk me through how you\'d approach it under time pressure.',
  };

  const GUESSTIMATES = [
    'Estimate how many gas stations there are in the United States.',
    'Estimate the total value of vehicles sold in your home country last year.',
    'Estimate how many people are flying on commercial flights worldwide at this exact moment.',
    'Estimate the total amount spent on coffee in a major city like New York in a single day.',
  ];

  const LOGIC_PUZZLES = [
    'You have two identical eggs and access to a 100-floor building. You want to find the highest floor from which an egg can be dropped without breaking, using the fewest drops in the worst case. What\'s your strategy?',
    'You have 8 balls, identical in every way except one is slightly heavier. Using a balance scale only twice, how do you find the heavier ball?',
    'A bat and a ball together cost $1.10. The bat costs $1.00 more than the ball. How much does the ball cost, and why is the intuitive answer usually wrong?',
    'You\'re in a room with three light switches, each controlling one of three bulbs in another room you can only visit once. How do you determine which switch controls which bulb?',
  ];

  const HR_QUESTIONS = {
    strengths_weaknesses: (role) => `Tell me about a genuine strength and a genuine weakness relevant to succeeding in a ${role} role.`,
    why_field: (role) => `Why do you want to pursue a career in ${role}?`,
    difficult_situation: () => 'Describe a difficult situation you handled — what happened, what you did, and what you\'d do differently now.',
    career_goals: (role) => `Where do you see your career heading over the next several years in ${role}?`,
  };

  // Mode 2's follow-ups: simple, generic probes rather than AI-crafted
  // ones tied to the specific content of an answer — that specificity is
  // exactly what requires a live model, which this mode deliberately
  // doesn't use. A little variety across a session beats repeating one.
  const GENERIC_FOLLOWUPS = [
    'Can you elaborate on that with a specific, concrete example?',
    'What would you do differently if you had more time or more data?',
    'Walk me through the reasoning behind that a little more — what\'s actually driving that conclusion?',
    'If I pushed back and disagreed with that, how would you defend your answer?',
    'What\'s the biggest risk or weakness in the approach you just described?',
    'How would your answer change if the situation were twice as urgent?',
  ];

  // The self-assessment checklist Quick Practice shows instead of AI
  // feedback — three fixed, honest questions for the candidate to grade
  // themselves against, every time, so the checklist itself becomes a
  // habit rather than one-off commentary.
  const SELF_ASSESSMENT_ITEMS = [
    { id: 'structure', label: 'Clear structure — a beginning, a middle, and a clear point, not a ramble' },
    { id: 'specifics', label: 'Specific numbers, named examples, or concrete frameworks — not just generalities' },
    { id: 'conclusion', label: 'A clear conclusion or recommendation, not just a description of the situation' },
  ];

  function categoryFor(role) {
    const hit = CATEGORIES.find((c) => c.match.test(role || ''));
    return hit || GENERAL_CATEGORY;
  }

  function pick(arr, avoidSet) {
    const notAsked = arr.filter((q) => !avoidSet.has(q));
    const pool = notAsked.length ? notAsked : arr;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Mirrors InterviewModule.generateQuestion's contract, synchronously. */
  function getFallbackQuestion(role, subtype, alreadyAsked) {
    const cat = categoryFor(role);
    const avoid = new Set(alreadyAsked || []);
    switch (subtype) {
      case 'foundational': return pick(cat.foundational, avoid);
      case 'scenario': return cat.scenario;
      case 'guesstimate': return pick(GUESSTIMATES, avoid);
      case 'logic': return pick(LOGIC_PUZZLES, avoid);
      case 'strengths_weaknesses':
      case 'why_field':
      case 'difficult_situation':
      case 'career_goals':
        return HR_QUESTIONS[subtype](role);
      default: return GENERAL_CATEGORY.foundational[0];
    }
  }

  /** A generic probing follow-up for Quick Practice, avoiding immediate repeats within the session. */
  function getGenericFollowUp(alreadyUsed) {
    return pick(GENERIC_FOLLOWUPS, new Set(alreadyUsed || []));
  }

  /** Honest degraded feedback — no attempt to fake a read on the specific
   * answer content, since that genuinely requires the AI. No follow-up:
   * it's more honest to skip probing deeper than to fabricate a
   * specific-sounding question that isn't really tied to what they said. */
  function getDegradedFeedback() {
    return {
      wellCovered: 'Live AI feedback wasn\'t available for this answer (Gemini was rate-limited or unreachable) — this is a placeholder, not a real assessment.',
      missedOrWrong: 'Nothing to report here — see the note above.',
      improvement: 'Your answer was recorded in the transcript below; consider reviewing it yourself against the question once you\'re done.',
      followUp: null,
    };
  }

  /** Locally-computed session wrap-up when the AI summary call also fails — built entirely from the transcript already in memory, no network involved. */
  function buildLocalSummary(role, transcript) {
    const answered = transcript.filter((t) => !t.feedback.wellCovered.startsWith('Live AI feedback'));
    const degraded = transcript.length - answered.length;
    const roundsSeen = [...new Set(transcript.map((t) => t.roundId))];
    let overallSummary = `Live AI summary wasn't available (Gemini was rate-limited or unreachable), so here's a basic wrap-up computed locally: you answered ${transcript.length} questions for a "${role}" mock interview across ${roundsSeen.length} round(s).`;
    if (degraded > 0) overallSummary += ` ${degraded} of those got a placeholder instead of real AI feedback due to the same issue.`;
    overallSummary += ' Scroll down for your full transcript — worth reviewing your own answers against the questions while they\'re fresh.';
    return {
      overallSummary,
      topStrengths: ['(Not available — live AI summary was unreachable this session.)'],
      topAreasToImprove: ['(Not available — live AI summary was unreachable this session.)'],
    };
  }

  /** Quick Practice's summary — purely arithmetic over the self-assessment
   * checkboxes the candidate ticked themselves, same {overallSummary,
   * topStrengths, topAreasToImprove} shape the AI summary uses, so the
   * summary screen renders identically regardless of mode. */
  function buildQuickPracticeSummary(role, transcript) {
    const roundsSeen = [...new Set(transcript.map((t) => t.roundId))];
    const totalItems = transcript.reduce((sum, t) => sum + (t.checklist ? t.checklist.length : 0), 0);
    const checkedItems = transcript.reduce((sum, t) => sum + (t.checklist ? t.checklist.filter((c) => c.checked).length : 0), 0);
    const pct = totalItems ? Math.round((checkedItems / totalItems) * 100) : 0;

    const perItem = {};
    SELF_ASSESSMENT_ITEMS.forEach((item) => { perItem[item.id] = { total: 0, checked: 0 }; });
    transcript.forEach((t) => (t.checklist || []).forEach((c) => {
      if (!perItem[c.id]) return;
      perItem[c.id].total += 1;
      if (c.checked) perItem[c.id].checked += 1;
    }));

    const overallSummary = `This was a self-assessed Quick Practice session for a "${role}" mock interview — no AI grading, just your own honest checklist. You answered ${transcript.length} questions across ${roundsSeen.length} round(s) and checked off ${checkedItems} of ${totalItems} self-assessment boxes overall (${pct}%). Use the per-item breakdown below to see which habit needs the most work, and consider running an Adaptive AI session next for a genuinely graded read.`;

    const strengths = [];
    const improve = [];
    SELF_ASSESSMENT_ITEMS.forEach((item) => {
      const stat = perItem[item.id];
      if (!stat.total) return;
      const itemPct = Math.round((stat.checked / stat.total) * 100);
      const phrase = `${item.label.split(' — ')[0]}: checked in ${stat.checked}/${stat.total} answers (${itemPct}%)`;
      if (itemPct >= 70) strengths.push(phrase);
      else improve.push(phrase);
    });
    if (!strengths.length) strengths.push('(No checklist item was consistently checked this session — that\'s useful signal on its own.)');
    if (!improve.length) improve.push('(Every checklist item was checked consistently — nice. Try Adaptive AI mode for a tougher, more specific read.)');

    return { overallSummary, topStrengths: strengths, topAreasToImprove: improve };
  }

  return {
    SELF_ASSESSMENT_ITEMS,
    categoryFor, getFallbackQuestion, getGenericFollowUp, getDegradedFeedback,
    buildLocalSummary, buildQuickPracticeSummary,
  };
})();
