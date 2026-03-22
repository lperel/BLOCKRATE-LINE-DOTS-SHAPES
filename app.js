const DEFAULTS = {
  adminPasscode: "4822",
  mode: "cognitive",
  theme: "theme-neon",
  startDurationMs: 800,
  speedupFactor: 0.94,
  resumeSlowerByMs: 300,
  consecutiveMissesForBlock: 2,
  recoveryCorrectTrials: 2,
  qualifyingBlockGapMs: 250,
  noResponseTimeoutMs: 4000,
  wrongWindowSize: 5,
  wrongThresholdStop: 3,
  maxTrialCount: 180,
  minDurationMs: 250,
  maxDurationMs: 2500
};

const ADMIN_FIELDS = [
  ["mode","Mode","select",["cognitive","benchmark"]],
  ["theme","Theme","select",["theme-neon","theme-clinical","theme-minimal"]],
  ["startDurationMs","Starting paced duration (ms)","number"],
  ["speedupFactor","Speedup factor","number"],
  ["resumeSlowerByMs","Resume slower after block (ms)","number"],
  ["consecutiveMissesForBlock","Consecutive misses for block","number"],
  ["recoveryCorrectTrials","Recovery correct trials","number"],
  ["qualifyingBlockGapMs","Gap between consecutive blocks to end (ms)","number"],
  ["noResponseTimeoutMs","Time to end test if no response (ms)","number"],
  ["wrongWindowSize","Wrong-answer window size","number"],
  ["wrongThresholdStop","Wrong answers threshold","number"],
  ["maxTrialCount","Maximum paced trial count","number"],
  ["minDurationMs","Minimum paced duration (ms)","number"],
  ["maxDurationMs","Maximum paced duration (ms)","number"],
  ["adminPasscode","Admin passcode","password"]
];

const SHAPES = ["square","triangle","diamond","hexagon","star","pentagon"];
const SAMN_PERELLI = [
  [7, "Full alert, wide awake"],
  [6, "Very lively, responsive, but not at peak"],
  [5, "Okay, about normal"],
  [4, "Less than sharp, let down"],
  [3, "Feeling dull, losing focus"],
  [2, "Very difficult to concentrate, groggy"],
  [1, "Unable to function, ready to drop"]
];
const DOT_PATTERNS = {
  1:[["dot",50,50]],
  2:[["dot",34,50],["dot",66,50]],
  3:[["dot",50,30],["dot",50,50],["dot",50,70]],
  4:[["dot",34,34],["dot",66,34],["dot",34,66],["dot",66,66]],
  5:[["dot",34,34],["dot",66,34],["dot",50,50],["dot",34,66],["dot",66,66]],
  6:[["dot",34,25],["dot",66,25],["dot",34,50],["dot",66,50],["dot",34,75],["dot",66,75]]
};
const LINE_PATTERNS = {
  1:[["v",50,50]],
  2:[["v",40,50],["v",60,50]],
  3:[["h",50,30],["h",50,50],["h",50,70]],
  4:[["h",50,30],["v",30,50],["v",70,50],["h",50,70]],
  5:[["v",35,40],["h",55,32],["h",55,48],["h",55,68],["v",75,60]],
  6:[["h",44,26],["v",74,34],["v",34,50],["h",52,50],["h",40,74],["v",76,74]]
};

let settings = loadSettings();
const state = {
  phase: "idle",
  duration: settings.startDurationMs,
  blockDuration: null,
  current: null,
  previous: null,
  unresolvedStreak: 0,
  overloads: [],
  recoveries: [],
  recoveryCorrectCompleted: 0,
  liveData: [],
  history: JSON.parse(localStorage.getItem("blockrate_next_build_v2_history") || "[]"),
  oneBackCount: 0,
  onTimeCount: 0,
  totalTrials: 0,
  trialTimer: null,
  absoluteNoResponseTimer: null,
  lastBlockGap: null,
  qualifyingBlockPair: null,
  endReason: "",
  lastFiveAnswers: [],
  samnPerelli: null,
  subjectId: null,
  benchmarkFrames: []
};

let deferredPrompt = null;
let titleTapCount = 0;
let titleTapTimer = null;

const $ = id => document.getElementById(id);
const probeCircle = $("probeCircle"), upperEl = $("upper"), buttonsEl = $("buttons");
const rateOut=$("rateOut"), blocksOut=$("blocksOut"), recoveryOut=$("recoveryOut"), gapOut=$("gapOut"), wrongOut=$("wrongOut"), fatigueOut=$("fatigueOut"), cpsOut=$("cpsOut");
const statusLine=$("statusLine"), resultBox=$("resultBox"), phaseLabel=$("phaseLabel"), modeLabel=$("modeLabel"), titleHold=$("titleHold");
const liveChart=$("liveChart"), lctx=liveChart.getContext("2d");
const adminChart=$("adminChart"), aCtx=adminChart.getContext("2d"), fatigueChart=$("fatigueChart"), fCtx=fatigueChart.getContext("2d");

function loadSettings(){
  const saved = JSON.parse(localStorage.getItem("blockrate_next_build_v2_settings") || "null");
  return saved ? {...DEFAULTS, ...saved} : {...DEFAULTS};
}
function saveSettings(){
  localStorage.setItem("blockrate_next_build_v2_settings", JSON.stringify(settings));
  applyTheme();
}
function applyTheme(){
  document.body.className = settings.theme;
  modeLabel.textContent = settings.mode === "benchmark" ? "Benchmark mode" : "Subject mode";
}

function subjectKey(id){
  return id === "0" ? "Guest" : id;
}
function getSubjectHistory(){
  const key = subjectKey(state.subjectId || "0");
  return state.history.filter(x => x.subjectId === key);
}
function computeCPS(avgMs){
  const cps = ((3000 - avgMs) / 2000) * 100;
  return Math.max(0, Math.min(100, cps));
}

function renderAdmin(){
  const wrap = $("adminSettings");
  wrap.innerHTML = "";
  for(const [key,label,type,opts] of ADMIN_FIELDS){
    const row = document.createElement("div");
    row.className = "row";
    let field = "";
    if(type === "select"){
      field = `<select id="adm_${key}">${opts.map(v => `<option value="${v}" ${String(settings[key])===v?"selected":""}>${v}</option>`).join("")}</select>`;
    } else {
      field = `<input id="adm_${key}" type="${type}" value="${settings[key]}">`;
    }
    row.innerHTML = `<label>${label}<div class="hint">${key}</div></label>${field}`;
    wrap.appendChild(row);
  }
  drawAdminGraphs();
}
function readAdmin(){
  for(const [key,label,type] of ADMIN_FIELDS){
    const el = $("adm_"+key);
    settings[key] = type === "number" ? Number(el.value) : el.value;
  }
}
function resetAdmin(){ settings = {...DEFAULTS}; renderAdmin(); saveSettings(); }

function renderFatigueChecklist(){
  const fatigueList = $("fatigueList");
  fatigueList.innerHTML = "";
  for(const [score, label] of SAMN_PERELLI){
    const btn = document.createElement("button");
    btn.className = "fatigueItem";
    btn.textContent = `${score}. ${label}`;
    btn.addEventListener("click", ()=>{
      state.samnPerelli = { score, label };
      fatigueOut.textContent = String(score);
      $("fatigueOverlay").classList.add("hidden");
      resultBox.textContent = `Samn–Perelli fatigue rating selected: ${score} — ${label}`;
      setStatus("Fatigue rating recorded");
    });
    fatigueList.appendChild(btn);
  }
}

function shapeSvg(shapeId, pattern=null){
  const shapeClass='class="shapeStroke"';
  let shape="";
  if(shapeId==="square") shape=`<rect x="18" y="18" width="64" height="64" ${shapeClass}/>`;
  if(shapeId==="triangle") shape=`<polygon points="50,15 84,82 16,82" ${shapeClass}/>`;
  if(shapeId==="diamond") shape=`<polygon points="50,12 86,50 50,88 14,50" ${shapeClass}/>`;
  if(shapeId==="hexagon") shape=`<polygon points="30,18 70,18 88,50 70,82 30,82 12,50" ${shapeClass}/>`;
  if(shapeId==="star") shape=`<polygon points="50,14 58,38 84,38 63,53 71,79 50,63 29,79 37,53 16,38 42,38" ${shapeClass}/>`;
  if(shapeId==="pentagon") shape=`<polygon points="50,12 85,38 70,85 30,85 15,38" ${shapeClass}/>`;
  let marks = "";
  if(pattern){
    for(const item of pattern){
      const [kind,x,y] = item;
      if(kind === "dot") marks += `<circle cx="${x}" cy="${y}" r="6.8" fill="var(--text)"/>`;
      if(kind === "v") marks += `<rect x="${x-3.5}" y="${y-16}" width="7" height="32" fill="var(--text)"/>`;
      if(kind === "h") marks += `<rect x="${x-16}" y="${y-3.5}" width="32" height="7" fill="var(--text)"/>`;
    }
  }
  return `<div class="shapeHolder"><svg class="shapeSvg" viewBox="0 0 100 100">${shape}${marks}</svg></div>`;
}

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(v,lo,hi){ return Math.min(hi, Math.max(lo,v)); }
function median(arr){ if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function setStatus(msg){ statusLine.textContent = msg; }
function clearTimer(){ if(state.trialTimer) clearTimeout(state.trialTimer); state.trialTimer = null; }
function clearNoResponseTimer(){ if(state.absoluteNoResponseTimer) clearTimeout(state.absoluteNoResponseTimer); state.absoluteNoResponseTimer = null; }
function armNoResponseTimer(){
  clearNoResponseTimer();
  state.absoluteNoResponseTimer = setTimeout(()=>{
    state.endReason = `No response for more than ${settings.noResponseTimeoutMs} ms`;
    finish();
  }, settings.noResponseTimeoutMs);
}
function noteAnyResponse(){ armNoResponseTimer(); }

function makeCognitiveTrial(kind){
  const upperShapes = shuffle(SHAPES);
  const lowerShapes = shuffle(SHAPES);
  const family = Math.random() < 0.5 ? "dotsToLines" : "linesToDots";
  const targetCount = randInt(1,6);
  const correctUpperIndex = randInt(0,5);
  const correctShapeId = upperShapes[correctUpperIndex];
  const counts = shuffle([1,2,3,4,5,6]);
  const upperItems = counts.map(count => ({count, pattern: family === "dotsToLines" ? LINE_PATTERNS[count] : DOT_PATTERNS[count]}));
  const existingIndex = upperItems.findIndex(x => x.count === targetCount);
  [upperItems[correctUpperIndex], upperItems[existingIndex]] = [upperItems[existingIndex], upperItems[correctUpperIndex]];
  const targetPattern = family === "dotsToLines" ? DOT_PATTERNS[targetCount] : LINE_PATTERNS[targetCount];
  return { kind, upperShapes, lowerShapes, targetPattern, upperItems, correctShapeId, resolved:false };
}
function makeBenchmarkTrial(kind){
  const targetIndex = randInt(0,5);
  return { kind, benchIndex: targetIndex, benchLabel: String(targetIndex+1), resolved:false, openedAt: performance.now() };
}

function renderProbe(trial){
  if(settings.mode === "benchmark"){
    probeCircle.innerHTML = `<div style="font-size:46px;font-weight:800">${trial.benchLabel}</div>`;
    return;
  }
  probeCircle.innerHTML = `<svg class="shapeSvg" viewBox="0 0 100 100">${trial.targetPattern.map(item => {
    const [kind,x,y] = item;
    if(kind==="dot") return `<circle cx="${x}" cy="${y}" r="6.8" fill="var(--text)"/>`;
    if(kind==="v") return `<rect x="${x-3.5}" y="${y-16}" width="7" height="32" fill="var(--text)"/>`;
    if(kind==="h") return `<rect x="${x-16}" y="${y-3.5}" width="32" height="7" fill="var(--text)"/>`;
    return "";
  }).join("")}</svg>`;
}
function renderUpper(trial){
  upperEl.innerHTML = "";
  if(settings.mode === "benchmark"){
    for(let i=0;i<6;i++){
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = `<div style="font-size:34px;font-weight:800">${i+1}</div>`;
      upperEl.appendChild(cell);
    }
    return;
  }
  for(let i=0;i<6;i++){
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = shapeSvg(trial.upperShapes[i], trial.upperItems[i].pattern);
    upperEl.appendChild(cell);
  }
}
function renderButtons(trial){
  buttonsEl.innerHTML = "";
  if(settings.mode === "benchmark"){
    for(let i=0;i<6;i++){
      const btn = document.createElement("div");
      btn.className = "btncell";
      btn.innerHTML = `<div style="font-size:34px;font-weight:800">${i+1}</div>`;
      btn.addEventListener("click", ()=>handleTap(i));
      buttonsEl.appendChild(btn);
    }
    return;
  }
  for(let i=0;i<6;i++){
    const btn = document.createElement("div");
    btn.className = "btncell";
    btn.dataset.shape = trial.lowerShapes[i];
    btn.innerHTML = shapeSvg(trial.lowerShapes[i], null);
    btn.addEventListener("click", ()=>handleTap(i));
    buttonsEl.appendChild(btn);
  }
}
function drawLive(){
  lctx.clearRect(0,0,liveChart.width,liveChart.height);
  lctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#6fd6ff";
  lctx.lineWidth = 2;
  lctx.beginPath();
  state.liveData.forEach((v,i)=>{
    const x = (i / Math.max(1, state.liveData.length - 1)) * (liveChart.width - 10) + 5;
    const y = liveChart.height - Math.min(160, v / 8);
    if(i===0) lctx.moveTo(x,y); else lctx.lineTo(x,y);
  });
  lctx.stroke();
}
function updateMetrics(){
  rateOut.textContent = `${(1000/state.duration).toFixed(2)} Hz`;
  blocksOut.textContent = String(state.overloads.length);
  recoveryOut.textContent = String(state.recoveries.length);
  gapOut.textContent = state.lastBlockGap == null ? "—" : `${Math.round(state.lastBlockGap)} ms`;
  wrongOut.textContent = String(state.lastFiveAnswers.filter(v=>v===false).length);
  fatigueOut.textContent = state.samnPerelli ? String(state.samnPerelli.score) : "—";
}
function updateCPSDisplay(avgLast2){
  cpsOut.textContent = avgLast2 != null ? computeCPS(avgLast2).toFixed(0) : "—";
}

function recordAnswer(isCorrect){
  state.lastFiveAnswers.push(isCorrect);
  if(state.lastFiveAnswers.length > settings.wrongWindowSize) state.lastFiveAnswers.shift();
  updateMetrics();
  const wrongCount = state.lastFiveAnswers.filter(v=>v===false).length;
  if(state.lastFiveAnswers.length === settings.wrongWindowSize && wrongCount > settings.wrongThresholdStop){
    clearTimer(); clearNoResponseTimer();
    state.phase = "finished";
    state.endReason = `More than ${settings.wrongThresholdStop} wrong answers out of the last ${settings.wrongWindowSize} answers. Restart required.`;
    resultBox.textContent = "Test stopped. Please start over.";
    setStatus(state.endReason);
    return true;
  }
  return false;
}

function openTrial(kind){
  clearTimer();
  state.previous = state.current;
  state.current = settings.mode === "benchmark" ? makeBenchmarkTrial(kind) : makeCognitiveTrial(kind);
  renderProbe(state.current);
  renderUpper(state.current);
  renderButtons(state.current);
  updateMetrics();
  drawLive();

  if(kind === "paced"){
    phaseLabel.textContent = `Paced · ${Math.round(state.duration)} ms`;
    setStatus(settings.mode === "benchmark" ? "Device benchmark paced" : "Machine-paced");
    state.trialTimer = setTimeout(onPacedFrameEnd, state.duration);
  } else if(kind === "recovery"){
    phaseLabel.textContent = `Recovery ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Self-paced recovery");
  } else if(kind === "terminal_recovery"){
    phaseLabel.textContent = `Final recovery ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Stable blocking gap found");
  }
}
function trialMatches(trial, index){
  if(settings.mode === "benchmark") return trial && index === trial.benchIndex;
  const chosenShapeId = buttonsEl.children[index].dataset.shape;
  return trial && chosenShapeId === trial.correctShapeId;
}
function maybeTriggerTerminalRule(){
  if(state.overloads.length < 2) return false;
  const n = state.overloads.length;
  const gap = Math.abs(state.overloads[n-1] - state.overloads[n-2]);
  state.lastBlockGap = gap;
  updateMetrics();
  if(gap < settings.qualifyingBlockGapMs){
    state.qualifyingBlockPair = [state.overloads[n-2], state.overloads[n-1]];
    state.phase = "terminal_recovery";
    state.recoveryCorrectCompleted = 0;
    openTrial("terminal_recovery");
    return true;
  }
  return false;
}
function handleTap(index){
  if(!["paced","recovery","terminal_recovery"].includes(state.phase)) return;
  noteAnyResponse();

  if(settings.mode === "benchmark" && state.current && state.current.kind === "paced"){
    state.benchmarkFrames.push(performance.now() - state.current.openedAt);
  }

  if(state.phase === "recovery" || state.phase === "terminal_recovery"){
    const ok = trialMatches(state.current, index);
    if(recordAnswer(ok)) return;
    if(ok){
      state.current.resolved = true;
      state.recoveryCorrectCompleted += 1;
      if(state.recoveryCorrectCompleted >= settings.recoveryCorrectTrials){
        if(state.phase === "terminal_recovery"){
          state.endReason = `Completed ${settings.recoveryCorrectTrials} final self-paced trials after consecutive blocks under ${settings.qualifyingBlockGapMs} ms apart`;
          finish(); return;
        }
        state.recoveries.push(state.blockDuration + settings.resumeSlowerByMs);
        state.phase = "paced";
        state.duration = clamp(state.blockDuration + settings.resumeSlowerByMs, settings.minDurationMs, settings.maxDurationMs);
        setTimeout(()=>openTrial("paced"), 180);
      } else {
        setTimeout(()=>openTrial(state.phase), 160);
      }
    } else {
      setTimeout(()=>openTrial(state.phase), 160);
    }
    return;
  }

  if(state.previous && state.previous.kind==="paced" && !state.previous.resolved && trialMatches(state.previous, index)){
    state.previous.resolved = true;
    state.oneBackCount += 1;
    if(recordAnswer(true)) return;
    return;
  }
  if(state.current && state.current.kind==="paced" && !state.current.resolved && trialMatches(state.current, index)){
    state.current.resolved = true;
    state.onTimeCount += 1;
    if(recordAnswer(true)) return;
    return;
  }
  recordAnswer(false);
}
function onPacedFrameEnd(){
  if(state.phase !== "paced") return;
  state.totalTrials += 1;
  const currentMissed = state.current && state.current.kind==="paced" && !state.current.resolved;
  if(currentMissed){ if(recordAnswer(false)) return; }
  state.unresolvedStreak = currentMissed ? state.unresolvedStreak + 1 : 0;
  state.liveData.push(state.duration);
  if(state.unresolvedStreak >= settings.consecutiveMissesForBlock){
    state.blockDuration = state.duration;
    state.overloads.push(state.blockDuration);
    state.unresolvedStreak = 0;
    updateCPSDisplay(avgLast2Blocks());
    if(maybeTriggerTerminalRule()) return;
    state.phase = "recovery";
    state.recoveryCorrectCompleted = 0;
    openTrial("recovery");
    return;
  }
  state.duration = clamp(state.duration * settings.speedupFactor, settings.minDurationMs, settings.maxDurationMs);
  if(state.totalTrials >= settings.maxTrialCount){ state.endReason = "Reached trial cap"; finish(); }
  else openTrial("paced");
}
function avgLast2Blocks(){
  if(state.overloads.length < 2) return state.overloads.length ? state.overloads[state.overloads.length-1] : null;
  return (state.overloads[state.overloads.length-1] + state.overloads[state.overloads.length-2]) / 2;
}
function finish(){
  clearTimer(); clearNoResponseTimer();
  state.phase = "finished";
  const avg2 = avgLast2Blocks();
  const cps = avg2 != null ? computeCPS(avg2) : null;

  const result = {
    subjectId: subjectKey(state.subjectId || "0"),
    mode: settings.mode,
    theme: settings.theme,
    samnPerelli: state.samnPerelli,
    blocks: [...state.overloads],
    averageLast2BlockingScoresMs: avg2,
    cognitivePerformanceScore: cps,
    benchmarkMedianMs: state.benchmarkFrames.length ? median(state.benchmarkFrames) : null,
    endReason: state.endReason || "Run complete",
    time: new Date().toISOString()
  };
  state.history.push(result);
  localStorage.setItem("blockrate_next_build_v2_history", JSON.stringify(state.history));

  updateCPSDisplay(avg2);

  let extra = "";
  if(settings.mode === "benchmark"){
    extra = `\nBenchmark median response latency:\n${result.benchmarkMedianMs != null ? result.benchmarkMedianMs.toFixed(1) + " ms" : "—"}`;
  }

  const fatigueText = state.samnPerelli ? `${state.samnPerelli.score} — ${state.samnPerelli.label}` : "not recorded";
  resultBox.textContent =
`Subject ID:
${result.subjectId}

Mode:
${settings.mode}

Samn–Perelli:
${fatigueText}

Average of last 2 blocking scores:
${avg2 != null ? avg2.toFixed(1) + " ms" : "—"}

Cognitive Performance Score (CPS):
${cps != null ? cps.toFixed(1) : "—"}   (1000 ms = 100, 3000 ms = 0)${extra}

End reason:
${result.endReason}`;
}
function exportResults(){
  const blob = new Blob([JSON.stringify({settings, history:state.history}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_next_build_v2_results.json";
  a.click();
}
function emailResults(){
  const last = state.history[state.history.length-1] || {};
  const body = encodeURIComponent(JSON.stringify(last, null, 2));
  window.location.href = `mailto:?subject=BlockRate Next Build V2&body=${body}`;
}

function startTest(){
  if(!state.subjectId){
    $("subjectOverlay").classList.remove("hidden");
    setStatus("Enter Subject ID first");
    return;
  }
  if(!state.samnPerelli){
    $("fatigueOverlay").classList.remove("hidden");
    setStatus("Select Samn–Perelli fatigue rating first");
    return;
  }
  clearTimer(); clearNoResponseTimer();
  state.phase = "paced";
  state.duration = settings.startDurationMs;
  state.blockDuration = null;
  state.current = null;
  state.previous = null;
  state.unresolvedStreak = 0;
  state.overloads = [];
  state.recoveries = [];
  state.recoveryCorrectCompleted = 0;
  state.totalTrials = 0;
  state.lastBlockGap = null;
  state.qualifyingBlockPair = null;
  state.endReason = "";
  state.lastFiveAnswers = [];
  state.benchmarkFrames = [];
  resultBox.textContent = `Subject ID: ${subjectKey(state.subjectId)}\nSamn–Perelli: ${state.samnPerelli.score} — ${state.samnPerelli.label}`;
  noteAnyResponse();
  openTrial("paced");
}

function drawLineChart(ctx, values, labelText, formatter){
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#6fd6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = (i / Math.max(1, values.length - 1)) * (ctx.canvas.width - 20) + 10;
    const y = ctx.canvas.height - 20 - (Math.max(0, v) / Math.max(1, Math.max(...values,1))) * (ctx.canvas.height - 40);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  if(values.length) ctx.stroke();
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff";
  ctx.font = "12px sans-serif";
  ctx.fillText(labelText, 10, 14);
  values.slice(-5).forEach((v,i)=>ctx.fillText(formatter(v), 10 + i*80, ctx.canvas.height - 6));
}
function drawAdminGraphs(){
  const hist = getSubjectHistory();
  const cpsVals = hist.map(x => x.cognitivePerformanceScore).filter(v => v != null);
  const spfVals = hist.map(x => x.samnPerelli ? x.samnPerelli.score : null).filter(v => v != null);
  drawLineChart(aCtx, cpsVals, "CPS over sessions", v => Number(v).toFixed(0));
  drawLineChart(fCtx, spfVals, "S-PF over sessions", v => String(v));
}

$("subjectNextBtn").addEventListener("click", ()=>{
  const raw = $("subjectIdInput").value.trim();
  if(raw === "0"){
    state.subjectId = "0";
    $("subjectOverlay").classList.add("hidden");
    $("fatigueOverlay").classList.remove("hidden");
    setStatus("Guest session");
    return;
  }
  if(!/^[A-Za-z0-9]{6}$/.test(raw)){
    setStatus("ID must be 6 letters/numbers, or 0 for Guest");
    return;
  }
  state.subjectId = raw.toUpperCase();
  $("subjectOverlay").classList.add("hidden");
  $("fatigueOverlay").classList.remove("hidden");
  setStatus(`Subject ID set: ${state.subjectId}`);
});

$("unlockBtn").addEventListener("click", ()=>{
  if($("adminPass").value === settings.adminPasscode){
    $("adminGate").classList.add("hidden");
    $("adminBody").classList.remove("hidden");
    renderAdmin();
    setStatus("Admin unlocked");
  } else {
    setStatus("Incorrect passcode");
  }
});
$("closeAdminBtn").addEventListener("click", ()=>{$("adminOverlay").classList.add("hidden");});
$("closeAdminBtn2").addEventListener("click", ()=>{$("adminOverlay").classList.add("hidden");});
$("saveAdminBtn").addEventListener("click", ()=>{readAdmin(); saveSettings(); renderAdmin(); setStatus("Admin settings saved");});
$("resetAdminBtn").addEventListener("click", ()=>{resetAdmin(); setStatus("Admin settings reset");});
$("exportAdminBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify({settings, subjectHistory:getSubjectHistory()}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_admin_export.json";
  a.click();
});

titleHold.addEventListener("click", ()=>{
  titleTapCount += 1;
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(()=>{ titleTapCount = 0; }, 1200);
  if(titleTapCount >= 5){
    titleTapCount = 0;
    $("adminOverlay").classList.remove("hidden");
    $("adminGate").classList.remove("hidden");
    $("adminBody").classList.add("hidden");
    $("adminPass").value = "";
    setStatus("Admin access");
  }
});

document.getElementById("startBtn").addEventListener("click", startTest);
document.getElementById("exportBtn").addEventListener("click", exportResults);
document.getElementById("emailBtn").addEventListener("click", emailResults);

window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); deferredPrompt=e; $("installBtn").disabled=false; });
$("installBtn").addEventListener("click", async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; });
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js")); }

renderFatigueChecklist();
applyTheme();
probeCircle.textContent = "Ready";
updateMetrics();
