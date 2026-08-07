/* ---------------------------------------------------------------------
 * fallbackContent.js — a small, static, per-category question bank and
 * locally-computed feedback/summary so the interview can keep going
 * even when Gemini is unavailable (rate-limited, network hiccup, etc.)
 * after two consecutive failed attempts. Nothing here calls the network
 * or touches localStorage — it's pure, synchronous, offline content.
 *
 * The role the candidate typed is free text, not a fixed list, so this
 * matches it against a handful of broad finance-career categories by
 * keyword; anything that doesn't match falls back to a general-finance
 * question set. It's intentionally small — just enough that a rate
 * limit never fully breaks the mock interview, not a replacement for
 * genuinely tailored AI questions.
 * ------------------------------------------------------------------- */

const FallbackContentModule = (() => {
  const CATEGORIES = [
    {
      id: 'equity-research',
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
      id: 'credit-risk',
      match: /credit risk|credit analy|lending|loan officer|underwriting.*loan/i,
      foundational: [
        'What are the "5 Cs of credit," and how would you apply them to evaluate a borrower?',
        'What\'s the difference between probability of default and loss given default?',
        'How would you assess whether a company can service its debt obligations?',
        'What covenants might a lender put on a loan, and why?',
      ],
      scenario: 'A long-standing borrower\'s revenue has declined for two consecutive quarters while their debt load has stayed flat. Walk me through your credit reassessment.',
    },
    {
      id: 'private-equity',
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
      id: 'fpna-corporate',
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

  return { getFallbackQuestion, getDegradedFeedback, buildLocalSummary };
})();
