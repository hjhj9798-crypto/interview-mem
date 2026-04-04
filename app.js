(function () {
  "use strict";

  const STORAGE_KEY = "interviewMemEntries_v1";

  /** 등록·연습 필터용 고정 태그 (자유 입력 대신 선택) */
  const TAG_OPTIONS = [
    "Essential",
    "Modelling",
    "Pipeline",
    "Troubleshooting",
    "add",
    "portfolio",
    "strength",
    "teamwork",
    "마지막 질문",
    "인사",
  ];

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
    const answerKrRaw = e.answerKr != null ? String(e.answerKr) : e.answer_kr != null ? String(e.answer_kr) : "";
    return {
      id: e.id || uid(),
      tag: String(e.tag || "").trim(),
      question: String(e.question || "").trim(),
      keywords,
      answer: String(e.answer || "").trim(),
      answerKr: answerKrRaw,
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

  /** Enter로 나눈 줄을 그대로 유지(빈 줄 포함). 영·한 줄 번호를 맞추기 위해 비어 있는 줄도 인덱스를 차지합니다. */
  function splitAnswerLines(answer) {
    return String(answer || "")
      .split(/\r?\n/)
      .map((s) => s.trim());
  }

  /**
   * 한국어 줄을 영어 줄 인덱스에 1:1로 맞춤(빈 줄 포함). 부족하면 빈 칸, 넘치면 잘림.
   * @returns {{ aligned: string[], padded: boolean, truncated: boolean }}
   */
  function alignKrToEnLines(krText, enLineCount) {
    const rows = String(krText || "")
      .split(/\r?\n/)
      .map((s) => s.trim());
    const truncated = rows.length > enLineCount;
    const aligned = [];
    for (let i = 0; i < enLineCount; i++) {
      aligned.push(i < rows.length ? rows[i] : "");
    }
    const padded = rows.length < enLineCount;
    return { aligned, padded, truncated };
  }

  function entriesMatchTag(entryTag, filterVal) {
    const a = String(entryTag || "").trim();
    const b = String(filterVal || "").trim();
    if (!b) return true;
    if (!a) return false;
    return a.toLowerCase() === b.toLowerCase();
  }

  /** 연습·목록 필터용: 고정 태그 + 데이터에만 있는 문자열 */
  function allTagsForFilters() {
    const set = new Set(TAG_OPTIONS);
    entries.forEach((e) => {
      const t = String(e.tag || "").trim();
      if (t) set.add(t);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function populateFormTagSelect(preserveValue) {
    const sel = els.fieldTag;
    const prev = preserveValue != null ? preserveValue : sel.value;
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "태그 없음";
    sel.appendChild(none);
    TAG_OPTIONS.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
    const ok = [...sel.options].some((o) => o.value === prev);
    if (ok) sel.value = prev;
    else sel.value = "";
  }

  /** 빈칸 퀴즈: 띄어쓰기 기준 토큰 */
  let blankQuizWords = [];
  /** @type {Set<number>} */
  let blankQuizBlankSet = new Set();
  let blankQuizAnswerLines = [];
  let blankLineIdx = 0;
  let blankLineChecked = false;
  let lastBlankEntryId = "";
  let blankHintVisible = false;

  function getEntryKr(entry) {
    if (!entry) return "";
    if (entry.answerKr != null && String(entry.answerKr).length) return String(entry.answerKr);
    if (entry.answer_kr != null && String(entry.answer_kr).length) return String(entry.answer_kr);
    return "";
  }

  function tokenizeWords(answer) {
    const raw = String(answer || "")
      .replace(/\r?\n/g, " ")
      .trim();
    let w = raw.split(/\s+/).filter(Boolean);
    if (w.length > 0) return w;
    const lines = splitAnswerLines(answer).filter(Boolean);
    return lines.length > 0 ? lines : [];
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

  /** 빈칸 퀴즈: 띄어쓰기·구두점 무시하고 비교 */
  function blankMatchLenient(user, expected) {
    function normalize(s) {
      return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[.,!?;:·…'"()[\]{}—–\-]/g, "");
    }
    return normalize(user) === normalize(expected);
  }

  /** 힌트: 앞쪽 약 1/3 스펠링 + … (길이는 드러내지 않음) */
  function hintFirstLetters(word) {
    const w = String(word || "");
    const n = w.length;
    if (n === 0) return "";
    const showLen = Math.max(1, Math.ceil(n / 3));
    const prefix = w.slice(0, Math.min(showLen, n));
    return n > showLen ? prefix + "…" : prefix;
  }

  function updateBlankHintButton() {
    if (els.btnHintBlank) {
      els.btnHintBlank.textContent = blankHintVisible ? "힌트 숨기기" : "힌트 보기";
    }
  }

  function applyBlankHints() {
    els.blankWordsWrap.querySelectorAll("input.blank-input").forEach((inp) => {
      const i = Number(inp.dataset.index);
      const w = blankQuizWords[i];
      if (blankHintVisible) {
        inp.placeholder = hintFirstLetters(w);
      } else {
        inp.placeholder = "…";
      }
    });
  }

  function renderBlankInputs(words, blankSet) {
    els.blankWordsWrap.innerHTML = "";
    words.forEach((w, i) => {
      if (i > 0) {
        els.blankWordsWrap.appendChild(document.createTextNode(" "));
      }
      if (blankSet.has(i)) {
        const cluster = document.createElement("span");
        cluster.className = "blank-input-cluster";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "blank-input";
        inp.dataset.index = String(i);
        inp.setAttribute("autocomplete", "off");
        inp.setAttribute("spellcheck", "true");
        inp.placeholder = blankHintVisible ? hintFirstLetters(w) : "…";
        cluster.appendChild(inp);
        const reveal = document.createElement("span");
        reveal.className = "blank-reveal";
        reveal.hidden = true;
        cluster.appendChild(reveal);
        els.blankWordsWrap.appendChild(cluster);
      } else {
        const span = document.createElement("span");
        span.className = "blank-visible-word";
        span.textContent = w;
        els.blankWordsWrap.appendChild(span);
      }
    });
    if (blankHintVisible) applyBlankHints();
  }

  function setupBlankQuizByLine(entry) {
    blankQuizAnswerLines = splitAnswerLines(entry.answer);
    if (blankQuizAnswerLines.length === 0) {
      const t = String(entry.answer || "").trim();
      blankQuizAnswerLines = t ? [t] : [""];
    }
    if (blankLineIdx >= blankQuizAnswerLines.length) {
      blankLineIdx = Math.max(0, blankQuizAnswerLines.length - 1);
    }
    renderCurrentBlankLine(entry);
  }

  function renderCurrentBlankLine(entry) {
    blankLineChecked = false;
    blankHintVisible = false;
    updateBlankHintButton();
    if (els.blankLineRevealBox) els.blankLineRevealBox.classList.add("hidden");
    if (els.btnHintBlank) els.btnHintBlank.disabled = false;

    const totalLines = blankQuizAnswerLines.length;
    const lineText = String(blankQuizAnswerLines[blankLineIdx] || "");
    const words = tokenizeWords(lineText);

    els.blankWordsWrap.innerHTML = "";
    els.btnCheckBlank.disabled = false;
    els.btnShuffleBlank.disabled = false;

    if (words.length === 0) {
      const p = document.createElement("p");
      p.className = "blank-line-skip";
      p.textContent =
        "이 줄에 빈칸으로 나눌 단어가 없습니다. 「다음 줄」로 넘어가거나 모범 답변에 띄어쓰기를 넣어 주세요.";
      els.blankWordsWrap.appendChild(p);
      blankQuizWords = [];
      blankQuizBlankSet = new Set();
      if (els.btnHintBlank) els.btnHintBlank.disabled = true;
    } else {
      blankQuizWords = words;
      blankQuizBlankSet = new Set(pickBlankIndices(words.length));
      renderBlankInputs(words, blankQuizBlankSet);
    }

    const nw = words.length;
    const nb = blankQuizBlankSet.size;
    els.blankProgressMeta.textContent = `줄 ${blankLineIdx + 1} / ${totalLines} · 이번 줄 빈칸 ${nb}개 · 단어 ${nw}개`;
    els.blankFeedback.textContent = "";
    els.blankFeedback.classList.add("hidden");
    els.practiceAnswerBlank.textContent = entry.answer;

    const krRaw = getEntryKr(entry).trim();
    const { aligned: krAligned } = alignKrToEnLines(getEntryKr(entry), totalLines);
    const hasKrBlank =
      krRaw.length > 0 && krAligned.some((s) => String(s).trim().length > 0);
    if (els.blankKrPanel && els.blankKrText) {
      if (hasKrBlank) {
        els.blankKrPanel.classList.remove("hidden");
        const k = String(krAligned[blankLineIdx] || "").trim();
        els.blankKrText.textContent = k || "— (이 줄 한국어 생략)";
      } else {
        els.blankKrPanel.classList.add("hidden");
      }
    }

    const isLast = blankLineIdx >= totalLines - 1;
    if (isLast && nw === 0) {
      blankLineChecked = true;
      els.answerPanelBlank.classList.remove("hidden");
      els.reviewRowBlank.classList.remove("hidden");
      els.btnCheckBlank.disabled = true;
      els.btnShuffleBlank.disabled = true;
      if (els.btnHintBlank) els.btnHintBlank.disabled = true;
      els.btnNextBlankLine.classList.add("hidden");
    } else {
      els.answerPanelBlank.classList.add("hidden");
      els.reviewRowBlank.classList.add("hidden");
      if (!isLast) els.btnNextBlankLine.classList.remove("hidden");
      else els.btnNextBlankLine.classList.add("hidden");
    }
    updateBlankLineNav();
  }

  function updateBlankLineNav() {
    const totalLines = blankQuizAnswerLines.length;
    if (totalLines === 0) return;
    const lineText = String(blankQuizAnswerLines[blankLineIdx] || "");
    const words = tokenizeWords(lineText);
    const isLast = blankLineIdx >= totalLines - 1;
    els.btnPrevBlankLine.disabled = blankLineIdx <= 0;
    if (isLast) {
      els.btnNextBlankLine.classList.add("hidden");
      return;
    }
    els.btnNextBlankLine.classList.remove("hidden");
    const canNext = words.length === 0 || blankLineChecked;
    els.btnNextBlankLine.disabled = !canNext;
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
    manageFilterTag: document.getElementById("manageFilterTag"),
    entryCountNote: document.getElementById("entryCountNote"),
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
    lineKrEmptyHint: document.getElementById("lineKrEmptyHint"),
    lineKrAlignNote: document.getElementById("lineKrAlignNote"),
    lineInstructionLine: document.getElementById("lineInstructionLine"),
    lineAttemptLabel: document.getElementById("lineAttemptLabel"),
    lineEnLabel: document.getElementById("lineEnLabel"),
    practiceBlockBlank: document.getElementById("practiceBlockBlank"),
    blankWordsWrap: document.getElementById("blankWordsWrap"),
    blankFeedback: document.getElementById("blankFeedback"),
    blankProgressMeta: document.getElementById("blankProgressMeta"),
    btnCheckBlank: document.getElementById("btnCheckBlank"),
    btnShuffleBlank: document.getElementById("btnShuffleBlank"),
    btnPrevBlankLine: document.getElementById("btnPrevBlankLine"),
    btnNextBlankLine: document.getElementById("btnNextBlankLine"),
    btnHintBlank: document.getElementById("btnHintBlank"),
    blankLineRevealBox: document.getElementById("blankLineRevealBox"),
    blankLineRevealText: document.getElementById("blankLineRevealText"),
    blankKrPanel: document.getElementById("blankKrPanel"),
    blankKrText: document.getElementById("blankKrText"),
    answerPanelBlank: document.getElementById("answerPanelBlank"),
    practiceAnswerBlank: document.getElementById("practiceAnswerBlank"),
    reviewRowBlank: document.getElementById("reviewRowBlank"),
    btnCopyAnswerBlank: document.getElementById("btnCopyAnswerBlank"),
  };

  function getFilteredEntries() {
    const tag = els.filterTag.value.trim();
    if (!tag) return entries.slice();
    return entries.filter((e) => entriesMatchTag(e.tag, tag));
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
    const answerTrim = String(entry.answer || "").trim();
    const mode = els.practiceMode.value;
    const wantByline = mode === "byline";
    const useByline = wantByline && lines.length >= 2;
    const wantBlank = mode === "blank";
    const useBlank = wantBlank && answerTrim.length > 0;

    const keywordsBlock = els.practiceKeywords.closest(".keywords-block");
    if (keywordsBlock) keywordsBlock.classList.toggle("hidden", useBlank);

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
      if (lastBlankEntryId !== entry.id) {
        blankLineIdx = 0;
        blankLineChecked = false;
        lastBlankEntryId = entry.id;
      }
      els.practiceBlockFull.classList.add("hidden");
      els.practiceBlockLine.classList.add("hidden");
      els.practiceBlockBlank.classList.remove("hidden");
      setupBlankQuizByLine(entry);
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
    const krText = getEntryKr(entry).replace(/^\uFEFF/, "");
    const krRaw = krText.trim();
    const { aligned: krAligned, padded, truncated } = alignKrToEnLines(krText, total);
    const hasKr =
      total >= 2 &&
      krRaw.length > 0 &&
      krAligned.some((s) => String(s).trim().length > 0);

    els.lineProgressText.textContent = `줄 ${lineIdx + 1} / ${total}`;
    els.lineRevealedText.textContent = cur;

    els.lineKrPanel.classList.toggle("hidden", !hasKr);
    if (els.lineKrEmptyHint) {
      els.lineKrEmptyHint.classList.toggle("hidden", hasKr || total < 2);
    }
    els.lineKrMismatch.classList.toggle("hidden", !truncated || !hasKr);
    if (hasKr && padded) {
      els.lineKrAlignNote.textContent =
        "한국어 줄이 영어보다 적습니다. 비어 있는 줄은 한국어 없이 영어로만 말하기·적기 연습하면 됩니다.";
      els.lineKrAlignNote.classList.remove("hidden");
    } else if (hasKr && truncated) {
      els.lineKrAlignNote.classList.add("hidden");
    } else {
      els.lineKrAlignNote.classList.add("hidden");
    }

    if (hasKr) {
      const krLine = krAligned[lineIdx] || "";
      els.lineKrText.textContent =
        krLine ||
        "— (이 줄은 한국어 생략 — 위·아래 맥락만 보고 영어로 말해보세요)";
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

  function restoreSelectValue(selectEl, previous) {
    const list = [...selectEl.options].map((o) => o.value);
    const match = list.find((v) => v.toLowerCase() === String(previous || "").toLowerCase());
    if (match) selectEl.value = match;
  }

  function updateTagFilterOptions() {
    const tags = allTagsForFilters();
    const curF = els.filterTag.value;
    const curM = els.manageFilterTag.value;
    els.filterTag.innerHTML = '<option value="">전체</option>';
    els.manageFilterTag.innerHTML = '<option value="">전체</option>';
    tags.forEach((t) => {
      const o1 = document.createElement("option");
      o1.value = t;
      o1.textContent = t;
      els.filterTag.appendChild(o1);
      const o2 = document.createElement("option");
      o2.value = t;
      o2.textContent = t;
      els.manageFilterTag.appendChild(o2);
    });
    restoreSelectValue(els.filterTag, curF);
    restoreSelectValue(els.manageFilterTag, curM);
  }

  function renderEntryList() {
    const filterTag = els.manageFilterTag.value.trim();
    let list = entries.slice();
    if (filterTag) list = list.filter((e) => entriesMatchTag(e.tag, filterTag));

    els.entryCount.textContent = String(list.length);
    if (els.entryCountNote) {
      if (filterTag && entries.length !== list.length) {
        els.entryCountNote.textContent = ` · 전체 ${entries.length}개`;
      } else {
        els.entryCountNote.textContent = "";
      }
    }

    els.entryList.innerHTML = "";
    if (list.length === 0) {
      const li = document.createElement("li");
      li.className = "entry-item";
      li.textContent = entries.length === 0 ? "항목이 없습니다." : "이 태그에 해당하는 항목이 없습니다.";
      li.style.color = "var(--muted)";
      els.entryList.appendChild(li);
      return;
    }

    const sorted = list.sort((a, b) => a.question.localeCompare(b.question));
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
    populateFormTagSelect();
    const t = String(e.tag || "").trim();
    if (t && !TAG_OPTIONS.includes(t)) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = `${t} (기존)`;
      els.fieldTag.appendChild(opt);
    }
    els.fieldTag.value = t || "";
    els.fieldQuestion.value = e.question;
    els.fieldKeywords.value = e.keywords.join(", ");
    els.fieldAnswer.value = e.answer;
    els.fieldAnswerKr.value = getEntryKr(e);
    els.formTitle.textContent = "항목 편집";
    els.btnCancelEdit.classList.remove("hidden");
    els.fieldQuestion.focus();
  }

  function cancelEdit() {
    els.editId.value = "";
    els.entryForm.reset();
    populateFormTagSelect();
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

  els.manageFilterTag.addEventListener("change", () => {
    renderEntryList();
  });

  els.practiceMode.addEventListener("change", () => {
    lineIdx = 0;
    lineRevealed = false;
    lastLineQuizEntryId = "";
    lastBlankEntryId = "";
    blankLineIdx = 0;
    blankLineChecked = false;
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
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    const inputs = els.blankWordsWrap.querySelectorAll("input.blank-input");
    let correct = 0;
    const totalInp = inputs.length;
    if (totalInp === 0) return;
    inputs.forEach((inp) => {
      const i = Number(inp.dataset.index);
      const expected = blankQuizWords[i];
      inp.classList.remove("blank-correct", "blank-wrong");
      const cluster = inp.closest(".blank-input-cluster");
      const revealEl = cluster && cluster.querySelector(".blank-reveal");
      if (revealEl) {
        revealEl.textContent = "정답: " + expected;
        revealEl.hidden = false;
      }
      if (blankMatchLenient(inp.value, expected)) {
        inp.classList.add("blank-correct");
        inp.removeAttribute("title");
        correct++;
      } else {
        inp.classList.add("blank-wrong");
        inp.removeAttribute("title");
      }
    });
    if (els.blankLineRevealBox && els.blankLineRevealText) {
      els.blankLineRevealText.textContent = String(blankQuizAnswerLines[blankLineIdx] || "");
      els.blankLineRevealBox.classList.remove("hidden");
    }
    blankLineChecked = true;
    const totalLines = blankQuizAnswerLines.length;
    const isLast = blankLineIdx >= totalLines - 1;
    els.blankFeedback.textContent = `빈칸 ${totalInp}개 중 ${correct}개 일치. 아래에 이번 줄·빈칸별 정답이 표시됩니다.`;
    els.blankFeedback.classList.remove("hidden");
    if (isLast && entry) {
      els.answerPanelBlank.classList.remove("hidden");
      els.reviewRowBlank.classList.remove("hidden");
      els.btnNextBlankLine.classList.add("hidden");
    } else {
      els.answerPanelBlank.classList.add("hidden");
      els.reviewRowBlank.classList.add("hidden");
      els.btnNextBlankLine.classList.remove("hidden");
      els.btnNextBlankLine.disabled = false;
    }
    updateBlankLineNav();
  });

  els.btnShuffleBlank.addEventListener("click", () => {
    const lineText = String(blankQuizAnswerLines[blankLineIdx] || "");
    const words = tokenizeWords(lineText);
    if (words.length === 0) return;
    blankHintVisible = false;
    updateBlankHintButton();
    if (els.blankLineRevealBox) els.blankLineRevealBox.classList.add("hidden");
    blankQuizWords = words;
    blankQuizBlankSet = new Set(pickBlankIndices(words.length));
    renderBlankInputs(words, blankQuizBlankSet);
    blankLineChecked = false;
    els.blankFeedback.classList.add("hidden");
    const totalLines = blankQuizAnswerLines.length;
    const nb = blankQuizBlankSet.size;
    const nw = words.length;
    els.blankProgressMeta.textContent = `줄 ${blankLineIdx + 1} / ${totalLines} · 이번 줄 빈칸 ${nb}개 · 단어 ${nw}개`;
    updateBlankLineNav();
  });

  els.btnHintBlank.addEventListener("click", () => {
    if (els.blankWordsWrap.querySelectorAll("input.blank-input").length === 0) return;
    blankHintVisible = !blankHintVisible;
    updateBlankHintButton();
    applyBlankHints();
  });

  els.btnNextBlankLine.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    if (blankLineIdx >= blankQuizAnswerLines.length - 1) return;
    blankLineIdx++;
    renderCurrentBlankLine(entry);
  });

  els.btnPrevBlankLine.addEventListener("click", () => {
    const id = practiceOrder[practiceIndex];
    const entry = entryById(id);
    if (!entry) return;
    if (blankLineIdx <= 0) return;
    blankLineIdx--;
    renderCurrentBlankLine(entry);
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
  populateFormTagSelect();
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
