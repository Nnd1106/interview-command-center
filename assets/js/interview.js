/* ---------------------------------------------------------------------
 * interview.js — round structure and AI prompt/schema builders. Every
 * builder here takes only { role, question, answer }-shaped data — the
 * privacy contract documented in aiClient.js. No function in this file
 * ever touches a resume, a name, or anything beyond what the candidate
 * typed into the answer box for the current question.
 * ------------------------------------------------------------------- */

const InterviewModule = (() => {
  const ROUNDS = [
    {
      id: 'technical1',
      title: 'Technical Round 1',
      subtitle: 'Foundations',
      timerSeconds: 150,
      questions: [
        { subtype: 'foundational', label: 'Foundational' },
        { subtype: 'foundational', label: 'Foundational' },
        { subtype: 'foundational', label: 'Foundational' },
      ],
    },
    {
      id: 'technical2',
      title: 'Technical Round 2',
      subtitle: 'Applied & Case',
      timerSeconds: 150,
      questions: [
        { subtype: 'scenario', label: 'Scenario' },
        { subtype: 'guesstimate', label: 'Guesstimate' },
        { subtype: 'logic', label: 'Logic Puzzle' },
      ],
    },
    {
      id: 'hr',
      title: 'HR Round',
      subtitle: 'Behavioral',
      timerSeconds: 150,
      questions: [
        { subtype: 'strengths_weaknesses', label: 'Strengths & Weaknesses' },
        { subtype: 'why_field', label: 'Why This Field' },
        { subtype: 'difficult_situation', label: 'Difficult Situation' },
        { subtype: 'career_goals', label: 'Career Goals' },
      ],
    },
  ];

  const SYSTEM_INSTRUCTION = (role) => `You are a senior, highly experienced interviewer conducting a real mock interview for a candidate targeting this role/domain: "${role}". You ask sharp, genuinely relevant questions for that specific field — never generic filler that could apply to any job — and you give feedback the way a rigorous-but-fair real interviewer would: encouraging in tone, but honest, specific, and willing to say an answer was weak or incomplete when it was. Never artificially easy. You always respond with strictly valid JSON matching the exact schema you're given for each task — no markdown, no code fences, no commentary outside the JSON fields, no field names other than the ones requested.`;

  const QUESTION_SCHEMA = {
    type: 'OBJECT',
    properties: { question: { type: 'STRING' } },
    required: ['question'],
  };

  const FEEDBACK_AND_FOLLOWUP_SCHEMA = {
    type: 'OBJECT',
    properties: {
      wellCovered: { type: 'STRING' },
      missedOrWrong: { type: 'STRING' },
      improvement: { type: 'STRING' },
      followUp: { type: 'STRING' },
    },
    required: ['wellCovered', 'missedOrWrong', 'improvement', 'followUp'],
  };

  const FEEDBACK_ONLY_SCHEMA = {
    type: 'OBJECT',
    properties: {
      wellCovered: { type: 'STRING' },
      missedOrWrong: { type: 'STRING' },
      improvement: { type: 'STRING' },
    },
    required: ['wellCovered', 'missedOrWrong', 'improvement'],
  };

  const SUMMARY_SCHEMA = {
    type: 'OBJECT',
    properties: {
      overallSummary: { type: 'STRING' },
      topStrengths: { type: 'ARRAY', items: { type: 'STRING' } },
      topAreasToImprove: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['overallSummary', 'topStrengths', 'topAreasToImprove'],
  };

  const QUESTION_PROMPTS = {
    foundational: (role, avoid) => `Generate ONE foundational, theory-based technical interview question for a candidate interviewing for a "${role}" role. It should test core conceptual understanding that a genuinely strong candidate in this specific field should have — grounded in real concepts, terminology, and frameworks used in that field. Keep it to 1-3 sentences, no preamble, no numbering.${avoid.length ? ` Do not repeat or closely resemble any of these already-asked questions: ${avoid.map((q) => `"${q}"`).join('; ')}.` : ''}`,
    scenario: (role) => `Generate ONE applied, scenario-based case interview question relevant to a "${role}" role — present a realistic on-the-job situation specific to that field and ask what the candidate would do or how they'd analyze it. 2-4 sentences, no preamble, no numbering.`,
    guesstimate: (role) => `Generate ONE brief guesstimate/estimation interview question, in the style of classic case-interview Fermi/market-sizing problems, tailored to be relevant to a "${role}" role wherever a natural angle exists (otherwise a sharp general estimation question). 1-3 sentences, no preamble, no solution.`,
    logic: (role) => `Generate ONE brief logical-reasoning puzzle of the kind used in quantitative/analytical interviews. Lean toward relevance to a "${role}" role if a natural fit exists, otherwise use a sharp classic logic puzzle. 1-4 sentences, no preamble, do NOT include the solution or any hints.`,
    strengths_weaknesses: (role) => `Generate ONE behavioral interview question asking the candidate to describe a genuine strength and a genuine weakness relevant to succeeding in a "${role}" role. 1-2 sentences.`,
    why_field: (role) => `Generate ONE behavioral interview question asking specifically why the candidate wants to pursue a career in "${role}" / this field. 1-2 sentences.`,
    difficult_situation: (role) => `Generate ONE behavioral interview question asking the candidate to describe a difficult situation they handled, phrased so the expected answer would be relevant to challenges "${role}" professionals actually face. 1-2 sentences.`,
    career_goals: (role) => `Generate ONE behavioral interview question asking about the candidate's career goals and trajectory, relevant to a "${role}" career path. 1-2 sentences.`,
  };

  const ROUND_LABEL = { technical1: 'Technical Round 1 (Foundations)', technical2: 'Technical Round 2 (Applied & Case)', hr: 'HR Round (Behavioral)' };

  async function generateQuestion(role, roundId, subtype, alreadyAsked, onRetry) {
    const builder = QUESTION_PROMPTS[subtype];
    const prompt = subtype === 'foundational' ? builder(role, alreadyAsked || []) : builder(role);
    const result = await AiClientModule.generateWithRetry({
      systemInstruction: SYSTEM_INSTRUCTION(role),
      prompt,
      schema: QUESTION_SCHEMA,
    }, { onRetry });
    return result.question;
  }

  async function generateFeedbackAndFollowUp(role, roundId, question, answer, onRetry) {
    const prompt = `Round: ${ROUND_LABEL[roundId]}\nQuestion asked: "${question}"\nCandidate's answer: "${answer}"\n\nDo two things:\n1. Give structured feedback on this specific answer: what they covered well (wellCovered — be genuine, don't invent praise if the answer was weak), what was missing, vague, or incorrect (missedOrWrong — if honestly nothing important is missing, say so briefly rather than inventing a flaw), and one specific, actionable way to improve (improvement).\n2. Write ONE genuine, sharp follow-up question that digs into something SPECIFIC they actually said in their answer above — probe a vague claim, push for a concrete example, question an assumption, or ask them to go one level deeper on a point they raised. It must clearly build on their actual answer, not be a generic next question a robot would ask regardless of what they said.`;
    return AiClientModule.generateWithRetry({ systemInstruction: SYSTEM_INSTRUCTION(role), prompt, schema: FEEDBACK_AND_FOLLOWUP_SCHEMA }, { onRetry });
  }

  async function generateFeedbackOnly(role, roundId, originalQuestion, followUpQuestion, answer, onRetry) {
    const prompt = `Round: ${ROUND_LABEL[roundId]}\nThis is a follow-up question that was asked after the candidate's earlier answer to "${originalQuestion}".\nFollow-up question asked: "${followUpQuestion}"\nCandidate's answer to the follow-up: "${answer}"\n\nGive structured feedback on this specific answer: what they covered well (wellCovered — genuine, don't invent praise), what was missing, vague, or incorrect (missedOrWrong — say so honestly if nothing important is missing), and one specific actionable way to improve (improvement).`;
    return AiClientModule.generateWithRetry({ systemInstruction: SYSTEM_INSTRUCTION(role), prompt, schema: FEEDBACK_ONLY_SCHEMA }, { onRetry });
  }

  async function generateFinalSummary(role, transcript, onRetry) {
    const condensed = transcript.map((t, i) => `${i + 1}. [${ROUND_LABEL[t.roundId]}] Q: "${t.question}" — Candidate's gist: "${t.answer.slice(0, 200)}" — Feedback given: covered well: "${t.feedback.wellCovered}"; missed: "${t.feedback.missedOrWrong}"`).join('\n');
    const prompt = `You just finished conducting a full 3-round mock interview for a candidate targeting a "${role}" role. Here is a condensed record of the interview:\n${condensed}\n\nWrite a brief, honest overall performance summary (overallSummary, 3-5 sentences) the way a rigorous-but-encouraging interviewer would after a real interview debrief, plus 2-4 short topStrengths phrases and 2-4 short topAreasToImprove phrases — all grounded in what actually happened in the transcript above, not invented.`;
    return AiClientModule.generateWithRetry({ systemInstruction: SYSTEM_INSTRUCTION(role), prompt, schema: SUMMARY_SCHEMA }, { onRetry });
  }

  return { ROUNDS, ROUND_LABEL, generateQuestion, generateFeedbackAndFollowUp, generateFeedbackOnly, generateFinalSummary };
})();
