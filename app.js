(function () {
  "use strict";

  const STORAGE_KEY = "interviewMemEntries_v1";

  /** @typedef {{ id: string, tag: string, question: string, keywords: string[], answer: string, answerKr?: string, reviews?: { ok: number, partial: number, miss: number } }} Entry */

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  }

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeEntry).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** @param {any} e */
  function normalizeEntry(e) {
    if (!e || typeof e !== "object") return null;
    const keywords = Array.isArray(e.keywords)
      ? e.keywords.map(String)
      : String(e.keywords || "")
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
    return {
      id: e.id || uid(),
      tag: String(e.tag || "").trim(),
      question: String(e.question || "").trim(),
      keywords,
      answer: String(e.answer || "").trim(),
      answerKr: e.answerKr != null ? String(e.answerKr) : "",
      reviews: e.reviews && typeof e.reviews === "object" ? e.reviews : { ok: 0, partial: 0, miss: 0 },
    };
  }

  /** @param {Entry[]} entries */
  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  let entries = loadEntries();
  let practiceIndex = 0;
  let practiceOrder = [];
  /** 순서/필터가 바뀌면 true로 두고, rebuildPracticeOrder에서만 갱신 */
  let orderDirty = true;
  /** 한 줄씩 모드: 현재 질문 내 줄 인덱스, 가림 여부 */
  let lineIdx = 0;
  let lineRevealed = false;
  let lastLineQuizEntryId = "";

  function splitAnswerLines(answer) {
    return String(answer || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 빈칸 퀴즈: 띄어쓰기 기준 토큰 */
  let blankQuizWords = [];
  /** @type {Set<number>} */
  let blankQuizBlankSet = new Set();

  function tokenizeWords(answer) {
    return String(answer || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function pickBlankIndices(n) {
    if (n <= 0) return [];
    if (n === 1) return [0];
    let k = Math.max(1, Math.round(n * 0.35));
    k = Math.min(k, n - 1);
    const shuffled = shuffle([...Array(n).keys()]);
    return shuffled.slice(0, k).sort((a, b) => a - b);
  }

  function wordMatch(user, expected) {
    return String(user || "").trim().toLowerCase() === String(expected || "").trim().toLowerCase();
  }

  function renderBlankInputs(words, blankSet) {
    els.blankWordsWrap.innerHTML = "";
    words.forEach((w, i) => {
      if (i > 0) {
        els.blankWordsWrap.appendChild(document.createTextNode(" "));
      }
      if (blankSet.has(i)) {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "blank-input";
        inp.dataset.index = String(i);
        inp.setAttribute("autocomplete", "off");
        inp.setAttribute("spellcheck", "true");
        inp.placeholder = "…";
        els.blankWordsWrap.appendChild(inp);
      } else {
        const span = document.createElement("span");
        span.className = "blank-visible-word";
        span.textContent = w;
        els.blankWordsWrap.appendChild(span);
      }
    });
  }

  function setupBlankQuiz(entry, words) {
    blankQuizWords = words;
    blankQuizBlankSet = new Set(pickBlankIndices(words.length));
    renderBlankInputs(words, blankQuizBlankSet);
    els.blankProgressMeta.textContent = `빈칸 ${blankQuizBlankSet.size}개 · 전체 ${words.length}단어`;
    els.blankFeedback.textContent = "";
    els.blankFeedback.classList.add("hidden");
    els.answerPanelBlank.classList.add("hidden");
    els.reviewRowBlank.classList.add("hidden");
    els.practiceAnswerBlank.textContent = entry.answer;
  }

  const els = {
    tabs: document.querySelectorAll(".tab"),
    panelPractice: document.getElementById("panel-practice"),
    panelManage: document.getElementById("panel-manage"),
    emptyPractice: document.getElementById("emptyPractice"),
    practiceBody: document.getElementById("practiceBody"),
    practiceQuestion: document.getElementById("practiceQuestion"),
    practiceKeywords: document.getElementById("practiceKeywords"),
    selfAttempt: document.getElementById("selfAttempt"),
    answerPanel: document.getElementById("answerPanel"),
    practiceAnswer: document.getElementById("practiceAnswer"),
    btnReveal: document.getElementById("btnReveal"),
    btnSkip: document.getElementById("btnSkip"),
    btnCopyAnswer: document.getElementById("btnCopyAnswer"),
    reviewRow: document.getElementById("reviewRow"),
    orderMode: document.getElementById("orderMode"),
    filterTag: document.getElementById("filterTag"),
    progressText: document.getElementById("progressText"),
    navFooter: document.getElementById("navFooter"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    entryForm: document.getElementById("entryForm"),
    formTitle: document.getElementById("formTitle"),
    editId: document.getElementById("editId"),
    fieldTag: document.getElementById("fieldTag"),
    fieldQuestion: document.getElementById("fieldQuestion"),
    fieldKeywords: document.getElementById("fieldKeywords"),
    fieldAnswer: document.getElementById("fieldAnswer"),
    fieldAnswerKr: document.getElementById("fieldAnswerKr"),
    btnCancelEdit: document.getElementById("btnCancelEdit"),
    entryList: document.getElementById("entryList"),
    entryCount: document.getElementById("entryCount"),
    btnExport: document.getElementById("btnExport"),
    importFile: document.getElementById("importFile"),
    practiceMode: document.getElementById("practiceMode"),
    practiceBlockFull: document.getElementById("practiceBlockFull"),
    practiceBlockLine: document.getElementById("practiceBlockLine"),
    bylineFallbackHint: document.getElementById("bylineFallbackHint"),
    lineProgressText: document.getElementById("lineProgressText"),
    lineMasked: document.getElementById("lineMasked"),
    lineRevealedText: document.getElementById("lineRevealedText"),
    selfAttemptLine: document.getElementById("selfAttemptLine"),
    btnRevealLine: document.getElementById("btnRevealLine"),
    btnPrevLine: document.getElementById("btnPrevLine"),
    btnNextLine: document.getElementById("btnNextLine"),
    answerPanelLine: document.getElementById("answerPanelLine"),
    practiceAnswerLine: document.getElementById("practiceAnswerLine"),
    reviewRowLine: document.getElementById("reviewRowLine"),
    btnCopyAnswerLine: document.getElementById("btnCopyAnswerLine"),
    lineKrPanel: document.getElementById("lineKrPanel"),
    lineKrText: document.getElementById("lineKrText"),
    lineKrMismatch: document.getElementById("lineKrMismatch"),
    lineInstructionLine: document.getElementById("lineInstructionLine"),
    lineAttemptLabel: document.getElementById("lineAttemptLabel"),
    lineEnLabel: document.getElementById("lineEnLabel"),
    practiceBlockBlank: document.getElementById("practiceBlockBlank"),
    blankWordsWrap: document.getElementById("blankWordsWrap"),
    blankFeedback: document.getElementById("blankFeedback"),
    blankProgressMeta: document.getElementById("blankProgressMeta"),
    btnCheckBlank: document.getElementById("btnCheckBlank"),
    btnShuffleBlank: document.getElementById("btnShuffleBlank"),
    answerPanelBlank: document.getElementById("answerPanelBlank"),
    practiceAnswerBlank: document.getElementById("practiceAnswerBlank"),
    reviewRowBlank: document.getElementById("reviewRowBlank"),
    btnCopyAnswerBlank: document.getElementById("btnCopyAnswerBlank"),
  };

  function getFilteredEntries() {
    const tag = els.filterTag.value.trim().toLowerCase();
    if (!tag) return entries.slice();
    return entries.filter((e) => (e.tag || "").toLowerCase() === tag);
  }

  function rebuildPracticeOrder() {
    const list = getFilteredEntries();
    if (els.orderMode.value === "random") {
      practiceOrder = shuffle(list.map((e) => e.id));
    } else {
      practiceOrder = list.map((e) => e.id);
    }
    if (practiceIndex >= practiceOrder.length) practiceIndex = Math.max(0, practiceOrder.length - 1);
    orderDirty = false;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function entryById(id) {
    return entries.find((e) => e.id === id);
  }

  function showPracticeCard() {
    const list = getFilteredEntries();
    if (list.length === 0) {
      practiceOrder = [];
      els.emptyPractice.classList.remove("hidden");
      els.practiceBody.classList.add("hidden");
      els.navFooter.classList.add("hidden");
      els.progressText.textContent = "";
      return;
    }

    if (orderDirty) rebuildPracticeOrder();

    els.emptyPractice.classList.add("hidden");
    els.practiceBody.classList.remove("hidden");
    els.navFooter.classList.remove("hidden");

    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) {
      practiceIndex = 0;
      showPracticeCard();
      return;
    }

    els.practiceQuestion.textContent = entry.question;
    els.practiceKeywords.innerHTML = "";
    entry.keywords.forEach((kw) => {
      const li = document.createElement("li");
      li.textContent = kw;
      els.practiceKeywords.appendChild(li);
    });

    const lines = splitAnswerLines(entry.answer);
    const words = tokenizeWords(entry.answer);
    const mode = els.practiceMode.value;
    const wantByline = mode === "byline";
    const useByline = wantByline && lines.length >= 2;
    const wantBlank = mode === "blank";
    const useBlank = wantBlank && words.length >= 1;

    if (lastLineQuizEntryId !== entry.id) {
      lineIdx = 0;
      lineRevealed = false;
      lastLineQuizEntryId = entry.id;
      els.selfAttemptLine.value = "";
    }

    els.bylineFallbackHint.classList.toggle("hidden", !wantByline || useByline);

    if (useByline) {
      els.practiceBlockFull.classList.add("hidden");
      els.practiceBlockLine.classList.remove("hidden");
      els.practiceBlockBlank.classList.add("hidden");
      els.practiceAnswerLine.textContent = entry.answer;
      updateLineQuizUI(entry, lines);
    } else if (useBlank) {
      els.practiceBlockFull.classList.add("hidden");
      els.practiceBlockLine.classList.add("hidden");
      els.practiceBlockBlank.classList.remove("hidden");
      setupBlankQuiz(entry, words);
    } else {
      els.practiceBlockFull.classList.remove("hidden");
      els.practiceBlockLine.classList.add("hidden");
      els.practiceBlockBlank.classList.add("hidden");
      els.selfAttempt.value = "";
      els.practiceAnswer.textContent = entry.answer;
      els.answerPanel.classList.add("hidden");
      els.reviewRow.classList.add("hidden");
      els.btnReveal.disabled = false;
    }

    els.progressText.textContent = `${practiceIndex + 1} / ${practiceOrder.length}`;
    els.btnPrev.disabled = practiceIndex <= 0;
    els.btnNext.textContent = practiceIndex >= practiceOrder.length - 1 ? "처음으로" : "다음 질문";
  }

  function updateLineQuizUI(entry, lines) {
    const total = lines.length;
    const cur = lines[lineIdx] || "";
    const krLines = splitAnswerLines(entry.answerKr || "");
    const krRaw = String(entry.answerKr || "").trim();
    const hasKr = krLines.length === lines.length && lines.length >= 2;
    const mismatchKr = krRaw.length > 0 && krLines.length !== lines.length;

    els.lineProgressText.textContent = `줄 ${lineIdx + 1} / ${total}`;
    els.lineRevealedText.textContent = cur;

    els.lineKrPanel.classList.toggle("hidden", !hasKr);
    els.lineKrMismatch.classList.toggle("hidden", !mismatchKr || hasKr);

    if (hasKr) {
      els.lineKrText.textContent = krLines[lineIdx] || "";
      els.lineInstructionLine.textContent =
        "한국어를 보고 영어로 말하거나, 아래에 영어로 적어보세요.";
      els.lineAttemptLabel.textContent = "영어로 번역해 적어보기 (선택)";
      els.lineEnLabel.textContent = "이번 줄 · 영어 (확인 전 숨김)";
      if (!lineRevealed) {
        els.lineMasked.textContent = "영어 문장은 숨김 — 「이 줄 확인」으로 공개";
      }
    } else {
      els.lineInstructionLine.textContent =
        "이 줄만 말로 연습한 뒤, 필요하면 아래에 적어보세요.";
      els.lineAttemptLabel.textContent = "이 줄에 해당하는 내용 (선택)";
      els.lineEnLabel.textContent = "이번 줄 · 영어";
      if (!lineRevealed) {
        els.lineMasked.textContent = "가려짐 — 「이 줄 확인」을 누르세요";
      }
    }

    if (lineRevealed) {
      els.lineMasked.classList.add("hidden");
      els.lineRevealedText.classList.remove("hidden");
      els.btnRevealLine.disabled = true;
    } else {
      els.lineMasked.classList.remove("hidden");
      els.lineRevealedText.classList.add("hidden");
      els.btnRevealLine.disabled = false;
    }

    els.btnPrevLine.disabled = lineIdx <= 0;

    const isLast = lineIdx >= total - 1;
    if (lineRevealed && isLast) {
      els.answerPanelLine.classList.remove("hidden");
      els.reviewRowLine.classList.remove("hidden");
      els.btnNextLine.classList.add("hidden");
    } else {
      els.answerPanelLine.classList.add("hidden");
      els.reviewRowLine.classList.add("hidden");
      els.btnNextLine.classList.remove("hidden");
      els.btnNextLine.disabled = !lineRevealed || isLast;
    }

    if (lineRevealed && !isLast) {
      els.btnNextLine.textContent = "다음 줄";
    } else if (lineRevealed && isLast) {
      els.btnNextLine.textContent = "다음 줄";
    }
  }

  function nextQuestion(wrap) {
    if (practiceOrder.length === 0) return;
    if (practiceIndex < practiceOrder.length - 1) {
      practiceIndex++;
    } else if (wrap) {
      practiceIndex = 0;
      if (els.orderMode.value === "random") orderDirty = true;
    }
    showPracticeCard();
  }

  function prevQuestion() {
    if (practiceIndex > 0) {
      practiceIndex--;
      showPracticeCard();
    }
  }

  function updateTagFilterOptions() {
    const tags = new Set();
    entries.forEach((e) => {
      if (e.tag) tags.add(e.tag.trim());
    });
    const current = els.filterTag.value;
    els.filterTag.innerHTML = '<option value="">전체</option>';
    [...tags].sort().forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.filterTag.appendChild(opt);
    });
    if ([...tags].includes(current)) els.filterTag.value = current;
  }

  function renderEntryList() {
    els.entryCount.textContent = String(entries.length);
    els.entryList.innerHTML = "";
    if (entries.length === 0) {
      const li = document.createElement("li");
      li.className = "entry-item";
      li.textContent = "항목이 없습니다.";
      li.style.color = "var(--muted)";
      els.entryList.appendChild(li);
      return;
    }

    const sorted = entries.slice().sort((a, b) => a.question.localeCompare(b.question));
    sorted.forEach((e) => {
      const li = document.createElement("li");
      li.className = "entry-item";
      const q = document.createElement("p");
      q.className = "entry-q";
      q.textContent = e.question;
      const meta = document.createElement("p");
      meta.className = "entry-meta";
      const r = e.reviews || { ok: 0, partial: 0, miss: 0 };
      const parts = [];
      if (e.tag) parts.push(`태그: ${e.tag}`);
      parts.push(`복습: OK ${r.ok} · 부분 ${r.partial} · 어려움 ${r.miss}`);
      meta.textContent = parts.join(" · ");
      const actions = document.createElement("div");
      actions.className = "entry-actions";
      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.textContent = "편집";
      btnEdit.addEventListener("click", () => startEdit(e.id));
      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.textContent = "삭제";
      btnDel.addEventListener("click", () => {
        if (confirm("이 항목을 삭제할까요?")) {
          entries = entries.filter((x) => x.id !== e.id);
          saveEntries(entries);
          updateTagFilterOptions();
          orderDirty = true;
          renderEntryList();
          showPracticeCard();
        }
      });
      actions.append(btnEdit, btnDel);
      li.append(q, meta, actions);
      els.entryList.appendChild(li);
    });
  }

  function startEdit(id) {
    const e = entryById(id);
    if (!e) return;
    els.editId.value = e.id;
    els.fieldTag.value = e.tag || "";
    els.fieldQuestion.value = e.question;
    els.fieldKeywords.value = e.keywords.join(", ");
    els.fieldAnswer.value = e.answer;
    els.fieldAnswerKr.value = e.answerKr != null ? e.answerKr : "";
    els.formTitle.textContent = "항목 편집";
    els.btnCancelEdit.classList.remove("hidden");
    els.fieldQuestion.focus();
  }

  function cancelEdit() {
    els.editId.value = "";
    els.entryForm.reset();
    els.formTitle.textContent = "새 항목 추가";
    els.btnCancelEdit.classList.add("hidden");
  }

  function recordReview(entryId, kind) {
    const e = entryById(entryId);
    if (!e) return;
    if (!e.reviews) e.reviews = { ok: 0, partial: 0, miss: 0 };
    if (kind === "ok") e.reviews.ok++;
    else if (kind === "partial") e.reviews.partial++;
    else if (kind === "miss") e.reviews.miss++;
    saveEntries(entries);
    renderEntryList();
  }

  // Tabs
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.getAttribute("data-tab");
      els.tabs.forEach((t) => {
        const active = t.getAttribute("data-tab") === name;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      els.panelPractice.classList.toggle("is-visible", name === "practice");
      els.panelPractice.classList.toggle("hidden", name !== "practice");
      els.panelManage.classList.toggle("is-visible", name === "manage");
      els.panelManage.classList.toggle("hidden", name !== "manage");
      if (name === "practice") showPracticeCard();
      if (name === "manage") renderEntryList();
    });
  });

  els.orderMode.addEventListener("change", () => {
    practiceIndex = 0;
    orderDirty = true;
    showPracticeCard();
  });

  els.filterTag.addEventListener("change", () => {
    practiceIndex = 0;
    orderDirty = true;
    showPracticeCard();
  });

  els.practiceMode.addEventListener("change", () => {
    lineIdx = 0;
    lineRevealed = false;
    lastLineQuizEntryId = "";
    showPracticeCard();
  });

  els.btnReveal.addEventListener("click", () => {
    els.answerPanel.classList.remove("hidden");
    els.reviewRow.classList.remove("hidden");
    els.btnReveal.disabled = true;
  });

  els.btnSkip.addEventListener("click", () => nextQuestion(true));

  els.btnCopyAnswer.addEventListener("click", async () => {
    const text = els.practiceAnswer.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      els.btnCopyAnswer.textContent = "복사됨";
      setTimeout(() => {
        els.btnCopyAnswer.textContent = "복사";
      }, 1500);
    } catch {
      els.btnCopyAnswer.textContent = "복사 실패";
    }
  });

  els.btnNext.addEventListener("click", () => nextQuestion(true));
  els.btnPrev.addEventListener("click", () => prevQuestion());

  els.reviewRow.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-review]");
    if (!btn) return;
    const kind = btn.getAttribute("data-review");
    const id = practiceOrder[practiceIndex];
    if (id && kind) recordReview(id, kind);
    nextQuestion(true);
  });

  els.btnRevealLine.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    const lines = splitAnswerLines(entry.answer);
    lineRevealed = true;
    updateLineQuizUI(entry, lines);
  });

  els.btnNextLine.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    const lines = splitAnswerLines(entry.answer);
    if (!lineRevealed || lineIdx >= lines.length - 1) return;
    lineIdx++;
    lineRevealed = false;
    els.selfAttemptLine.value = "";
    updateLineQuizUI(entry, lines);
  });

  els.btnPrevLine.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    const lines = splitAnswerLines(entry.answer);
    if (lineIdx <= 0) return;
    lineIdx--;
    lineRevealed = false;
    els.selfAttemptLine.value = "";
    updateLineQuizUI(entry, lines);
  });

  els.reviewRowLine.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-review-line]");
    if (!btn) return;
    const kind = btn.getAttribute("data-review-line");
    const id = practiceOrder[practiceIndex];
    if (id && kind) recordReview(id, kind);
    nextQuestion(true);
  });

  els.btnCopyAnswerLine.addEventListener("click", async () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    const text = entry ? entry.answer : "";
    try {
      await navigator.clipboard.writeText(text);
      els.btnCopyAnswerLine.textContent = "복사됨";
      setTimeout(() => {
        els.btnCopyAnswerLine.textContent = "복사";
      }, 1500);
    } catch {
      els.btnCopyAnswerLine.textContent = "복사 실패";
    }
  });

  els.btnCheckBlank.addEventListener("click", () => {
    const inputs = els.blankWordsWrap.querySelectorAll("input.blank-input");
    let correct = 0;
    const total = inputs.length;
    inputs.forEach((inp) => {
      const i = Number(inp.dataset.index);
      const expected = blankQuizWords[i];
      inp.classList.remove("blank-correct", "blank-wrong");
      if (wordMatch(inp.value, expected)) {
        inp.classList.add("blank-correct");
        inp.removeAttribute("title");
        correct++;
      } else {
        inp.classList.add("blank-wrong");
        inp.title = "정답: " + expected;
      }
    });
    els.blankFeedback.textContent =
      total > 0
        ? `빈칸 ${total}개 중 ${correct}개 일치. 틀린 칸은 입력란에 마우스를 올리면 정답 힌트가 보입니다.`
        : "";
    els.blankFeedback.classList.remove("hidden");
    els.answerPanelBlank.classList.remove("hidden");
    els.reviewRowBlank.classList.remove("hidden");
  });

  els.btnShuffleBlank.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    const w = tokenizeWords(entry.answer);
    setupBlankQuiz(entry, w);
  });

  els.reviewRowBlank.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-review-blank]");
    if (!btn) return;
    const kind = btn.getAttribute("data-review-blank");
    const id = practiceOrder[practiceIndex];
    if (id && kind) recordReview(id, kind);
    nextQuestion(true);
  });

  els.btnCopyAnswerBlank.addEventListener("click", async () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    const text = entry ? entry.answer : "";
    try {
      await navigator.clipboard.writeText(text);
      els.btnCopyAnswerBlank.textContent = "복사됨";
      setTimeout(() => {
        els.btnCopyAnswerBlank.textContent = "복사";
      }, 1500);
    } catch {
      els.btnCopyAnswerBlank.textContent = "복사 실패";
    }
  });

  els.entryForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const tag = els.fieldTag.value.trim();
    const question = els.fieldQuestion.value.trim();
    const keywords = els.fieldKeywords.value
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const answer = els.fieldAnswer.value.trim();
    const answerKr = els.fieldAnswerKr.value;
    if (!question || keywords.length === 0 || !answer) {
      alert("질문, 키워드, 모범 답변을 모두 입력해 주세요.");
      return;
    }

    const editId = els.editId.value;
    if (editId) {
      const idx = entries.findIndex((e) => e.id === editId);
      if (idx >= 0) {
        entries[idx] = {
          ...entries[idx],
          tag,
          question,
          keywords,
          answer,
          answerKr,
        };
      }
    } else {
      entries.push({
        id: uid(),
        tag,
        question,
        keywords,
        answer,
        answerKr,
        reviews: { ok: 0, partial: 0, miss: 0 },
      });
    }
    saveEntries(entries);
    updateTagFilterOptions();
    orderDirty = true;
    renderEntryList();
    cancelEdit();
    showPracticeCard();
  });

  els.btnCancelEdit.addEventListener("click", cancelEdit);

  els.btnExport.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `interview-mem-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const arr = Array.isArray(data) ? data : data.entries;
        if (!Array.isArray(arr)) throw new Error("invalid");
        const merged = arr.map(normalizeEntry).filter(Boolean);
        if (merged.length === 0) {
          alert("가져올 수 있는 항목이 없습니다.");
          return;
        }
        if (
          !confirm(
            `파일에서 ${merged.length}개 항목을 읽었습니다. 기존 ${entries.length}개에 추가할까요? (취소하면 가져오기만 중단)`
          )
        ) {
          els.importFile.value = "";
          return;
        }
        entries = entries.concat(merged);
        saveEntries(entries);
        updateTagFilterOptions();
        orderDirty = true;
        renderEntryList();
        showPracticeCard();
      } catch {
        alert("JSON 파일 형식이 올바르지 않습니다.");
      }
      els.importFile.value = "";
    };
    reader.readAsText(file);
  });

  // Init
  orderDirty = true;
  updateTagFilterOptions();
  showPracticeCard();

  if ("serviceWorker" in navigator) {
    const h = location.hostname;
    const secureContext =
      location.protocol === "https:" ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      (h.endsWith(".localhost") && location.protocol === "http:");
    if (secureContext) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
})();
