/* ════ DATA (loaded from data.json) ════ */
let DATA = null;

async function loadData() {
  try {
    const r = await fetch('data.json');
    DATA = await r.json();
  } catch(e) {
    // fallback: data embedded (for local file:// use)
    DATA = FALLBACK_DATA;
  }
  initHome();
}

/* ════ STATE ════ */
let mode = 'quiz';
let questions = [], qIdx = 0, score = 0, maxScore = 0;
let answered = false;
let qPenalty = 0, quizWrong = 0, wordleTries = 0, matchTries = 0;
let matchSubmitted = false;
let timerInterval = null, timerSeconds = 0;
let countdownMode = false; // future: countdown
let gameStartTime = 0;
let prevScreen = 'home';
let glosActiveFilter = 'all';

/* ════ SCORING HELPERS ════ */
// Base 100pts/question. Penalties deducted on correct answer.
// Round: floor for deductions, ceil for earned (favours player)
function calcEarned(penalty) {
  return Math.max(0, Math.ceil(100 - penalty));
}
// Quiz: each wrong = 100/(n_choices) penalty, max 80 deducted
function quizPenalty(wrongCount, nChoices) {
  const perWrong = Math.floor(100 / nChoices);
  return Math.min(80, wrongCount * perWrong);
}
// Wordle: each wrong try = floor(100/5) = 20pts deducted, max 80
function wordlePenalty(wrongTries) {
  return Math.min(80, wrongTries * 20);
}
// Match: each wrong submission = 25pt deducted per pair in set, max 75
function matchPenaltyForPair(wrongSubs) {
  return Math.min(75, wrongSubs * 25);
}

/* ════ INIT HOME ════ */
function initHome() {
  // Update badges from data
  const q = DATA.quiz.length, w = DATA.wordle.length, m = DATA.match.length, g = DATA.glossary.length;
  document.getElementById('badge-quiz').textContent = `${q} câu · tối đa 100đ/câu`;
  document.getElementById('badge-wordle').textContent = `${w} câu · tối đa 100đ/câu`;
  document.getElementById('badge-match').textContent = `${m} cặp · tối đa 100đ/cặp`;
  document.getElementById('badge-glossary').textContent = `${g} thuật ngữ · EN + VI`;
  // Count input max
  updateCountNote();
  document.getElementById('count-inp').addEventListener('input', updateCountNote);
  // Load bests
  refreshHomeBests();
}

function updateCountNote() {
  const inp = document.getElementById('count-inp');
  const note = document.getElementById('count-note');
  const max = getModeMax();
  inp.max = max;
  inp.min = 2;
  if (parseInt(inp.value) > max) inp.value = max;
  if (parseInt(inp.value) < 2) inp.value = 2;
  if (mode === 'match') {
    const n = parseInt(inp.value) || 2;
    const rounds = getMatchRounds(n);
    note.textContent = `→ ${rounds} vòng × ${n} cặp`;
  } else {
    note.textContent = `tối đa ${max} câu`;
  }
}

function getModeMax() {
  if (!DATA) return 10;
  if (mode === 'quiz') return DATA.quiz.length;
  if (mode === 'wordle') return DATA.wordle.length;
  if (mode === 'match') return Math.floor(DATA.match.length / 2); // max n such that floor(total/n)>=1, cap at half
  return 10;
}

// For match: returns how many rounds given n pairs-per-round
function getMatchRounds(n) {
  if (!DATA) return 1;
  return Math.max(1, Math.floor(DATA.match.length / n));
}

function selMode(m) {
  if (m === 'glossary') { openGlossary(); return; }
  mode = m;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('mc-' + m).classList.add('selected');
  updateCountNote();
}

function refreshHomeBests() {
  ['quiz','wordle','match'].forEach(m => {
    const key = `best_${m}`;
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const el = document.getElementById('best-' + m);
    if (!el) return;
    const entries = Object.entries(all);
    if (!entries.length) { el.textContent = ''; return; }
    // Show best score across all question counts
    let best = entries.reduce((a, [k, v]) => v.score > a.score ? {score: v.score, max: v.max, n: k} : a, {score:-1,max:0,n:0});
    const bestLabel = m === 'match' ? best.n.replace('x', ' cặp × ') + ' vòng' : `${best.n} câu`;
    el.textContent = `🏆 ${best.score}/${best.max} (${bestLabel})`;
  });
}

/* ════ GAME START ════ */
function startGame() {
  if (!DATA) return;
  const n = Math.max(2, Math.min(parseInt(document.getElementById('count-inp').value) || 10, getModeMax()));
  document.getElementById('count-inp').value = n;

  qIdx = 0; score = 0; answered = false; qPenalty = 0; quizWrong = 0; wordleTries = 0; matchTries = 0;

  if (mode === 'quiz') {
    questions = shuffle([...DATA.quiz]).slice(0, n);
    maxScore = n * 100;
  } else if (mode === 'wordle') {
    questions = shuffle([...DATA.wordle]).slice(0, n);
    maxScore = n * 100;
  } else {
    // Match: n = pairs-per-round, rounds = floor(total/n)
    const rounds = getMatchRounds(n);
    const shuffled = shuffle([...DATA.match]);
    matchBatches = [];
    for (let r = 0; r < rounds; r++) {
      matchBatches.push(shuffled.slice(r * n, r * n + n));
    }
    questions = matchBatches; // each "question" is a round (array of pairs)
    maxScore = rounds * n * 100;
  }

  showScreen('game');
  const labels = {quiz:'QUIZ', wordle:'WORDLE', match:'TERM MATCH'};
  document.getElementById('mode-label').textContent = labels[mode];

  // Rules bar
  const rulesText = {
    quiz: '<strong>Quiz:</strong> Trắc nghiệm 4 đáp án · 1 gợi ý (−25đ) · Mỗi lần sai −25đ · Tối đa 100đ/câu',
    wordle: '<strong>Wordle:</strong> Đoán từ khoá · 🟩 đúng vị trí · 5 lần thử · Mỗi lần sai −20đ · Tối đa 100đ/câu',
    match: '<strong>Term Match:</strong> Chọn số tương ứng cho mỗi thuật ngữ · 4 lần thử · Mỗi lần sai −25đ/cặp · Tối đa 100đ/cặp'
  };
  document.getElementById('rules-bar').innerHTML = rulesText[mode];

  startTimer();
  renderQuestion();
}

/* ════ TIMER ════ */
function startTimer() {
  clearInterval(timerInterval);
  timerSeconds = 0;
  gameStartTime = Date.now();
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  document.getElementById('timer-disp').textContent = `${m}:${s.toString().padStart(2,'0')}`;
}

function stopTimer() {
  clearInterval(timerInterval);
}

/* ════ RENDER QUESTION ════ */
function renderQuestion() {
  const total = questions.length;
  document.getElementById('prog-bar').style.width = (qIdx / total * 100) + '%';
  document.getElementById('q-counter').textContent = `${qIdx + 1} / ${total}`;
  document.getElementById('score-live').textContent = score;
  const body = document.getElementById('game-body');
  body.innerHTML = '';
  answered = false; qPenalty = 0; quizWrong = 0; wordleTries = 0; matchTries = 0; matchSubmitted = false;
  if (mode === 'quiz') renderQuiz(body);
  else if (mode === 'wordle') renderWordle(body);
  else renderMatch(body, matchBatches[qIdx]);
}

function next() {
  qIdx++;
  if (qIdx >= questions.length) finishGame();
  else renderQuestion();
}

/* ════ QUIZ ════ */
function renderQuiz(body) {
  quizHintUsed = false; // Quan trọng: Reset trạng thái gợi ý cho câu mới
  
  const q = questions[qIdx];
  const L = ['A','B','C','D'];
  
  // Kiểm tra nếu điểm tiềm năng vẫn > 0 thì mới cho phép bấm gợi ý
  const canUseHint = calcEarned(qPenalty) > 0;

  let html = `<p class="q-label">Câu ${qIdx+1} / ${questions.length}</p>
    <p class="q-text">${q.q}</p>
    ${q.ctx ? `<p class="q-context">📋 ${q.ctx}</p>` : ''}
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.75rem;align-self:flex-start">
      <button class="btn btn-hint" id="hint-btn" onclick="showQuizHint()" ${!canUseHint ? 'disabled' : ''}>💡 Gợi ý (−25đ)</button>
    </div>
    <div id="hint-area" style="width:100%"></div>
    <div class="choices" id="choices">`;
    
  q.choices.forEach((c, i) => {
    html += `<button class="choice-btn" id="cb-${i}" onclick="checkQuiz(${i})">
      <span class="choice-letter">${L[i]}</span><span>${c}</span></button>`;
  });
  
  html += `</div>
    <div class="penalty-info" id="penalty-info">Tối đa +100 điểm nếu đúng ngay lần đầu không dùng gợi ý</div>
    <div id="feedback"></div>
    <div class="next-wrap" id="next-wrap" style="display:none">
      <button class="btn btn-dark" onclick="next()">${qIdx+1 < questions.length ? 'Câu tiếp →' : 'Xem kết quả →'}</button>
    </div>`;
    
  body.innerHTML = html;
}

let quizHintUsed = false; // Biến này nên được reset trong renderQuiz

function showQuizHint() {
  if (answered || quizHintUsed) return;
  
  quizHintUsed = true;
  // Tăng mức phạt thêm 25đ khi dùng gợi ý
  qPenalty = Math.min(80, qPenalty + 25); 
  
  document.getElementById('hint-btn').disabled = true;
  const q = questions[qIdx];
  
  document.getElementById('hint-area').innerHTML = `
    <div class="hint-box" style="margin-bottom:.75rem">
      <span class="hint-label">💡 Gợi ý</span>
      <span class="hint-text">${q.hint}</span>
    </div>`;
    
  // Cập nhật thông báo điểm tiềm năng cho người dùng thấy ngay
  updateQuizInfo();
}

function updateQuizInfo() {
  const earned = calcEarned(qPenalty);
  const el = document.getElementById('penalty-info');
  if (el) el.textContent = qPenalty > 0
    ? `Nếu đúng ngay bây giờ: +${earned} điểm (đã trừ ${qPenalty}đ)`
    : 'Tối đa +100 điểm nếu đúng ngay lần đầu không dùng gợi ý';
}

function checkQuiz(chosen) {
  if (answered) return;
  const q = questions[qIdx];
  const ok = chosen === q.answer;
  const btns = document.querySelectorAll('.choice-btn');
  btns[chosen].classList.add(ok ? 'correct' : 'wrong');
  btns[chosen].disabled = true;
  if (ok) {
    btns.forEach((b,i) => { b.disabled = true; if (i === q.answer) b.classList.add('correct'); });
    answered = true;
    const earned = calcEarned(qPenalty);
    score += earned;
    document.getElementById('score-live').textContent = score;
    const lbl = qPenalty > 0 ? `✅ Đúng! +${earned} điểm (trừ ${qPenalty}đ)` : '✅ Chính xác! +100 điểm';
    document.getElementById('feedback').innerHTML = `<div class="feedback-box correct-fb"><div class="feedback-title">${lbl}</div><div>${q.explain}</div></div>`;
    document.getElementById('next-wrap').style.display = 'flex';
  } else {
    quizWrong++;
    qPenalty = Math.min(80, qPenalty + 25);
    updateQuizInfo();
    setTimeout(() => {
      btns[chosen].classList.remove('wrong');
      btns[chosen].disabled = false;
    }, 550);
  }
}

/* ════ WORDLE ════ */
let wordleGuesses = [];
let wordleKbState = {};

function renderWordle(body) {
  const q = questions[qIdx];
  const target = q.target.toUpperCase();
  const len = target.length;
  const maxTries = 5;
  wordleGuesses = [];
  wordleKbState = {};

  let gridHtml = '<div class="wordle-grid" id="wgrid">';
  for (let r = 0; r < maxTries; r++) {
    gridHtml += '<div class="wordle-row" id="wrow-' + r + '">';
    for (let c = 0; c < len; c++) {
      gridHtml += `<div class="wordle-cell" id="wc-${r}-${c}"></div>`;
    }
    gridHtml += '</div>';
  }
  gridHtml += '</div>';

  const kbRows = [['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['ENTER','Z','X','C','V','B','N','M','⌫']];
  let kbHtml = '<div class="wordle-kb" id="wkb">';
  kbRows.forEach(row => {
    kbHtml += '<div class="wordle-kb-row">';
    row.forEach(k => {
      const w = (k === 'ENTER' || k === '⌫') ? ' wide' : '';
      kbHtml += `<button class="kb-key${w}" id="kb-${k}" onclick="wkbPress('${k}')">${k}</button>`;
    });
    kbHtml += '</div>';
  });
  kbHtml += '</div>';

  body.innerHTML = `
    <p class="q-label">Wordle · Câu ${qIdx+1} / ${questions.length}</p>
    <p class="q-text">${q.q}</p>
    <p class="wordle-meta" id="wordle-meta">Đoán từ khoá (${len} chữ cái) · ${maxTries} lần thử · Tối đa +100đ</p>
    <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:.5rem">
      ${gridHtml}
      <div class="wordle-inp-row">
        <input class="wordle-input" id="wordle-inp" maxlength="${len}" placeholder="${'_'.repeat(len)}" autocomplete="off" spellcheck="false"
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,'')" onkeydown="if(event.key==='Enter')submitWordle()">
        <button class="btn btn-primary" style="padding:.65rem 1rem;font-size:.82rem" onclick="submitWordle()">Enter</button>
      </div>
      ${kbHtml}
    </div>
    <div class="penalty-info" id="penalty-info">Tối đa +100đ nếu đúng lần đầu</div>
    <div id="feedback"></div>
    <div class="next-wrap" id="next-wrap" style="display:none">
      <button class="btn btn-dark" onclick="next()">${qIdx+1<questions.length?'Câu tiếp →':'Xem kết quả →'}</button>
    </div>`;
  document.getElementById('wordle-inp').focus();
}

function wkbPress(k) {
  if (answered) return;
  const inp = document.getElementById('wordle-inp');
  if (!inp) return;
  if (k === '⌫') {
    inp.value = inp.value.slice(0, -1);
  } else if (k === 'ENTER') {
    submitWordle();
  } else {
    const q = questions[qIdx];
    if (inp.value.length < q.target.length) inp.value += k;
  }
  inp.focus();
}

function submitWordle() {
  if (answered) return;
  const q = questions[qIdx];
  const target = q.target.toUpperCase();
  const len = target.length;
  const inp = document.getElementById('wordle-inp');
  const guess = (inp.value || '').toUpperCase().trim();
  if (guess.length !== len) {
    inp.classList.add('shake');
    setTimeout(() => inp.classList.remove('shake'), 300);
    return;
  }

  const row = wordleTries;
  const result = evalGuess(guess, target);
  // Fill grid row
  for (let c = 0; c < len; c++) {
    const cell = document.getElementById(`wc-${row}-${c}`);
    cell.textContent = guess[c];
    cell.className = 'wordle-cell ' + result[c];
    // Update kb
    const cur = wordleKbState[guess[c]];
    if (result[c] === 'correct' || (!cur)) wordleKbState[guess[c]] = result[c];
    else if (result[c] === 'present' && cur !== 'correct') wordleKbState[guess[c]] = result[c];
    else if (result[c] === 'absent' && !cur) wordleKbState[guess[c]] = result[c];
    const kb = document.getElementById('kb-' + guess[c]);
    if (kb) kb.className = 'kb-key ' + wordleKbState[guess[c]];
  }
  wordleTries++;
  inp.value = '';

  const won = result.every(r => r === 'correct');
  if (won) {
    answered = true;
    const penalty = wordlePenalty(wordleTries - 1);
    const earned = calcEarned(penalty);
    score += earned;
    document.getElementById('score-live').textContent = score;
    const lbl = penalty > 0 ? `✅ Đúng! +${earned} điểm (${wordleTries} lần thử, trừ ${penalty}đ)` : '✅ Đúng lần đầu! +100 điểm 🎉';
    document.getElementById('feedback').innerHTML = `<div class="feedback-box correct-fb"><div class="feedback-title">${lbl}</div><div>${q.explain}</div></div>`;
    document.getElementById('next-wrap').style.display = 'flex';
    document.getElementById('wordle-inp').disabled = true;
  } else if (wordleTries >= 5) {
    answered = true;
    document.getElementById('feedback').innerHTML = `<div class="feedback-box wrong-fb"><div class="feedback-title">❌ Hết lượt! Đáp án: <strong>${target}</strong></div><div>${q.explain}</div></div>`;
    document.getElementById('next-wrap').style.display = 'flex';
    document.getElementById('wordle-inp').disabled = true;
  } else {
    const penalty = wordlePenalty(wordleTries);
    const earned = calcEarned(penalty);
    document.getElementById('penalty-info').textContent = `Lần thử ${wordleTries+1}/5 · Nếu đúng ngay bây giờ: +${earned} điểm`;
  }
}

function evalGuess(guess, target) {
  const len = target.length;
  const res = Array(len).fill('absent');
  const tLeft = target.split('');
  // First pass: correct
  for (let i = 0; i < len; i++) {
    if (guess[i] === target[i]) { res[i] = 'correct'; tLeft[i] = null; }
  }
  // Second pass: present
  for (let i = 0; i < len; i++) {
    if (res[i] === 'correct') continue;
    const idx = tLeft.indexOf(guess[i]);
    if (idx !== -1) { res[i] = 'present'; tLeft[idx] = null; }
  }
  return res;
}

/* ════ MATCH ════ */
let matchPairs = [];
let matchWrongPerPair = {};
let matchBatches = []; // array of rounds; each round = array of {term,def}

function renderMatch(body, batch) {
  const pairsSource = (mode === 'match' && batch) ? batch : questions;
  matchPairs = pairsSource.map((p, i) => ({...p, idx: i}));
  const n = matchPairs.length;
  matchWrongPerPair = {};
  matchPairs.forEach((_, i) => matchWrongPerPair[i] = 0);

  // Shuffle defs for display
  const defOrder = shuffle(matchPairs.map((p, i) => i));

  let tableRows = '';
  matchPairs.forEach((p, i) => {
    const letter = String.fromCharCode(65 + i);
    const opts = Array.from({length: n + 1}, (_, j) => `<option value="${j}"${j===0?' selected':''}>${j===0?'—':j}</option>`).join('');
    tableRows += `<tr>
      <td><div class="mtd-term">${letter}. ${p.term}</div></td>
      <td class="mtd-lbl">→</td>
      <td><select class="mtd-sel" id="msel-${i}">${opts}</select></td>
      <td class="mtd-lbl">·</td>
    </tr>`;
  });

  let defList = '';
  defOrder.forEach((realIdx, pos) => {
    defList += `<p style="font-size:.8rem;line-height:1.55;padding:.3rem 0;border-bottom:1px solid var(--soft)"><span class="mtd-num">${pos+1}.</span>${matchPairs[realIdx].def}</p>`;
  });
  // Store mapping: display position → real index
  window._matchDefMap = defOrder; // defOrder[displayPos] = realPairIdx

  body.innerHTML = `
    <p class="q-label">Term Match · Vòng ${qIdx+1}/${questions.length} · ${n} cặp</p>
    <p class="q-text">Ghép thuật ngữ với số thứ tự định nghĩa đúng</p>
    <p class="match-intro">👈 Chọn số (1–${n}) cho mỗi thuật ngữ · 0 = chưa chọn</p>
    <table class="match-table" id="mtable">${tableRows}</table>
    <div style="margin:.6rem 0;width:100%;background:rgba(0,0,0,.04);border-radius:8px;padding:.75rem .95rem">${defList}</div>
    <div class="match-bottom">
      <button class="btn btn-primary" id="match-submit-btn" onclick="submitMatch()">Kiểm tra ✓</button>
      <span class="match-tries" id="match-tries-info">Còn 4 lần thử</span>
    </div>
    <div id="feedback"></div>
    <div class="next-wrap" id="next-wrap" style="display:none">
      <button class="btn btn-dark" onclick="next()">${qIdx+1<questions.length?'Vòng tiếp →':'Xem kết quả →'}</button>
    </div>`;
}

function submitMatch() {
  if (matchSubmitted && matchTries >= 4) return;
  const n = matchPairs.length;
  const defMap = window._matchDefMap; // defMap[displayPos] = realPairIdx
  // Reverse: realPairIdx → displayPos+1
  const realToDisplay = {};
  defMap.forEach((realIdx, pos) => realToDisplay[realIdx] = pos + 1);

  let allCorrect = true;
  let anyWrong = false;
  let correctCount = 0;

  matchPairs.forEach((p, i) => {
    const sel = document.getElementById(`msel-${i}`);
    const chosen = parseInt(sel.value);
    const correct = realToDisplay[i]; // correct display number
    if (chosen === correct) {
      sel.className = 'mtd-sel c';
      sel.disabled = true;
      correctCount++;
    } else {
      sel.className = 'mtd-sel w';
      allCorrect = false;
      anyWrong = true;
      matchWrongPerPair[i]++;
    }
  });

  matchTries++;

  if (allCorrect) {
    matchSubmitted = true;
    answered = true;
    // Score: each pair earns calcEarned(matchPenaltyForPair(wrongCount))
    let totalEarned = 0;
    matchPairs.forEach((_, i) => totalEarned += calcEarned(matchPenaltyForPair(matchWrongPerPair[i])));
    score += totalEarned;
    document.getElementById('score-live').textContent = score;
    document.getElementById('feedback').innerHTML = `<div class="feedback-box correct-fb"><div class="feedback-title">✅ Tất cả đúng! +${totalEarned} điểm</div></div>`;
    document.getElementById('match-submit-btn').disabled = true;
    document.getElementById('next-wrap').style.display = 'flex';
  } else if (matchTries >= 4) {
    matchSubmitted = true;
    answered = true;
    // Reveal answers
    const defMap = window._matchDefMap;
    const realToDisplay = {};
    defMap.forEach((realIdx, pos) => realToDisplay[realIdx] = pos + 1);
    matchPairs.forEach((p, i) => {
      const sel = document.getElementById(`msel-${i}`);
      if (!sel.disabled) {
        sel.value = realToDisplay[i];
        sel.className = 'mtd-sel c';
        sel.disabled = true;
      }
    });
    let totalEarned = 0;
    matchPairs.forEach((_, i) => totalEarned += calcEarned(matchPenaltyForPair(matchWrongPerPair[i])));
    score += totalEarned;
    document.getElementById('score-live').textContent = score;
    document.getElementById('feedback').innerHTML = `<div class="feedback-box wrong-fb"><div class="feedback-title">Hết lượt thử. Đáp án đã hiển thị. +${totalEarned} điểm cho các cặp đúng.</div></div>`;
    document.getElementById('match-submit-btn').disabled = true;
    document.getElementById('next-wrap').style.display = 'flex';
  } else {
    const remaining = 4 - matchTries;
    document.getElementById('match-tries-info').textContent = `Còn ${remaining} lần thử · Mỗi cặp sai thêm −25đ`;
    // Reset wrong cells after a moment
    setTimeout(() => {
      matchPairs.forEach((_, i) => {
        const sel = document.getElementById(`msel-${i}`);
        if (sel && !sel.disabled) sel.className = 'mtd-sel';
      });
    }, 700);
  }
}

/* ════ FINISH ════ */
function finishGame() {
stopTimer();
    const elapsed = timerSeconds;
    showScreen('result');

    // 1. Tính toán số liệu
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    
    // 2. Xác định lời nhận xét (Grade)
    let gradeText = "";
    let gradeClass = "";
    if (pct >= 90) { gradeText = "Xuất sắc!"; gradeClass = "excellent"; }
    else if (pct >= 75) { gradeText = "Tốt!"; gradeClass = "good"; }
    else if (pct >= 50) { gradeText = "Khá"; gradeClass = "fair"; }
    else { gradeText = "Cần ôn thêm"; gradeClass = "need-study"; }

    // 3. Hiển thị lên giao diện
    document.getElementById('result-title').textContent = gradeText;
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-max').textContent = `/${maxScore}`;
    document.getElementById('result-grade').textContent = `${gradeText} · ${pct}%`;
    
    // Định dạng thời gian MM:SS
    const timeStr = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
    document.getElementById('result-time').textContent = `Thời gian: ${timeStr}`;

    // 4. Hiệu ứng vòng tròn (SVG Circle)
    const circle = document.getElementById('ring-fill');
    const r = 48; // Bán kính
    const circumference = 2 * Math.PI * r;
    circle.style.strokeDasharray = circumference;
    
    // Hiệu ứng chạy vòng tròn sau 100ms
    setTimeout(() => {
        const offset = circumference - (pct / 100) * circumference;
        circle.style.strokeDashoffset = offset;
    }, 100);

    // 5. Hiển thị bảng chi tiết (Breakdown)
    const n = questions.length;
    const modeName = mode.toUpperCase();
    
    const breakdownHtml = `
        <div class="rb-row"><span class="rb-label">Mode</span><span class="rb-val">${modeName}</span></div>
        <div class="rb-row"><span class="rb-label">Số câu</span><span class="rb-val">${n} câu</span></div>
        <div class="rb-row"><span class="rb-label">Điểm</span><span class="rb-val">${score} / ${maxScore}</span></div>
        <div class="rb-row"><span class="rb-label">Tỉ lệ</span><span class="rb-val">${pct}%</span></div>
        <div class="rb-row"><span class="rb-label">Thời gian</span><span class="rb-val">${timeStr}</span></div>
    `;
    document.getElementById('result-breakdown').innerHTML = breakdownHtml;

  // Save & check best
  const key = `best_${mode}`;
  const countKey = mode === 'match' ? `${matchPairsPerRound}x${n}` : `${n}`;
  const all = JSON.parse(localStorage.getItem(key) || '{}');
  const prev = all[countKey];
  let isNewBest = false;
  if (!prev || score > prev.score || (score === prev.score && elapsed < prev.time)) {
    all[countKey] = {score, max: maxScore, time: elapsed, pct};
    localStorage.setItem(key, JSON.stringify(all));
    isNewBest = true;
  }
  document.getElementById('new-best-banner').style.display = isNewBest ? 'block' : 'none';
  refreshHomeBests();
}

/* ════ ACHIEVEMENT ════ */
function openAch() {
  prevScreen = document.querySelector('.screen.active')?.id || 'home';
  showScreen('achievement');
  renderAch();
}

function closeAch() {
  showScreen(prevScreen);function renderQuiz(body) {
  const q = questions[qIdx];
  const L = ['A','B','C','D'];
  
  // Kiểm tra nếu điểm còn lại > 0 thì mới cho phép bấm gợi ý
  const canUseHint = calcEarned(qPenalty) > 0;

  let html = `<p class="q-label">Câu ${qIdx+1} / ${questions.length}</p>
    <p class="q-text">${q.q}</p>
    ${q.ctx ? `<p class="q-context">📋 ${q.ctx}</p>` : ''}
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.75rem;align-self:flex-start">
      <button class="btn btn-hint" id="hint-btn" 
        onclick="showQuizHint()" 
        ${!canUseHint ? 'disabled' : ''}>💡 Gợi ý (−25đ)</button>
    </div>
    <div id="hint-area" style="width:100%"></div>
    <div class="choices" id="choices">`;
  
  // ... (giữ nguyên phần render choices)
}
}

function renderAch() {
  const modes = [
    {id:'quiz', icon:'🧠', name:'Quiz'},
    {id:'wordle', icon:'🟩', name:'Wordle'},
    {id:'match', icon:'🔗', name:'Term Match'},
  ];
  let html = '';
  modes.forEach(m => {
    const key = `best_${m.id}`;
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    html += `<div class="ach-card">
      <div class="ach-cat">Mode</div>
      <div class="ach-icon">${m.icon}</div>
      <div class="ach-name">${m.name}</div>`;
    if (!Object.keys(all).length) {
      html += `<div class="ach-stat"><span class="ach-stat-lbl">Chưa có dữ liệu</span><span class="ach-stat-val empty">—</span></div>`;
    } else {
      const entries = Object.entries(all).sort((a,b) => parseInt(b[0]) - parseInt(a[0]));
      entries.forEach(([n, v]) => {
        const t = v.time ? `${Math.floor(v.time/60)}:${(v.time%60).toString().padStart(2,'0')}` : '—';
        html += `<div class="ach-stat"><span class="ach-stat-lbl">${n} câu · Best score</span><span class="ach-stat-val">${v.score}/${v.max}</span></div>
          <div class="ach-stat"><span class="ach-stat-lbl">${n} câu · Best time</span><span class="ach-stat-val">${t}</span></div>`;
      });
    }
    html += `</div>`;
  });
  document.getElementById('ach-body').innerHTML = html || '<div class="ach-empty">Chưa có dữ liệu. Hãy chơi một ván!</div>';
}

/* ════ GLOSSARY ════ */
function openGlossary() {
  prevScreen = 'home';
  showScreen('glossary');
  document.getElementById('glos-search').value = '';
  glosActiveFilter = 'all';
  buildGlosFilters();
  renderGlos();
}

function buildGlosFilters() {
  const wrap = document.getElementById('glos-frow');
  let html = `<div class="fchip active" id="fc-all" onclick="setGlosFilter('all')">Tất cả</div>`;
  DATA.glossaryCats.forEach(c => {
    html += `<div class="fchip" id="fc-${c.id}" onclick="setGlosFilter('${c.id}')">${c.label}</div>`;
  });
  wrap.innerHTML = html;
}

function setGlosFilter(id) {
  glosActiveFilter = id;
  document.querySelectorAll('.fchip').forEach(c => c.classList.remove('active'));
  document.getElementById('fc-' + id).classList.add('active');
  renderGlos();
}

function renderGlos() {
  const q = (document.getElementById('glos-search').value || '').toLowerCase().trim();
  const items = DATA.glossary.filter(g => {
    const mc = glosActiveFilter === 'all' || g.cat === glosActiveFilter;
    const mq = !q || g.en.toLowerCase().includes(q) || g.vi.toLowerCase().includes(q) || (g.defVi||'').toLowerCase().includes(q) || (g.defEn||'').toLowerCase().includes(q);
    return mc && mq;
  });
  document.getElementById('glos-count').textContent = `Hiển thị ${items.length} / ${DATA.glossary.length} thuật ngữ`;
  const body = document.getElementById('glos-body');
  if (!items.length) { body.innerHTML = '<div class="glos-empty">🔍 Không tìm thấy thuật ngữ phù hợp</div>'; return; }

  let html = '';
  if (glosActiveFilter === 'all') {
    DATA.glossaryCats.forEach(cat => {
      const catItems = items.filter(g => g.cat === cat.id);
      if (!catItems.length) return;
      html += `<div class="glos-slabel">${cat.label}</div>`;
      catItems.forEach(g => html += buildGlosCard(g));
    });
  } else {
    items.forEach(g => html += buildGlosCard(g));
  }
  body.innerHTML = html;
}

function buildGlosCard(g) {
  const cat = DATA.glossaryCats.find(c => c.id === g.cat) || {color:'#888'};
  const tags = (g.tags||[]).map(t => `<span class="glos-tag" style="background:${cat.color}20;color:${cat.color}">${t}</span>`).join('');
  return `<div class="glos-card" onclick="this.classList.toggle('open')">
    <div class="glos-ch">
      <div class="glos-dot" style="background:${cat.color}"></div>
      <div class="glos-terms"><div class="glos-en">${g.en}</div><div class="glos-vi">${g.vi}</div></div>
      <span class="glos-chev">▼</span>
    </div>
    <div class="glos-cb">
      <div class="glos-den">${g.defEn}</div>
      <div class="glos-dvi">${g.defVi}</div>
      ${g.example ? `<div class="glos-ex"><span class="glos-exlbl">Ví dụ thực tế</span>${g.example}</div>` : ''}
      <div>${tags}</div>
    </div>
  </div>`;
}

/* ════ UTILS ════ */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) { el.classList.add('active'); el.style.display = 'flex'; }
  document.querySelectorAll('.screen:not(.active)').forEach(s => s.style.display = 'none');
}

function goHome() {
  stopTimer();
  closeModal('exit-modal');
  showScreen('home');
  refreshHomeBests();
}

function confirmExit() {
  document.getElementById('exit-modal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/* ════ FALLBACK DATA (empty – requires data.json) ════ */
const FALLBACK_DATA = {"quiz":[],"wordle":[],"match":[],"glossaryCats":[],"glossary":[]};

/* ════ BOOT ════ */
window.addEventListener('DOMContentLoaded', loadData);