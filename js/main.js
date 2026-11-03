(() => {
  "use strict";

  // ── 상수 ───────────────────────────────────────────
  const RATIOS = {
    "1:1":  { w: 1080, h: 1080, kind: "S", label: "정사각형" },
    "4:5":  { w: 1080, h: 1350, kind: "",  label: "SNS 세로" },
    "9:16": { w: 1080, h: 1920, kind: "",  label: "스토리" },
    "4:3":  { w: 1440, h: 1080, kind: "F", label: "인물화 가로" },
    "3:4":  { w: 1080, h: 1440, kind: "F", label: "인물화 세로" },
    "3:2":  { w: 1620, h: 1080, kind: "P", label: "풍경화" },
    "16:9": { w: 1920, h: 1080, kind: "M", label: "와이드" },
  };
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const ACCEPTED = ["image/png", "image/jpeg"];
  const TMPL_KEY = "jjalcard_templates_v1";
  const THEME_KEY = "jjalcard_theme_v1";
  const FONT_STACK = `"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;
  const BRUSH_HISTORY_MAX = 20;

  // ── 상태 ───────────────────────────────────────────
  const state = {
    ratio: "1:1",
    image: null,
    imageMeta: null,
    text: "",
    fontSize: 48,
    textColor: "#ffffff",
    posX: 50,
    posY: 50,
    align: "center",
    strokeOn: true,
    strokeColor: "#000000",
    rotation: 0,         // 0~360 (편집 핸들로 조절, 결과물에도 반영)

    // 브러시 상태
    tool: "select",      // "select" | "brush" | "eraser"
    brushSize: 8,
    brushColor: "#ff3b30",
    brushAlpha: 1.0,     // 0.1 ~ 1.0
  };

  const ui = { theme: "dark" };

  // ── DOM ────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const stage = $("stage");
  const statusDot = $("statusDot");

  const els = {
    dropZone: $("dropZone"), fileInput: $("fileInput"), fileMsg: $("fileMsg"),
    removeImgBtn: $("removeImgBtn"),
    textInput: $("textInput"), fontSize: $("fontSize"), textColor: $("textColor"),
    posX: $("posX"), posY: $("posY"), align: $("align"),
    strokeOn: $("strokeOn"), strokeColor: $("strokeColor"),
    ratioTabs: $("ratioTabs"),
    downloadPngBtn: $("downloadPngBtn"), downloadJpegBtn: $("downloadJpegBtn"),
    saveMsg: $("saveMsg"),
    tmplName: $("tmplName"), saveTmplBtn: $("saveTmplBtn"),
    exportJsonBtn: $("exportJsonBtn"), importJsonBtn: $("importJsonBtn"),
    jsonInput: $("jsonInput"), tmplMsg: $("tmplMsg"), tmplList: $("tmplList"),
    themeToggle: $("themeToggle"),
    // 오버레이
    overlay: $("overlay"),
    frame: $("frame"),
    rotateHandle: $("rotateHandle"),
    // 브러시
    selectToolBtn: $("selectToolBtn"),
    brushToolBtn: $("brushToolBtn"),
    eraserToolBtn: $("eraserToolBtn"),
    brushSize: $("brushSize"),
    brushColor: $("brushColor"),
    brushAlpha: $("brushAlpha"),
    brushAlphaVal: $("brushAlphaVal"),
    brushUndoBtn: $("brushUndoBtn"),
    brushClearBtn: $("brushClearBtn"),
  };

  // 필수 DOM 누락 검사
  const missing = Object.entries(els).filter(([, v]) => !v).map(([k]) => k);
  if (!canvas || !ctx || missing.length) {
    console.error("[짤·카드 스튜디오] DOM 누락:", missing, "canvas:", !!canvas, "ctx:", !!ctx);
    alert("필수 요소를 찾지 못했습니다. index.html 구조를 확인하세요.\n누락: " + missing.join(", "));
    return;
  }

  // ── 브러시 오프스크린 레이어 ──────────────────────
  const brushLayer = document.createElement("canvas");
  const brushCtx = brushLayer.getContext("2d");
  const brushHistory = [];   // 실행 취소 스냅샷

  // ── 유틸 ───────────────────────────────────────────
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = "msg show " + (type || "err");
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = "msg"; }, 4000);
  }

  function setStatus(text) { if (statusDot) statusDot.textContent = text; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ── 테마 ───────────────────────────────────────────
  function applyTheme(theme) {
    ui.theme = (theme === "light") ? "light" : "dark";
    document.documentElement.dataset.theme = ui.theme;
    if (els.themeToggle) {
      [...els.themeToggle.children].forEach(b =>
        b.classList.toggle("active", b.dataset.theme === ui.theme)
      );
    }
    try { localStorage.setItem(THEME_KEY, ui.theme); } catch (_) {}
  }

  function loadSavedTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
    if (saved === "light" || saved === "dark") return saved;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
  }

  // ── 텍스트 측정 (렌더러·오버레이 공용) ─────────────
  function measureTextLayout(w, h) {
    const fontSize = clamp(state.fontSize, 8, Math.floor(Math.min(w, h) * 0.6));
    const font = `700 ${fontSize}px ${FONT_STACK}`;
    ctx.save();
    ctx.font = font;
    const lines = (state.text || "").split("\n");
    const widths = lines.map(l => ctx.measureText(l).width);
    const textW = Math.max(1, ...widths);
    ctx.restore();

    const lineHeight = fontSize * 1.28;
    const textH = lineHeight * lines.length;

    const padX = fontSize * 0.5;
    const padY = fontSize * 0.35;
    const boxW = textW + padX * 2;
    const boxH = textH + padY * 2;

    return { fontSize, font, lines, textW, lineHeight, textH, boxW, boxH, padX, padY };
  }

  // ── 이미지 로드 ────────────────────────────────────
  function validateFile(file) {
    if (!file) return "파일이 없습니다.";
    if (!ACCEPTED.includes(file.type)) {
      return `지원하지 않는 형식입니다 (${file.type || "알 수 없음"}). PNG 또는 JPEG만 가능합니다.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 최대 12MB.`;
    }
    return null;
  }

  function loadImageFile(file) {
    const err = validateFile(file);
    if (err) {
      showMsg(els.fileMsg, "❌ " + err, "err");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.image = img;
        state.imageMeta = { name: file.name, type: file.type, w: img.naturalWidth, h: img.naturalHeight };
        els.removeImgBtn.disabled = false;
        showMsg(els.fileMsg, `✅ 불러옴: ${file.name} (${img.naturalWidth}×${img.naturalHeight})`, "ok");
        render();
      };
      img.onerror = () => showMsg(els.fileMsg, "❌ 이미지를 해석할 수 없습니다.", "err");
      img.src = e.target.result;
    };
    reader.onerror = () => showMsg(els.fileMsg, "❌ 파일을 읽을 수 없습니다.", "err");
    reader.readAsDataURL(file);
  }

  function removeImage() {
    state.image = null;
    state.imageMeta = null;
    els.removeImgBtn.disabled = true;
    els.fileInput.value = "";
    showMsg(els.fileMsg, "이미지를 제거했습니다.", "ok");
    render();
  }

  // ── 브러시 레이어 리사이즈(비율 전환 시 스케일 유지) ─
  function resizeBrushLayer(newW, newH) {
    const old = document.createElement("canvas");
    old.width  = brushLayer.width;
    old.height = brushLayer.height;
    if (brushLayer.width > 0 && brushLayer.height > 0) {
      old.getContext("2d").drawImage(brushLayer, 0, 0);
    }

    brushLayer.width  = newW;
    brushLayer.height = newH;
    brushCtx.clearRect(0, 0, newW, newH);

    if (old.width > 0 && old.height > 0) {
      brushCtx.drawImage(old, 0, 0, old.width, old.height, 0, 0, newW, newH);
    }
    brushHistory.length = 0;
  }

  // ── 렌더링 (미리보기 = 다운로드 동일 함수) ─────────
  function render() {
    const { w, h } = RATIOS[state.ratio];
    if (canvas.width !== w)   canvas.width  = w;
    if (canvas.height !== h)  canvas.height = h;

    if (brushLayer.width !== w || brushLayer.height !== h) {
      resizeBrushLayer(w, h);
    }

    // 배경
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1a1d24";
    ctx.fillRect(0, 0, w, h);

    // 이미지
    if (state.image) {
      drawImageCover(ctx, state.image, w, h);
    } else {
      ctx.fillStyle = "#2a303c";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#5a6474";
      ctx.font = `600 ${Math.round(Math.min(w, h) * 0.045)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("이미지를 불러오세요", w / 2, h / 2);
    }

    // ★ 브러시 낙서 합성 (이미지 위, 문구 아래)
    ctx.drawImage(brushLayer, 0, 0);

    // 문구
    drawText(ctx, w, h);

    // 미리보기 스케일
    const maxW = 640;
    const maxH = 480;
    const scale = Math.min(1, maxW / w, maxH / h);
    canvas.style.width  = (w * scale) + "px";
    canvas.style.height = (h * scale) + "px";

    requestAnimationFrame(syncOverlay);
  }

  function drawImageCover(ctx, img, w, h) {
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = w / h;
    let sx, sy, sw, sh;
    if (ir > cr) {
      sh = img.naturalHeight; sw = sh * cr;
      sx = (img.naturalWidth - sw) / 2; sy = 0;
    } else {
      sw = img.naturalWidth; sh = sw / cr;
      sx = 0; sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  }

  function drawText(ctx, w, h) {
    const text = state.text;
    if (!text || !text.trim()) return;

    const L = measureTextLayout(w, h);
    const cx = (state.posX / 100) * w;
    const cy = (state.posY / 100) * h;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((state.rotation * Math.PI) / 180);

    ctx.font = L.font;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    let baseX;
    if (state.align === "left") {
      ctx.textAlign = "left";
      baseX = -L.boxW / 2 + L.padX;
    } else if (state.align === "right") {
      ctx.textAlign = "right";
      baseX = L.boxW / 2 - L.padX;
    } else {
      ctx.textAlign = "center";
      baseX = 0;
    }

    const startY = -L.textH / 2 + L.lineHeight / 2;

    L.lines.forEach((line, i) => {
      const y = startY + i * L.lineHeight;
      if (state.strokeOn) {
        ctx.lineWidth = Math.max(2, L.fontSize * 0.12);
        ctx.strokeStyle = state.strokeColor;
        ctx.strokeText(line, baseX, y);
      }
      ctx.fillStyle = state.textColor;
      ctx.fillText(line, baseX, y);
    });

    ctx.restore();
  }

  // ── 오버레이(점선 프레임 + 회전 핸들) ──────────────
  function syncOverlay() {
    if (!els.frame || !els.overlay) return;
    if (!RATIOS[state.ratio]) return;

    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const offsetX = rect.left - stageRect.left;
    const offsetY = rect.top - stageRect.top;

    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const L = measureTextLayout(canvas.width, canvas.height);
    const frameW = L.boxW * scaleX;
    const frameH = L.boxH * scaleY;

    const cx = offsetX + (state.posX / 100) * rect.width;
    const cy = offsetY + (state.posY / 100) * rect.height;

    els.frame.style.width  = frameW + "px";
    els.frame.style.height = frameH + "px";
    els.frame.style.left   = (cx - frameW / 2) + "px";
    els.frame.style.top    = (cy - frameH / 2) + "px";
    els.frame.style.transform = `rotate(${state.rotation}deg)`;

    els.frame.classList.toggle("hidden", !state.text || !state.text.trim());
  }

  // ── 브러시 그리기 ──────────────────────────────────
  let drawing = false;
  let lastPoint = null;

  function canvasPointToBrushCoord(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width  * brushLayer.width;
    const y = (e.clientY - rect.top)  / rect.height * brushLayer.height;
    return { x, y };
  }

  function pushBrushSnapshot() {
    const snap = document.createElement("canvas");
    snap.width  = brushLayer.width;
    snap.height = brushLayer.height;
    snap.getContext("2d").drawImage(brushLayer, 0, 0);
    brushHistory.push(snap);
    if (brushHistory.length > BRUSH_HISTORY_MAX) brushHistory.shift();
  }

  function brushBegin(e) {
    if (state.tool === "select") return;
    e.preventDefault();

    pushBrushSnapshot();

    drawing = true;
    lastPoint = canvasPointToBrushCoord(e);

    brushCtx.save();
    brushCtx.globalCompositeOperation = state.tool === "eraser" ? "destination-out" : "source-over";
    brushCtx.globalAlpha = state.tool === "eraser" ? 1 : state.brushAlpha;
    brushCtx.fillStyle = state.brushColor;
    brushCtx.beginPath();
    brushCtx.arc(lastPoint.x, lastPoint.y, state.brushSize / 2, 0, Math.PI * 2);
    brushCtx.fill();
    brushCtx.restore();

    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    render();
  }

  function brushMove(e) {
    if (!drawing) return;
    const p = canvasPointToBrushCoord(e);

    brushCtx.save();
    brushCtx.globalCompositeOperation = state.tool === "eraser" ? "destination-out" : "source-over";
    brushCtx.globalAlpha = state.tool === "eraser" ? 1 : state.brushAlpha;
    brushCtx.strokeStyle = state.brushColor;
    brushCtx.lineWidth = state.brushSize;
    brushCtx.lineCap = "round";
    brushCtx.lineJoin = "round";
    brushCtx.beginPath();
    brushCtx.moveTo(lastPoint.x, lastPoint.y);
    brushCtx.lineTo(p.x, p.y);
    brushCtx.stroke();
    brushCtx.restore();

    lastPoint = p;
    render();
  }

  function brushEnd(e) {
    if (!drawing) return;
    drawing = false;
    lastPoint = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  canvas.addEventListener("pointerdown", brushBegin);
  canvas.addEventListener("pointermove", brushMove);
  canvas.addEventListener("pointerup",   brushEnd);
  canvas.addEventListener("pointercancel", brushEnd);

  // ── 다운로드 ───────────────────────────────────────
  function download(type) {
    if (!state.image && !state.text.trim() && isBrushLayerEmpty()) {
      showMsg(els.saveMsg, "❌ 이미지·문구·낙서 중 하나는 있어야 합니다.", "err");
      return;
    }
    try {
      render();
      requestAnimationFrame(() => {
        const mime = type === "jpeg" ? "image/jpeg" : "image/png";
        const quality = type === "jpeg" ? 0.92 : undefined;
        canvas.toBlob((blob) => {
          if (!blob) { showMsg(els.saveMsg, "❌ 파일 생성 실패", "err"); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          a.href = url;
          a.download = `jjalcard_${state.ratio.replace(":", "x")}_${stamp}.${type}`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          showMsg(els.saveMsg, `✅ ${type.toUpperCase()} 저장 완료`, "ok");
        }, mime, quality);
      });
    } catch (e) {
      showMsg(els.saveMsg, "❌ 저장 중 오류: " + e.message, "err");
    }
  }

  function isBrushLayerEmpty() {
    if (brushLayer.width === 0 || brushLayer.height === 0) return true;
    const d = brushCtx.getImageData(0, 0, brushLayer.width, brushLayer.height).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 0) return false;
    }
    return true;
  }

  // ── 프레임 드래그: 위치 이동 ──────────────────────
  let frameDrag = null;
  els.frame.addEventListener("pointerdown", (e) => {
    if (state.tool !== "select") return;
    if (e.target === els.rotateHandle || els.rotateHandle.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = canvas.getBoundingClientRect();
    frameDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: state.posX,
      startPosY: state.posY,
      rect,
    };
    try { els.frame.setPointerCapture(e.pointerId); } catch (_) {}
  });

  els.frame.addEventListener("pointermove", (e) => {
    if (!frameDrag || frameDrag.pointerId !== e.pointerId) return;
    const dx = e.clientX - frameDrag.startX;
    const dy = e.clientY - frameDrag.startY;
    const nx = frameDrag.startPosX + (dx / frameDrag.rect.width) * 100;
    const ny = frameDrag.startPosY + (dy / frameDrag.rect.height) * 100;
    state.posX = clamp(nx, 0, 100);
    state.posY = clamp(ny, 0, 100);
    els.posX.value = Math.round(state.posX);
    els.posY.value = Math.round(state.posY);
    render();
  });

  els.frame.addEventListener("pointerup", (e) => {
    if (frameDrag && frameDrag.pointerId === e.pointerId) {
      try { els.frame.releasePointerCapture(e.pointerId); } catch (_) {}
      frameDrag = null;
    }
  });
  els.frame.addEventListener("pointercancel", () => { frameDrag = null; });

  // ── 회전 핸들 드래그 ──────────────────────────────
  let rotDrag = null;
  els.rotateHandle.addEventListener("pointerdown", (e) => {
    if (state.tool !== "select") return;
    e.preventDefault();
    e.stopPropagation();

    const canvasRect = canvas.getBoundingClientRect();
    const cx = canvasRect.left + (state.posX / 100) * canvasRect.width;
    const cy = canvasRect.top  + (state.posY / 100) * canvasRect.height;

    rotDrag = {
      pointerId: e.pointerId,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
      startRotation: state.rotation,
    };
    try { els.rotateHandle.setPointerCapture(e.pointerId); } catch (_) {}
  });

  els.rotateHandle.addEventListener("pointermove", (e) => {
    if (!rotDrag || rotDrag.pointerId !== e.pointerId) return;
    const angle = Math.atan2(e.clientY - rotDrag.centerY, e.clientX - rotDrag.centerX) * 180 / Math.PI;
    let next = rotDrag.startRotation + (angle - rotDrag.startAngle);
    if (e.shiftKey) next = Math.round(next / 15) * 15;
    next = ((next % 360) + 360) % 360;
    state.rotation = next;
    render();
  });

  els.rotateHandle.addEventListener("pointerup", (e) => {
    if (rotDrag && rotDrag.pointerId === e.pointerId) {
      try { els.rotateHandle.releasePointerCapture(e.pointerId); } catch (_) {}
      rotDrag = null;
    }
  });
  els.rotateHandle.addEventListener("pointercancel", () => { rotDrag = null; });

  // ── 도구 전환 ──────────────────────────────────────
  function setTool(tool) {
    state.tool = tool;
    document.body.dataset.tool = tool;
    const map = { select: els.selectToolBtn, brush: els.brushToolBtn, eraser: els.eraserToolBtn };
    [els.selectToolBtn, els.brushToolBtn, els.eraserToolBtn].forEach(b => {
      if (!b) return;
      b.classList.toggle("primary", b === map[tool]);
    });
    render();
  }

  els.selectToolBtn.addEventListener("click", () => setTool("select"));
  els.brushToolBtn.addEventListener("click", () => setTool("brush"));
  els.eraserToolBtn.addEventListener("click", () => setTool("eraser"));

  els.brushSize.addEventListener("input", (e) => {
    state.brushSize = clamp(parseInt(e.target.value, 10) || 8, 1, 200);
    render();
  });
  els.brushColor.addEventListener("input", (e) => {
    state.brushColor = e.target.value;
  });
  els.brushAlpha.addEventListener("input", (e) => {
    state.brushAlpha = clamp(parseInt(e.target.value, 10) || 100, 10, 100) / 100;
    els.brushAlphaVal.textContent = Math.round(state.brushAlpha * 100);
  });

  els.brushUndoBtn.addEventListener("click", () => {
    const prev = brushHistory.pop();
    if (!prev) { showMsg(els.saveMsg, "되돌릴 낙서가 없습니다.", "err"); return; }
    brushCtx.clearRect(0, 0, brushLayer.width, brushLayer.height);
    brushCtx.drawImage(prev, 0, 0);
    render();
  });

  els.brushClearBtn.addEventListener("click", () => {
    if (isBrushLayerEmpty()) {
      showMsg(els.saveMsg, "지울 낙서가 없습니다.", "err");
      return;
    }
    if (!confirm("낙서를 모두 지울까요?")) return;
    pushBrushSnapshot();
    brushCtx.clearRect(0, 0, brushLayer.width, brushLayer.height);
    render();
  });

  // ── 입력 바인딩 ────────────────────────────────────
  els.textInput.addEventListener("input", (e) => { state.text = e.target.value; render(); });
  els.fontSize.addEventListener("input", (e) => {
    state.fontSize = clamp(parseInt(e.target.value || "48", 10) || 48, 8, 400);
    render();
  });
  els.textColor.addEventListener("input", (e) => { state.textColor = e.target.value; render(); });
  els.posX.addEventListener("input", (e) => {
    state.posX = clamp(parseFloat(e.target.value || "50") || 0, 0, 100); render();
  });
  els.posY.addEventListener("input", (e) => {
    state.posY = clamp(parseFloat(e.target.value || "50") || 0, 0, 100); render();
  });
  els.align.addEventListener("change", (e) => { state.align = e.target.value; render(); });
  els.strokeOn.addEventListener("change", (e) => { state.strokeOn = e.target.value === "on"; render(); });
  els.strokeColor.addEventListener("input", (e) => { state.strokeColor = e.target.value; render(); });

  els.ratioTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ratio]");
    if (!btn) return;
    state.ratio = btn.dataset.ratio;
    [...els.ratioTabs.children].forEach(b => b.classList.toggle("active", b === btn));
    render();
  });

  els.themeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    applyTheme(btn.dataset.theme);
  });

  // 파일 입력 / 드래그
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("dragover", (e) => { e.preventDefault(); els.dropZone.classList.add("over"); });
  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("over"));
  els.dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); els.dropZone.classList.remove("over");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFile(f);
  });
  els.fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadImageFile(f);
    e.target.value = "";
  });
  els.removeImgBtn.addEventListener("click", removeImage);
  els.downloadPngBtn.addEventListener("click", () => download("png"));
  els.downloadJpegBtn.addEventListener("click", () => download("jpeg"));

  // ── 템플릿 (localStorage) ──────────────────────────
  function readTemplates() {
    try {
      const raw = localStorage.getItem(TMPL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function writeTemplates(list) {
    try { localStorage.setItem(TMPL_KEY, JSON.stringify(list)); }
    catch { showMsg(els.tmplMsg, "❌ 저장 공간 부족", "err"); }
  }
  function currentSnapshot() {
    return {
      ratio: state.ratio,
      text: state.text,
      fontSize: state.fontSize,
      textColor: state.textColor,
      posX: state.posX,
      posY: state.posY,
      align: state.align,
      strokeOn: state.strokeOn,
      strokeColor: state.strokeColor,
      rotation: Math.round(state.rotation * 10) / 10,
    };
  }
  function applySnapshot(snap) {
    if (!snap) return;
    if (RATIOS[snap.ratio]) {
      state.ratio = snap.ratio;
      [...els.ratioTabs.children].forEach(b => b.classList.toggle("active", b.dataset.ratio === snap.ratio));
    }
    state.text = snap.text ?? state.text;
    state.fontSize = clamp(Number(snap.fontSize ?? state.fontSize), 8, 400);
    state.textColor = snap.textColor ?? state.textColor;
    state.posX = clamp(Number(snap.posX ?? state.posX), 0, 100);
    state.posY = clamp(Number(snap.posY ?? state.posY), 0, 100);
    state.align = snap.align ?? state.align;
    state.strokeOn = snap.strokeOn ?? state.strokeOn;
    state.strokeColor = snap.strokeColor ?? state.strokeColor;
    state.rotation = clamp(Number(snap.rotation ?? state.rotation), 0, 360);

    els.textInput.value = state.text;
    els.fontSize.value = state.fontSize;
    els.textColor.value = state.textColor;
    els.posX.value = Math.round(state.posX);
    els.posY.value = Math.round(state.posY);
    els.align.value = state.align;
    els.strokeOn.value = state.strokeOn ? "on" : "off";
    els.strokeColor.value = state.strokeColor;

    render();
  }

  function renderTemplateList() {
    const list = readTemplates();
    els.tmplList.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "저장된 템플릿이 없습니다.";
      els.tmplList.appendChild(empty);
      return;
    }
    list.forEach((t) => {
      const item = document.createElement("div");
      item.className = "tmpl-item";
      item.innerHTML = `<span class="name">${escapeHtml(t.name)}</span><span class="small">${escapeHtml(t.data.ratio)}</span>`;
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "삭제";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        writeTemplates(readTemplates().filter(x => x.id !== t.id));
        renderTemplateList();
        showMsg(els.tmplMsg, "템플릿을 삭제했습니다.", "ok");
      });
      item.appendChild(del);
      item.addEventListener("click", () => {
        applySnapshot(t.data);
        els.tmplName.value = t.name;
        showMsg(els.tmplMsg, `템플릿 "${t.name}" 불러옴`, "ok");
      });
      els.tmplList.appendChild(item);
    });
  }

  function saveTemplate() {
    const name = (els.tmplName.value || "").trim();
    if (!name) { showMsg(els.tmplMsg, "❌ 템플릿 이름을 입력하세요.", "err"); return; }
    const list = readTemplates();
    const idx = list.findIndex(t => t.name === name);
    const entry = { id: idx >= 0 ? list[idx].id : String(Date.now()), name, data: currentSnapshot() };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    writeTemplates(list);
    renderTemplateList();
    showMsg(els.tmplMsg, `✅ 템플릿 "${name}" 저장됨`, "ok");
  }

  function exportJson() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), templates: readTemplates() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `jjalcard_templates_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showMsg(els.tmplMsg, "✅ JSON 내보내기 완료", "ok");
  }

  function importJson(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showMsg(els.tmplMsg, "❌ JSON이 너무 큽니다(최대 2MB).", "err"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed;
      try { parsed = JSON.parse(e.target.result); }
      catch { showMsg(els.tmplMsg, "❌ JSON 파싱 실패", "err"); return; }

      const incoming = Array.isArray(parsed) ? parsed
                     : (parsed && Array.isArray(parsed.templates) ? parsed.templates : null);
      if (!incoming) { showMsg(els.tmplMsg, "❌ 올바른 템플릿 JSON 형식이 아닙니다.", "err"); return; }

      const byName = new Map(readTemplates().map(t => [t.name, t]));
      let added = 0, updated = 0;

      for (const t of incoming) {
        if (!t || typeof t.name !== "string" || !t.data || typeof t.data !== "object") continue;
        const safeData = sanitizeTemplateData(t.data);
        if (byName.has(t.name)) updated++; else added++;
        byName.set(t.name, {
          id: String(t.id ?? Date.now() + added + updated),
          name: t.name.slice(0, 60),
          data: safeData,
        });
      }
      writeTemplates([...byName.values()]);
      renderTemplateList();
      showMsg(els.tmplMsg, `✅ 불러옴 (추가 ${added}, 갱신 ${updated})`, "ok");
    };
    reader.onerror = () => showMsg(els.tmplMsg, "❌ 파일 읽기 실패", "err");
    reader.readAsText(file);
  }

  function sanitizeTemplateData(d) {
    return {
      ratio: RATIOS[d.ratio] ? d.ratio : "1:1",
      text: typeof d.text === "string" ? d.text.slice(0, 2000) : "",
      fontSize: clamp(Number(d.fontSize) || 48, 8, 400),
      textColor: /^#[0-9a-f]{6}$/i.test(d.textColor) ? d.textColor : "#ffffff",
      posX: clamp(Number(d.posX) || 50, 0, 100),
      posY: clamp(Number(d.posY) || 50, 0, 100),
      align: ["left", "center", "right"].includes(d.align) ? d.align : "center",
      strokeOn: !!d.strokeOn,
      strokeColor: /^#[0-9a-f]{6}$/i.test(d.strokeColor) ? d.strokeColor : "#000000",
      rotation: clamp(Number(d.rotation) || 0, 0, 360),
    };
  }

  els.saveTmplBtn.addEventListener("click", saveTemplate);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.importJsonBtn.addEventListener("click", () => els.jsonInput.click());
  els.jsonInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = "";
  });

  // ── 초기화 ─────────────────────────────────────────
  function init() {
    applyTheme(loadSavedTheme());
    state.text = els.textInput.value;
    renderTemplateList();
    render();
    setTool("select");
    setStatus("준비됨");
  }
  init();

  // 창 크기 변경 시 오버레이 재계산 (rAF 디바운스)
  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(render);
  });

  window.addEventListener("scroll", () => requestAnimationFrame(syncOverlay), { passive: true });

  window.__jjalcard = { state, ui, render, brushLayer };
})();