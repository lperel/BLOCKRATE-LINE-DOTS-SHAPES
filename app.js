const SETTINGS = {
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

const SHAPES = ["square","triangle","diamond","hexagon","star","pentagon"];
const SYMBOLS = ["•","••","•••","—","——","|||","• —","— •","• |","| •","• •","| |"];
const SAMN_PERELLI = [
  [7, "Full alert, wide awake"],
  [6, "Very lively, responsive, but not at peak"],
  [5, "Okay, about normal"],
  [4, "Less than sharp, let down"],
  [3, "Feeling dull, losing focus"],
  [2, "Very difficult to concentrate, groggy"],
  [1, "Unable to function, ready to drop"]
];

const state = {
  phase: "idle",
  duration: SETTINGS.startDurationMs,
  blockDuration: null,
  current: null,
  previous: null,
  unresolvedStreak: 0,
  overloads: [],
  recoveries: [],
  recoveryCorrectCompleted: 0,
  liveData: [],
  history: JSON.parse(localStorage.getItem("blockrate_shape_match_v5_history") || "[]"),
  oneBackCount: 0,
  onTimeCount: 0,
  totalTrials: 0,
  trialTimer: null,
  absoluteNoResponseTimer: null,
  lastBlockGap: null,
  qualifyingBlockPair: null,
  endReason: "",
  lastFiveAnswers: [],
  samnPerelli: null
};

let deferredPrompt = null;

const probeCircle = document.getElementById("probeCircle");
const upperEl = document.getElementById("upper");
const buttonsEl = document.getElementById("buttons");
const rateOut = document.getElementById("rateOut");
const blocksOut = document.getElementById("blocksOut");
const recoveryOut = document.getElementById("recoveryOut");
const gapOut = document.getElementById("gapOut");
const wrongOut = document.getElementById("wrongOut");
const fatigueOut = document.getElementById("fatigueOut");
const statusLine = document.getElementById("statusLine");
const resultBox = document.getElementById("resultBox");
const phaseLabel = document.getElementById("phaseLabel");
const liveChart = document.getElementById("liveChart");
const lctx = liveChart.getContext("2d");
const installBtn = document.getElementById("installBtn");
const fatigueOverlay = document.getElementById("fatigueOverlay");
const fatigueList = document.getElementById("fatigueList");

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(v,lo,hi){ return Math.min(hi, Math.max(lo,v)); }
function median(arr){ if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function pickDistinctSymbols(count){ return shuffle(SYMBOLS).slice(0,count); }
function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function renderFatigueChecklist(){
  fatigueList.innerHTML = "";
  for(const [score, label] of SAMN_PERELLI){
    const btn = document.createElement("button");
    btn.className = "fatigueItem";
    btn.textContent = `${score}. ${label}`;
    btn.addEventListener("click", ()=>{
      state.samnPerelli = { score, label };
      fatigueOut.textContent = String(score);
      fatigueOverlay.classList.add("hidden");
      resultBox.textContent = `Samn–Perelli fatigue rating selected: ${score} — ${label}`;
      setStatus("Fatigue rating recorded");
    });
    fatigueList.appendChild(btn);
  }
}

function shapeSvg(shapeId, symbolText=""){
  const shapeClass='class="shapeStroke"';
  const text = symbolText ? `<text x="50" y="56" text-anchor="middle" class="symbolTxt">${escapeHtml(symbolText)}</text>` : "";
  let shape="";
  if(shapeId==="square") shape=`<rect x="18" y="18" width="64" height="64" ${shapeClass}/>`;
  if(shapeId==="triangle") shape=`<polygon points="50,15 84,82 16,82" ${shapeClass}/>`;
  if(shapeId==="diamond") shape=`<polygon points="50,12 86,50 50,88 14,50" ${shapeClass}/>`;
  if(shapeId==="hexagon") shape=`<polygon points="30,18 70,18 88,50 70,82 30,82 12,50" ${shapeClass}/>`;
  if(shapeId==="star") shape=`<polygon points="50,14 58,38 84,38 63,53 71,79 50,63 29,79 37,53 16,38 42,38" ${shapeClass}/>`;
  if(shapeId==="pentagon") shape=`<polygon points="50,12 85,38 70,85 30,85 15,38" ${shapeClass}/>`;
  return `<div class="shapeHolder"><svg class="shapeSvg" viewBox="0 0 100 100" aria-hidden="true">${shape}${text}</svg></div>`;
}

function setStatus(msg){ statusLine.textContent = msg; }
function clearTimer(){ if(state.trialTimer) clearTimeout(state.trialTimer); state.trialTimer = null; }
function clearNoResponseTimer(){ if(state.absoluteNoResponseTimer) clearTimeout(state.absoluteNoResponseTimer); state.absoluteNoResponseTimer = null; }
function armNoResponseTimer(){
  clearNoResponseTimer();
  state.absoluteNoResponseTimer = setTimeout(()=>{
    state.endReason = `No response for more than ${SETTINGS.noResponseTimeoutMs} ms`;
    finish();
  }, SETTINGS.noResponseTimeoutMs);
}
function noteAnyResponse(){ armNoResponseTimer(); }

function makeTrial(kind){
  const upperShapes = shuffle(SHAPES);
  const lowerShapes = shuffle(SHAPES);
  const correctUpperIndex = randInt(0,5);
  const correctShapeId = upperShapes[correctUpperIndex];
  const upperSymbols = pickDistinctSymbols(6);
  const targetSymbol = upperSymbols[correctUpperIndex];
  return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()), kind, upperShapes, upperSymbols, lowerShapes, targetSymbol, correctShapeId, resolved:false };
}
function renderProbe(trial){ probeCircle.textContent = trial.targetSymbol; }
function renderUpper(trial){
  upperEl.innerHTML = "";
  for(let i=0;i<6;i++){
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.shape = trial.upperShapes[i];
    cell.innerHTML = shapeSvg(trial.upperShapes[i], trial.upperSymbols[i]);
    upperEl.appendChild(cell);
  }
}
function renderButtons(trial){
  buttonsEl.innerHTML = "";
  for(let i=0;i<6;i++){
    const btn = document.createElement("div");
    btn.className = "btncell";
    btn.dataset.shape = trial.lowerShapes[i];
    btn.innerHTML = shapeSvg(trial.lowerShapes[i], "");
    btn.addEventListener("click", ()=>handleTap(i));
    buttonsEl.appendChild(btn);
  }
}
function drawLive(){
  lctx.clearRect(0,0,liveChart.width,liveChart.height);
  lctx.strokeStyle = "#6fd6ff";
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
function recordAnswer(isCorrect){
  state.lastFiveAnswers.push(isCorrect);
  if(state.lastFiveAnswers.length > SETTINGS.wrongWindowSize) state.lastFiveAnswers.shift();
  updateMetrics();
  const wrongCount = state.lastFiveAnswers.filter(v=>v===false).length;
  if(state.lastFiveAnswers.length === SETTINGS.wrongWindowSize && wrongCount > SETTINGS.wrongThresholdStop){
    clearTimer(); clearNoResponseTimer();
    state.phase = "finished";
    state.endReason = `More than ${SETTINGS.wrongThresholdStop} wrong answers out of the last ${SETTINGS.wrongWindowSize} answers. Restart required.`;
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
  renderProbe(state.current);
  renderUpper(state.current);
  renderButtons(state.current);
  updateMetrics();
  drawLive();
  if (kind === "paced"){
    phaseLabel.textContent = `Paced · ${Math.round(state.duration)} ms`;
    setStatus("Machine-paced");
    state.trialTimer = setTimeout(onPacedFrameEnd, state.duration);
  } else if (kind === "recovery"){
    phaseLabel.textContent = `Recovery ${state.recoveryCorrectCompleted + 1}/${SETTINGS.recoveryCorrectTrials}`;
    setStatus("Self-paced recovery");
  } else if (kind === "terminal_recovery"){
    phaseLabel.textContent = `Final recovery ${state.recoveryCorrectCompleted + 1}/${SETTINGS.recoveryCorrectTrials}`;
    setStatus("Stable blocking gap found");
  }
}
function trialMatches(trial, chosenShapeId){ return trial && chosenShapeId === trial.correctShapeId; }
function maybeTriggerTerminalRule(){
  if(state.overloads.length < 2) return false;
  const n = state.overloads.length;
  const gap = Math.abs(state.overloads[n-1] - state.overloads[n-2]);
  state.lastBlockGap = gap;
  updateMetrics();
  if(gap < SETTINGS.qualifyingBlockGapMs){
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
  const chosenShapeId = buttonsEl.children[index].dataset.shape;

  if(state.phase === "recovery" || state.phase === "terminal_recovery"){
    const ok = trialMatches(state.current, chosenShapeId);
    if(recordAnswer(ok)) return;
    if(ok){
      state.current.resolved = true;
      state.recoveryCorrectCompleted += 1;
      if(state.recoveryCorrectCompleted >= SETTINGS.recoveryCorrectTrials){
        if(state.phase === "terminal_recovery"){
          state.endReason = `Completed ${SETTINGS.recoveryCorrectTrials} final self-paced trials after consecutive blocks under ${SETTINGS.qualifyingBlockGapMs} ms apart`;
          finish(); return;
        }
        state.recoveries.push(state.blockDuration + SETTINGS.resumeSlowerByMs);
        state.phase = "paced";
        state.duration = clamp(state.blockDuration + SETTINGS.resumeSlowerByMs, SETTINGS.minDurationMs, SETTINGS.maxDurationMs);
        setTimeout(()=>openTrial("paced"), 180);
      } else {
        setTimeout(()=>openTrial(state.phase), 160);
      }
    } else {
      setTimeout(()=>openTrial(state.phase), 160);
    }
    return;
  }

  if(state.previous && state.previous.kind==="paced" && !state.previous.resolved && trialMatches(state.previous, chosenShapeId)){
    state.previous.resolved = true;
    state.oneBackCount += 1;
    if(recordAnswer(true)) return;
    return;
  }
  if(state.current && state.current.kind==="paced" && !state.current.resolved && trialMatches(state.current, chosenShapeId)){
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
  if(state.unresolvedStreak >= SETTINGS.consecutiveMissesForBlock){
    state.blockDuration = state.duration;
    state.overloads.push(state.blockDuration);
    state.unresolvedStreak = 0;
    if(maybeTriggerTerminalRule()) return;
    state.phase = "recovery";
    state.recoveryCorrectCompleted = 0;
    openTrial("recovery");
    return;
  }
  state.duration = clamp(state.duration * SETTINGS.speedupFactor, SETTINGS.minDurationMs, SETTINGS.maxDurationMs);
  if(state.totalTrials >= SETTINGS.maxTrialCount){ state.endReason = "Reached trial cap"; finish(); }
  else openTrial("paced");
}
function finish(){
  clearTimer(); clearNoResponseTimer();
  state.phase = "finished";
  const overloadAvg = median(state.overloads) || state.duration;
  const recoveryAvg = median(state.recoveries) || (overloadAvg + SETTINGS.resumeSlowerByMs);
  let threshold = (overloadAvg + recoveryAvg) / 2;
  if(state.qualifyingBlockPair) threshold = (state.qualifyingBlockPair[0] + state.qualifyingBlockPair[1]) / 2;
  const fatigueText = state.samnPerelli ? `${state.samnPerelli.score} — ${state.samnPerelli.label}` : "not recorded";
  resultBox.textContent =
`Themed V5 skin applied.

Task logic:
- target symbol in center
- find matching symbol in upper shapes
- press same shape below

Subjective fatigue:
Samn–Perelli = ${fatigueText}

Threshold:
${threshold.toFixed(1)} ms

End reason:
${state.endReason || "Run complete"}`;
}
function exportResults(){
  const blob = new Blob([JSON.stringify({history:state.history, version:"shape-match-v5-fatigue", samnPerelli:state.samnPerelli}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_shape_match_v5_fatigue_results.json";
  a.click();
}
function emailResults(){
  const body = encodeURIComponent(JSON.stringify({version:"shape-match-v5-fatigue", samnPerelli:state.samnPerelli}, null, 2));
  window.location.href = `mailto:?subject=BlockRate Shape Match V5&body=${body}`;
}
function startTest(){
  if(!state.samnPerelli){
    fatigueOverlay.classList.remove("hidden");
    setStatus("Select Samn–Perelli fatigue rating first");
    return;
  }
  clearTimer(); clearNoResponseTimer();
  state.phase = "paced";
  state.duration = SETTINGS.startDurationMs;
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
  resultBox.textContent = `Samn–Perelli fatigue rating selected: ${state.samnPerelli.score} — ${state.samnPerelli.label}`;
  noteAnyResponse();
  openTrial("paced");
}

document.getElementById("startBtn").addEventListener("click", startTest);
document.getElementById("exportBtn").addEventListener("click", exportResults);
document.getElementById("emailBtn").addEventListener("click", emailResults);

window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); deferredPrompt=e; installBtn.disabled=false; });
installBtn.addEventListener("click", async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; });
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js")); }

renderFatigueChecklist();
probeCircle.textContent = "Ready";
updateMetrics();
