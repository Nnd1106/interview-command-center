/* ---------------------------------------------------------------------
 * main.js — screen flow and state machine for both modes:
 *   'ai'    — Adaptive AI Interview: Gemini-generated questions, AI
 *             follow-ups tied to the actual answer, AI-graded feedback.
 *   'quick' — Quick Practice: the static per-category bank from
 *             fallbackContent.js, generic follow-up probes, and a
 *             self-assessment checklist instead of AI grading. Zero
 *             network calls, no API key.
 * Both modes share the same round/timer/progress machinery below —
 * only question sourcing, follow-up generation, and feedback rendering
 * branch on `state.mode`.
 *
 * All interview state lives in the plain `state` object below: never
 * written to localStorage, sessionStorage, IndexedDB, or a cookie, and
 * never sent anywhere except as the minimal { role, question, answer }
 * payloads passed into InterviewModule's prompt builders in AI mode.
 * Reloading or closing the tab loses it all — that's the privacy
 * guarantee, enforced by simply never persisting it in the first place.
 * ------------------------------------------------------------------- */

(() => {
  const $ = (id) => document.getElementById(id);

  let selectedMode = null; // 'ai' | 'quick' — chosen on the mode-select screen
  let state = null;
  function freshState(mode) {
    return {
      mode,
      role: '',
      roundIndex: 0,
      questionIndex: 0,
      askedFoundational: [],
      usedFollowUps: [],       // quick mode: generic follow-ups already used, for variety
      pendingFollowUp: null,   // follow-up question text once queued, before it's shown
      pendingAnswer: null,     // quick mode: answer text held between "Submit" and "Continue" (checklist read happens at Continue)
      awaitingFollowUp: false, // true once the follow-up is on screen
      transcript: [],
      timer: null,
    };
  }

  // ---------- Screens ----------

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Mode select ----------

  function chooseMode(mode) {
    selectedMode = mode;
    $('api-key-section').style.display = mode === 'ai' ? 'block' : 'none';
    $('mode-banner').innerHTML = mode === 'ai'
      ? '<strong>Adaptive AI Interview</strong> selected — realistic and adaptive, but each step can take ~20–40s and needs a free Gemini key below.'
      : '<strong>Quick Practice</strong> selected — instant questions, no API key needed. Follow-ups are generic and feedback is a self-assessment checklist, not AI-graded.';
    $('role-card-hint').textContent = mode === 'ai'
      ? 'Three rounds: Technical foundations → Applied/case (scenario, guesstimate, logic) → HR/behavioral. Every question is generated live by Gemini for the exact role you type.'
      : 'Three rounds: Technical foundations → Applied/case (scenario, guesstimate, logic) → HR/behavioral. Questions come from a static bank matched to the closest category for the role you type.';
    updateStartButton();
    showScreen('screen-setup');
  }

  function setKeyStatus() {
    const key = AiClientModule.getApiKey();
    const el = $('key-status');
    const text = $('key-status-text');
    if (key) {
      el.classList.add('saved');
      text.textContent = `Key saved (ends …${key.slice(-4)}).`;
    } else {
      el.classList.remove('saved');
      text.textContent = 'No key saved yet.';
    }
    updateStartButton();
  }

  function updateStartButton() {
    const role = $('role-input').value.trim();
    const btn = $('start-btn');
    if (selectedMode === 'ai' && !AiClientModule.hasApiKey()) {
      btn.disabled = true;
      btn.textContent = 'Add a free Gemini API key above first';
    } else if (!role) {
      btn.disabled = true;
      btn.textContent = 'Enter a role above to begin';
    } else {
      btn.disabled = false;
      btn.textContent = selectedMode === 'quick' ? `Start Quick Practice — ${role}` : `Start mock interview — ${role}`;
    }
  }

  function showSetupError(msg) {
    const el = $('setup-error');
    el.textContent = msg;
    el.style.display = msg ? 'flex' : 'none';
  }

  // ---------- Interview screen: round rail / progress / mode pill ----------

  function renderRoundRail() {
    const rail = $('round-rail');
    rail.innerHTML = InterviewModule.ROUNDS.map((r, i) => {
      const cls = i < state.roundIndex ? 'done' : i === state.roundIndex ? 'active' : '';
      return `<div class="round-pip ${cls}"><span class="pip-dot"></span><span>${escapeHtml(r.title)}</span></div>`;
    }).join('');
  }

  function renderModePill() {
    const pill = $('mode-pill');
    pill.textContent = state.mode === 'ai' ? 'Adaptive AI' : 'Quick Practice';
    pill.classList.toggle('mode-ai', state.mode === 'ai');
    pill.classList.toggle('mode-quick', state.mode === 'quick');
  }

  function totalQuestionsOverall() {
    return InterviewModule.ROUNDS.reduce((sum, r) => sum + r.questions.length, 0);
  }
  function questionsCompletedOverall() {
    let done = 0;
    for (let i = 0; i < state.roundIndex; i++) done += InterviewModule.ROUNDS[i].questions.length;
    return done + state.questionIndex;
  }

  function renderProgress() {
    const pct = clamp((questionsCompletedOverall() / totalQuestionsOverall()) * 100, 0, 100);
    $('progress-fill').style.width = pct + '%';
  }

  function currentRound() { return InterviewModule.ROUNDS[state.roundIndex]; }
  function currentQuestionSpec() { return currentRound().questions[state.questionIndex]; }

  // ---------- Timer ----------

  function stopTimer() { if (state.timer) { state.timer.stop(); state.timer = null; } }

  function startTimerForCurrentQuestion() {
    stopTimer();
    const seconds = currentRound().timerSeconds;
    state.timer = TimerModule.start(seconds, {
      onTick: (remaining, total) => {
        const el = $('timer-display');
        el.textContent = fmtClock(remaining);
        el.classList.toggle('warn', remaining <= total * 0.33 && remaining > total * 0.12);
        el.classList.toggle('critical', remaining <= total * 0.12);
      },
      onExpire: () => {
        $('answer-hint').textContent = "Time's up — wrap up whenever you're ready, there's no penalty for finishing your thought.";
      },
    });
  }

  // ---------- Loading / error UI (Adaptive AI mode only) ----------

  let retryCountdownInterval = null;
  function clearRetryCountdown() { if (retryCountdownInterval) { clearInterval(retryCountdownInterval); retryCountdownInterval = null; } }

  function setLoading(on, text) {
    clearRetryCountdown();
    $('loading-row').style.display = on ? 'flex' : 'none';
    if (text) $('loading-text').textContent = text;
    $('submit-answer-btn').disabled = on;
    $('answer-input').disabled = on;
  }

  /** Shown while aiClient.generateWithRetry is backing off after a failed
   * attempt — makes the automatic retry visible and countable rather than
   * a silent multi-second stall the user has no read on. */
  function showRetryProgress(waitMs, label) {
    clearRetryCountdown();
    let remaining = Math.ceil(waitMs / 1000);
    const render = () => { $('loading-text').textContent = `${label} — retrying in ${remaining}s…`; };
    $('loading-row').style.display = 'flex';
    render();
    retryCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { clearRetryCountdown(); $('loading-text').textContent = `${label} — retrying now…`; return; }
      render();
    }, 1000);
  }

  function showInterviewError(msg, retryFn) {
    const el = $('interview-error');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (retryFn) {
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => { el.style.display = 'none'; retryFn(); });
      el.appendChild(btn);
    }
    el.style.display = 'flex';
  }
  function hideInterviewError() { $('interview-error').style.display = 'none'; }

  /** Non-blocking amber notice — used when a fallback (static question or
   * degraded feedback) kicked in after Gemini failed twice in a row. The
   * interview keeps going; this just discloses that it happened, honestly,
   * rather than silently pretending the fallback content is live AI. Only
   * ever shown in Adaptive AI mode — Quick Practice's static content is
   * the deliberately chosen experience, not a degradation of anything. */
  function showInterviewNotice(msg) {
    const el = $('interview-notice');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Dismiss';
    btn.addEventListener('click', () => { el.style.display = 'none'; });
    el.appendChild(btn);
    el.style.display = 'flex';
  }
  function hideInterviewNotice() { $('interview-notice').style.display = 'none'; }

  // ---------- Question flow ----------

  function resetQuestionCardChrome() {
    hideInterviewError();
    hideInterviewNotice();
    $('feedback-card').style.display = 'none';
    $('answer-input').value = '';
    $('answer-input').disabled = false;
    $('fallback-tag').style.display = 'none';
    $('category-tag').style.display = 'none';
    state.awaitingFollowUp = false;
    state.pendingFollowUp = null;
  }

  /** Shows which static-bank category the typed role matched to — used
   * whenever bank content is on screen (Quick Practice always; Adaptive
   * AI only when it's fallen back after Gemini failed twice). */
  function showCategoryTag() {
    const cat = FallbackContentModule.categoryFor(state.role);
    const tag = $('category-tag');
    tag.textContent = `Category: ${cat.label}`;
    tag.style.display = 'inline-block';
  }

  async function loadCoreQuestion() {
    resetQuestionCardChrome();
    $('answer-hint').textContent = "Answer as you would in a real interview — specific, structured, and honest.";

    renderRoundRail();
    renderModePill();
    renderProgress();
    const round = currentRound();
    const spec = currentQuestionSpec();
    $('round-title').textContent = round.title;
    $('round-subtitle').textContent = round.subtitle;
    $('question-type-badge').textContent = spec.label;
    $('question-type-badge').classList.remove('followup');
    $('question-progress-label').textContent = `Question ${state.questionIndex + 1} of ${round.questions.length}`;

    if (state.mode === 'quick') {
      // Instant, synchronous, zero network calls — the whole point of this mode.
      const question = FallbackContentModule.getFallbackQuestion(state.role, spec.subtype, state.askedFoundational);
      $('question-text').textContent = question;
      if (spec.subtype === 'foundational') state.askedFoundational.push(question);
      state.currentQuestionText = question;
      showCategoryTag();
      startTimerForCurrentQuestion();
      return;
    }

    $('question-text').textContent = 'Generating your question…';
    setLoading(true, 'Preparing your question…');
    const onRetry = (attempt, waitMs) => showRetryProgress(waitMs, "Gemini's free-tier rate limit was hit");
    try {
      const question = await InterviewModule.generateQuestion(state.role, round.id, spec.subtype, state.askedFoundational, onRetry);
      $('question-text').textContent = question;
      if (spec.subtype === 'foundational') state.askedFoundational.push(question);
      state.currentQuestionText = question;
      startTimerForCurrentQuestion();
    } catch (err) {
      if (err.kind === 'auth' || err.kind === 'no-key') {
        $('question-text').textContent = 'Couldn\'t generate this question.';
        showInterviewError(err.message || 'Something went wrong.', loadCoreQuestion);
      } else {
        // Two live attempts already failed (generateWithRetry's job) —
        // rather than block here too, fall back to a static question so
        // the interview keeps moving, and say so plainly.
        const question = FallbackContentModule.getFallbackQuestion(state.role, spec.subtype, state.askedFoundational);
        $('question-text').textContent = question;
        if (spec.subtype === 'foundational') state.askedFoundational.push(question);
        state.currentQuestionText = question;
        $('fallback-tag').style.display = 'inline-block';
        showCategoryTag();
        startTimerForCurrentQuestion();
        showInterviewNotice(`Gemini was unavailable after two attempts (${err.message}) — using a backup question so you can keep going.`);
      }
    } finally {
      setLoading(false);
    }
  }

  function loadFollowUpQuestion() {
    hideInterviewError();
    hideInterviewNotice();
    $('feedback-card').style.display = 'none';
    $('answer-input').value = '';
    $('answer-input').disabled = false;
    $('answer-hint').textContent = state.mode === 'quick'
      ? "A quick generic probe — no need to overthink it, just extend your last answer."
      : "This follow-up digs into what you just said — be specific.";
    state.awaitingFollowUp = true;
    state.originalQuestionText = state.currentQuestionText;
    state.originalAnswerText = state.lastAnswerText;
    state.currentQuestionText = state.pendingFollowUp;

    $('question-type-badge').textContent = 'Follow-up';
    $('question-type-badge').classList.add('followup');
    $('question-text').textContent = state.pendingFollowUp;
    startTimerForCurrentQuestion();
  }

  async function submitAnswer() {
    const answer = $('answer-input').value.trim();
    if (!answer) { showInterviewError('Type an answer before submitting — even a partial attempt is fine.'); return; }
    stopTimer();
    hideInterviewError();
    hideInterviewNotice();
    state.lastAnswerText = answer;

    if (state.mode === 'quick') {
      // Fully synchronous: no AI grading exists in this mode, so there's
      // nothing to await. Queue a generic follow-up after a core question
      // (never after the follow-up itself — same one-level-deep structure
      // as Adaptive AI mode), then show the self-assessment checklist.
      state.pendingAnswer = answer;
      const hasFollowUp = !state.awaitingFollowUp;
      if (hasFollowUp) {
        const followUp = FallbackContentModule.getGenericFollowUp(state.usedFollowUps);
        state.usedFollowUps.push(followUp);
        state.pendingFollowUp = followUp;
      } else {
        state.pendingFollowUp = null;
      }
      renderChecklist(hasFollowUp);
      return;
    }

    setLoading(true, state.awaitingFollowUp ? 'Reviewing your follow-up answer…' : 'Reviewing your answer and preparing a follow-up…');
    const onRetry = (attempt, waitMs) => showRetryProgress(waitMs, "Gemini's free-tier rate limit was hit");
    try {
      if (state.awaitingFollowUp) {
        const result = await InterviewModule.generateFeedbackOnly(state.role, currentRound().id, state.originalQuestionText, state.currentQuestionText, answer, onRetry);
        recordTranscript(state.currentQuestionText, answer, { feedback: pickFeedbackFields(result) }, true);
        renderFeedback(result, false);
      } else {
        const result = await InterviewModule.generateFeedbackAndFollowUp(state.role, currentRound().id, state.currentQuestionText, answer, onRetry);
        recordTranscript(state.currentQuestionText, answer, { feedback: pickFeedbackFields(result) }, false);
        state.pendingFollowUp = result.followUp;
        renderFeedback(result, true);
      }
      setLoading(false);
    } catch (err) {
      setLoading(false);
      if (err.kind === 'auth' || err.kind === 'no-key') {
        showInterviewError(err.message || 'Something went wrong getting feedback.', () => submitAnswer());
      } else {
        // Two live attempts already failed. There's no honest way to fake
        // feedback tied to their actual answer, so show a clearly-labeled
        // placeholder and skip queuing a follow-up rather than inventing
        // one that isn't really grounded in what they said.
        const degraded = FallbackContentModule.getDegradedFeedback();
        recordTranscript(state.currentQuestionText, answer, { feedback: pickFeedbackFields(degraded) }, state.awaitingFollowUp);
        state.pendingFollowUp = null;
        renderFeedback(degraded, false);
        showInterviewNotice(`Live AI feedback was unavailable after two attempts (${err.message}) — showing a placeholder so you can keep going.`);
      }
    }
  }

  function pickFeedbackFields(result) {
    return { wellCovered: result.wellCovered, missedOrWrong: result.missedOrWrong, improvement: result.improvement };
  }

  function recordTranscript(question, answer, extra, isFollowUp) {
    state.transcript.push({ roundId: currentRound().id, question, answer, isFollowUp, ...extra });
  }

  function renderFeedback(result, hasFollowUp) {
    $('feedback-card-label').textContent = 'Interviewer feedback';
    $('ai-feedback-block').style.display = 'block';
    $('quick-feedback-block').style.display = 'none';
    $('fb-covered').textContent = result.wellCovered || '—';
    $('fb-missed').textContent = result.missedOrWrong || '—';
    $('fb-improve').textContent = result.improvement || '—';
    $('feedback-card').style.display = 'block';
    $('next-btn').textContent = hasFollowUp ? 'Continue to follow-up' : 'Continue';
    $('feedback-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Quick mode's "feedback" — a self-assessment checklist rebuilt fresh
   * (unchecked) for every question, read back at Continue time. */
  function renderChecklist(hasFollowUp) {
    $('feedback-card-label').textContent = 'Self-assessment';
    $('ai-feedback-block').style.display = 'none';
    $('quick-feedback-block').style.display = 'block';
    $('checklist-items').innerHTML = FallbackContentModule.SELF_ASSESSMENT_ITEMS.map((item) => `
      <label class="checklist-item" data-item-id="${escapeHtml(item.id)}">
        <input type="checkbox" data-item-id="${escapeHtml(item.id)}" />
        <span>${escapeHtml(item.label)}</span>
      </label>
    `).join('');
    $('feedback-card').style.display = 'block';
    $('next-btn').textContent = hasFollowUp ? 'Continue to follow-up' : 'Continue';
    $('feedback-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function wireChecklistToggling() {
    $('checklist-items').addEventListener('change', (e) => {
      const input = e.target;
      if (input.type !== 'checkbox') return;
      const label = input.closest('.checklist-item');
      if (label) label.classList.toggle('checked', input.checked);
    });
  }

  function readChecklistState() {
    return FallbackContentModule.SELF_ASSESSMENT_ITEMS.map((item) => {
      const input = document.querySelector(`#checklist-items input[data-item-id="${item.id}"]`);
      return { id: item.id, label: item.label, checked: !!(input && input.checked) };
    });
  }

  async function advanceAfterFeedback() {
    if (state.mode === 'quick') {
      const checklist = readChecklistState();
      recordTranscript(state.currentQuestionText, state.pendingAnswer, { checklist }, state.awaitingFollowUp);
    }

    if (!state.awaitingFollowUp && state.pendingFollowUp) {
      // Core question's feedback/checklist was just shown and a follow-up is queued.
      loadFollowUpQuestion();
      return;
    }
    // Either the follow-up's feedback was just shown, or there was no
    // follow-up queued (shouldn't happen given the flow, but fall through
    // safely) — advance to the next core question / round / finish.
    state.questionIndex += 1;
    if (state.questionIndex >= currentRound().questions.length) {
      state.questionIndex = 0;
      state.roundIndex += 1;
    }
    if (state.roundIndex >= InterviewModule.ROUNDS.length) {
      await finishInterview();
      return;
    }
    await loadCoreQuestion();
  }

  // ---------- Summary ----------

  async function finishInterview() {
    showScreen('screen-summary');
    $('summary-role-line').textContent = `Mock interview for "${state.role}" (${state.mode === 'ai' ? 'Adaptive AI' : 'Quick Practice'}) — ${state.transcript.length} questions answered across 3 rounds.`;
    renderTranscript();
    $('privacy-reminder').innerHTML = state.mode === 'ai'
      ? '🔒 This transcript exists only on this page, right now. Nothing was ever sent anywhere except Gemini\'s API for generating questions and feedback, and nothing was ever saved server-side — there is no server. Close or reload this tab and every trace of this session is gone for good.'
      : '🔒 This transcript exists only on this page, right now. Quick Practice mode made zero network calls the entire session — nothing was ever sent anywhere. Close or reload this tab and every trace of this session is gone for good.';

    if (state.mode === 'quick') {
      const summary = FallbackContentModule.buildQuickPracticeSummary(state.role, state.transcript);
      renderSummary(summary);
      return;
    }

    $('summary-overall').textContent = 'Putting together your overall read…';
    $('summary-strengths').innerHTML = '';
    $('summary-improve').innerHTML = '';
    const onRetry = (attempt, waitMs) => { $('summary-overall').textContent = `Gemini's free-tier rate limit was hit — retrying automatically in ${Math.ceil(waitMs / 1000)}s…`; };
    try {
      const summary = await InterviewModule.generateFinalSummary(state.role, state.transcript, onRetry);
      renderSummary(summary);
    } catch {
      // Two live attempts already failed — fall back to a summary computed
      // locally from the transcript already sitting in memory, so the
      // session still ends with something useful instead of an apology.
      renderSummary(FallbackContentModule.buildLocalSummary(state.role, state.transcript));
    }
  }

  function renderSummary(summary) {
    $('summary-overall').textContent = summary.overallSummary || '—';
    $('summary-strengths').innerHTML = (summary.topStrengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>';
    $('summary-improve').innerHTML = (summary.topAreasToImprove || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>';
  }

  function renderTranscript() {
    $('transcript-list').innerHTML = state.transcript.map((t) => `
      <div class="transcript-item">
        <div class="t-round">${escapeHtml(InterviewModule.ROUND_LABEL[t.roundId])}${t.isFollowUp ? ' · Follow-up' : ''}</div>
        <div class="t-q">${escapeHtml(t.question)}</div>
        <div class="t-a">"${escapeHtml(t.answer)}"</div>
      </div>
    `).join('');
  }

  // ---------- Wiring ----------

  document.addEventListener('DOMContentLoaded', () => {
    setKeyStatus();
    wireChecklistToggling();

    $('choose-ai-btn').addEventListener('click', () => chooseMode('ai'));
    $('choose-quick-btn').addEventListener('click', () => chooseMode('quick'));
    $('change-mode-btn').addEventListener('click', () => showScreen('screen-mode-select'));

    $('save-key-btn').addEventListener('click', () => {
      AiClientModule.setApiKey($('api-key-input').value);
      $('api-key-input').value = '';
      setKeyStatus();
    });

    $('role-input').addEventListener('input', updateStartButton);
    $('role-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('start-btn').disabled) $('start-btn').click(); });

    document.querySelectorAll('.role-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $('role-input').value = chip.dataset.role;
        updateStartButton();
        $('role-input').focus();
      });
    });

    // Disabled synchronously, before any `await`, so a fast double-click
    // (or an eager double-tap) can't land a second click while the first
    // is still in flight and fire two concurrent question-generation
    // calls — that burst is exactly what was tripping Gemini's rate limit
    // on the very first question.
    $('start-btn').addEventListener('click', async () => {
      const btn = $('start-btn');
      if (btn.disabled) return;
      const role = $('role-input').value.trim();
      if (!role) return;
      btn.disabled = true;
      showSetupError('');
      state = freshState(selectedMode);
      state.role = role;
      showScreen('screen-interview');
      await loadCoreQuestion();
      // Left disabled here on purpose: updateStartButton() re-enables it
      // (or not) whenever the user returns to this screen via restart.
    });

    $('submit-answer-btn').addEventListener('click', submitAnswer);
    $('answer-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAnswer();
    });

    $('next-btn').addEventListener('click', async () => {
      const btn = $('next-btn');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await advanceAfterFeedback();
      } finally {
        btn.disabled = false;
      }
    });

    $('restart-btn').addEventListener('click', () => {
      state = null;
      $('role-input').value = '';
      showScreen('screen-mode-select');
    });
  });
})();
