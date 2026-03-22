const DEFAULTS = {
  adminPasscode: "4822",
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

let settings = loadSettings();

const SHAPES = ["square","triangle_down","diamond","pentagon","hexagon","triangle_up"];
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
  history: JSON.parse(localStorage.getItem("blockrate_restored_4x4_probe_upgrade_history") || "[]"),
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
  subjectId: null
};

const $ = id => document.getElementById(id);
const combinedGrid = $("combinedGrid");
const rateOut=$("rateOut"), blocksOut=$("blocksOut"), recoveryOut=$("recoveryOut"), gapOut=$("gapOut"), wrongOut=$("wrongOut"), fatigueOut=$("fatigueOut"), cpsOut=$("cpsOut");
const statusLine=$("statusLine"), resultBox=$("resultBox"), phaseLabel=$("phaseLabel"), modeLabel=$("modeLabel");
const liveChart=$("liveChart"), lctx=liveChart.getContext("2d");
const adminChart=$("adminChart"), aCtx=adminChart.getContext("2d"), fatigueChart=$("fatigueChart"), fCtx=fatigueChart.getContext("2d");
let deferredPrompt = null;

function loadSettings(){
  const saved = JSON.parse(localStorage.getItem("blockrate_restored_4x4_probe_upgrade_settings") || "null");
  return saved ? {...DEFAULTS, ...saved} : {...DEFAULTS};
}
function saveSettings(){ localStorage.setItem("blockrate_restored_4x4_probe_upgrade_settings", JSON.stringify(settings)); }
function subjectKey(id){ return id === "0" ? "Guest" : id; }
function getSubjectHistory(){ return state.history.filter(x => x.subjectId === subjectKey(state.subjectId || "0")); }
function computeCPS(avgMs){ return Math.max(0, Math.min(100, ((3000 - avgMs) / 2000) * 100)); }
function updateCPSDisplay(avgLast2){ cpsOut.textContent = avgLast2 != null ? computeCPS(avgLast2).toFixed(0) : "—"; }

function renderAdmin(){
  const wrap = $("adminSettings");
  wrap.innerHTML = "";
  for(const [key,label,type] of ADMIN_FIELDS){
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<label>${label}<div class="hint">${key}</div></label><input id="adm_${key}" type="${type}" value="${settings[key]}">`;
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
  if(shapeId==="triangle_down") shape=`<polygon points="50,85 84,18 16,18" ${shapeClass}/>`;
  if(shapeId==="diamond") shape=`<polygon points="50,12 86,50 50,88 14,50" ${shapeClass}/>`;
  if(shapeId==="pentagon") shape=`<polygon points="50,10 85,36 72,84 28,84 15,36" ${shapeClass}/>`;
  if(shapeId==="hexagon") shape=`<polygon points="28,18 72,18 88,50 72,82 28,82 12,50" ${shapeClass}/>`;
  if(shapeId==="triangle_up") shape=`<polygon points="50,15 84,82 16,82" ${shapeClass}/>`;
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
function patternSvg(pattern){
  return `<div class="shapeHolder"><svg class="shapeSvg" viewBox="0 0 100 100">${
    pattern.map(item => {
      const [kind,x,y] = item;
      if(kind==="dot") return `<circle cx="${x}" cy="${y}" r="6.8" fill="var(--text)"/>`;
      if(kind==="v") return `<rect x="${x-3.5}" y="${y-16}" width="7" height="32" fill="var(--text)"/>`;
      if(kind==="h") return `<rect x="${x-16}" y="${y-3.5}" width="32" height="7" fill="var(--text)"/>`;
      return "";
    }).join("")
  }</svg></div>`;
}

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(v,lo,hi){ return Math.min(hi, Math.max(lo,v)); }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function validateTrial(trial){
  const countMatches = trial.upperItems.filter(x => x.count === trial.targetCount).length;
  if (countMatches !== 1) return false;
  const upperCount = trial.upperShapes.filter(s => s === trial.correctShapeId).length;
  const lowerCount = trial.lowerShapes.filter(s => s === trial.correctShapeId).length;
  if (upperCount !== 1 || lowerCount !== 1) return false;
  const correctIdx = trial.upperShapes.findIndex(s => s === trial.correctShapeId);
  if (correctIdx < 0) return false;
  if (trial.upperItems[correctIdx].count !== trial.targetCount) return false;
  return true;
}

function makeTrial(kind){
  for(let attempt=0; attempt<200; attempt++){
    const upperShapes = shuffle(SHAPES);
    const lowerShapes = shuffle(SHAPES);
    const family = Math.random() < 0.5 ? "dotsToLines" : "linesToDots";
    const targetCount = randInt(1,6);
    const correctUpperIndex = randInt(0,5);
    const correctShapeId = upperShapes[correctUpperIndex];
    const counts = shuffle([1,2,3,4,5,6]);
    const upperItems = counts.map(count => ({
      count,
      pattern: family === "dotsToLines" ? LINE_PATTERNS[count] : DOT_PATTERNS[count]
    }));
    const existingIndex = upperItems.findIndex(x => x.count === targetCount);
    [upperItems[correctUpperIndex], upperItems[existingIndex]] = [upperItems[existingIndex], upperItems[correctUpperIndex]];
    const targetPattern = family === "dotsToLines" ? DOT_PATTERNS[targetCount] : LINE_PATTERNS[targetCount];
    const trial = { kind, upperShapes, lowerShapes, targetPattern, upperItems, correctShapeId, targetCount, resolved:false };
    if (validateTrial(trial)) return trial;
  }
  throw new Error("Unable to generate valid trial");
}

function renderCombinedGrid(trial){
  combinedGrid.innerHTML = "";
  const slots = new Array(16).fill(null).map(() => ({type:"empty"}));
  const positions = shuffle([...Array(16).keys()]);
  const probePos = positions[0];
  const upperPos = positions.slice(1,7);
  const lowerPos = positions.slice(7,13);

  slots[probePos] = {type:"probe", pattern: trial.targetPattern};
  for(let i=0;i<6;i++) slots[upperPos[i]] = {type:"stimulus", shape: trial.upperShapes[i], pattern: trial.upperItems[i].pattern};
  for(let i=0;i<6;i++) slots[lowerPos[i]] = {type:"answer", shape: trial.lowerShapes[i], index:i};

  slots.forEach(slot => {
    const el = document.createElement("div");
    el.className = "slot";
    if(slot.type === "probe"){
      el.classList.add("probe");
      el.innerHTML = `<div class="probeTag">TARGET</div>${patternSvg(slot.pattern)}`;
    } else if(slot.type === "stimulus"){
      el.innerHTML = shapeSvg(slot.shape, slot.pattern);
    } else if(slot.type === "answer"){
      el.classList.add("answer");
      el.dataset.index = String(slot.index);
      el.dataset.shape = slot.shape;
      el.innerHTML = shapeSvg(slot.shape, null);
      el.addEventListener("click", ()=>handleTap(slot.index));
    }
    combinedGrid.appendChild(el);
  });
}

function drawLive(){
  lctx.clearRect(0,0,liveChart.width,liveChart.height);
  lctx.strokeStyle = "#67c6ff";
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

function isSelfPacedPhase(){
  return state.phase === "recovery" || state.phase === "terminal_recovery";
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
  state.current = makeTrial(kind);
  renderCombinedGrid(state.current);
  updateMetrics();
  drawLive();

  if(kind === "paced"){
    phaseLabel.textContent = `Paced · ${Math.round(state.duration)} ms`;
    setStatus("Machine-paced");
    state.trialTimer = setTimeout(onPacedFrameEnd, state.duration);
  } else if(kind === "recovery"){
    phaseLabel.textContent = `Recovery ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Self-paced recovery — waiting for response");
  } else if(kind === "terminal_recovery"){
    phaseLabel.textContent = `Final recovery ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Self-paced final recovery — waiting for response");
  }
}

function trialMatches(trial, index){
  const chosenShapeId = trial.lowerShapes[index];
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

  if(state.phase === "recovery" || state.phase === "terminal_recovery"){
    clearTimer();
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
  if(isSelfPacedPhase()) return;
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
  if(state.totalTrials >= settings.maxTrialCount){
    state.endReason = "Reached trial cap";
    finish();
  } else {
    openTrial("paced");
  }
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
    samnPerelli: state.samnPerelli,
    blocks: [...state.overloads],
    averageLast2BlockingScoresMs: avg2,
    cognitivePerformanceScore: cps,
    endReason: state.endReason || "Run complete",
    time: new Date().toISOString()
  };
  state.history.push(result);
  localStorage.setItem("blockrate_restored_4x4_probe_upgrade_history", JSON.stringify(state.history));
  updateCPSDisplay(avg2);
  const fatigueText = state.samnPerelli ? `${state.samnPerelli.score} — ${state.samnPerelli.label}` : "not recorded";
  resultBox.textContent =
`Probe-upgraded 4×4 build active.

Subject ID:
${result.subjectId}

Samn–Perelli:
${fatigueText}

Average of last 2 blocking scores:
${avg2 != null ? avg2.toFixed(1) + " ms" : "—"}

Cognitive Performance Score (CPS):
${cps != null ? cps.toFixed(1) : "—"}   (1000 ms = 100, 3000 ms = 0)

End reason:
${result.endReason}`;
}

function exportResults(){
  const blob = new Blob([JSON.stringify({settings, history:state.history}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_restored_4x4_probe_upgrade_results.json";
  a.click();
}
function emailResults(){
  const last = state.history[state.history.length-1] || {};
  const body = encodeURIComponent(JSON.stringify(last, null, 2));
  window.location.href = `mailto:?subject=BlockRate 4x4 Probe Upgrade&body=${body}`;
}

function drawLineChart(ctx, values, labelText, formatter){
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.strokeStyle = "#67c6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const maxVal = Math.max(...values, 1);
    const x = (i / Math.max(1, values.length - 1)) * (ctx.canvas.width - 20) + 10;
    const y = ctx.canvas.height - 20 - (Math.max(0, v) / maxVal) * (ctx.canvas.height - 40);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  if(values.length) ctx.stroke();
  ctx.fillStyle = "#eef7ff";
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
  const last = hist.length ? hist[hist.length-1] : null;
  $("last2AvgBox").textContent = last && last.averageLast2BlockingScoresMs != null
    ? `Latest exact last-2-block average: ${last.averageLast2BlockingScoresMs.toFixed(1)} ms`
    : "Latest exact last-2-block average: —";
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
  resultBox.textContent = `Probe-upgraded 4×4 test started. Self-paced phases now wait for response input.\nSubject ID: ${subjectKey(state.subjectId)}\nSamn–Perelli: ${state.samnPerelli.score} — ${state.samnPerelli.label}`;
  noteAnyResponse();
  openTrial("paced");
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
$("adminOpenBtn").addEventListener("click", ()=>{
  $("adminOverlay").classList.remove("hidden");
  $("adminGate").classList.remove("hidden");
  $("adminBody").classList.add("hidden");
  $("adminPass").value = "";
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
$("saveAdminBtn").addEventListener("click", ()=>{ readAdmin(); saveSettings(); renderAdmin(); setStatus("Admin settings saved"); });
$("resetAdminBtn").addEventListener("click", ()=>{ resetAdmin(); setStatus("Admin settings reset"); });
$("exportAdminBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify({settings, subjectHistory:getSubjectHistory()}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_restored_4x4_probe_upgrade_admin_export.json";
  a.click();
});
$("startBtn").addEventListener("click", startTest);
$("exportBtn").addEventListener("click", exportResults);
$("emailBtn").addEventListener("click", emailResults);
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); deferredPrompt=e; $("installBtn").disabled=false; });
$("installBtn").addEventListener("click", async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; });
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js")); }

modeLabel.textContent = "Subject mode";
renderFatigueChecklist();
updateMetrics();
