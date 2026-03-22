// BlockRate Debug Verifier
// ----------------------------------------------------------
// This build is not a timing test.
// It is a visual/debug tool used to verify that each trial
// has exactly one correct answer before restoring pacing.
//
// User request incorporated here:
// "dots and lines should be intermixed in the left screen"
// So the 6 items in the upper field are a deliberate mixture
// of dot patterns and line patterns.
// ----------------------------------------------------------

const SHAPES = ["square","triangle_down","diamond","pentagon","hexagon","triangle_up"];

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

let currentTrial = null;

const $ = id => document.getElementById(id);
const probeCircle = $("probeCircle");
const upperEl = $("upper");
const buttonsEl = $("buttons");
const debugBox = $("debugBox");
const statusLine = $("statusLine");

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function patternFamily(pattern){
  return pattern.some(x => x[0] === "dot") ? "dots" : "lines";
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

function validateTrial(trial){
  // Exactly one upper item must have the target count AND the opposite family.
  const matches = trial.upperItems
    .map((item, idx) => ({idx, count:item.count, family:item.family}))
    .filter(x => x.count === trial.targetCount && x.family === trial.matchFamily);

  if (matches.length !== 1) {
    return { ok:false, reason:`Expected exactly 1 match, got ${matches.length}`, matches };
  }

  const correctUpperIndex = matches[0].idx;
  const correctUpperShape = trial.upperShapes[correctUpperIndex];

  // That shape must appear exactly once below.
  const lowerShapeCount = trial.lowerShapes.filter(s => s === correctUpperShape).length;
  if (lowerShapeCount !== 1) {
    return { ok:false, reason:`Correct lower shape count is ${lowerShapeCount}, expected 1`, matches, correctUpperIndex, correctUpperShape };
  }

  return {
    ok:true,
    reason:"PASS",
    correctUpperIndex,
    correctUpperShape,
    correctLowerIndex: trial.lowerShapes.findIndex(s => s === correctUpperShape),
    matches
  };
}

function makeMixedUpperItems(targetCount, matchFamily){
  // Build upper field with mixed dot and line items.
  // Exactly one item will match by count+family.
  const correctIndex = randInt(0,5);
  const upperItems = new Array(6);

  // Place exact matching item.
  upperItems[correctIndex] = {
    count: targetCount,
    family: matchFamily,
    pattern: matchFamily === "dots" ? DOT_PATTERNS[targetCount] : LINE_PATTERNS[targetCount]
  };

  // Fill others with non-matching count+family combinations.
  for(let i=0;i<6;i++){
    if(i === correctIndex) continue;
    let placed = false;
    for(let attempts=0; attempts<200 && !placed; attempts++){
      const count = randInt(1,6);
      const family = Math.random() < 0.5 ? "dots" : "lines";
      // Reject any item that would accidentally create another valid match.
      if(count === targetCount && family === matchFamily) continue;
      upperItems[i] = {
        count,
        family,
        pattern: family === "dots" ? DOT_PATTERNS[count] : LINE_PATTERNS[count]
      };
      placed = true;
    }
  }

  return { upperItems, correctIndex };
}

function makeTrial(){
  for(let attempt=0; attempt<300; attempt++){
    const targetFamily = Math.random() < 0.5 ? "dots" : "lines";
    const matchFamily = targetFamily === "dots" ? "lines" : "dots";
    const targetCount = randInt(1,6);

    const upperShapes = shuffle(SHAPES);
    const lowerShapes = shuffle(SHAPES);

    const { upperItems } = makeMixedUpperItems(targetCount, matchFamily);

    const trial = {
      targetFamily,
      matchFamily,
      targetCount,
      targetPattern: targetFamily === "dots" ? DOT_PATTERNS[targetCount] : LINE_PATTERNS[targetCount],
      upperShapes,
      lowerShapes,
      upperItems
    };

    const validation = validateTrial(trial);
    if(validation.ok){
      trial.validation = validation;
      return trial;
    }
  }
  throw new Error("Could not generate valid trial");
}

function renderProbe(trial){
  probeCircle.innerHTML = `<svg class="shapeSvg" viewBox="0 0 100 100">${
    trial.targetPattern.map(item => {
      const [kind,x,y] = item;
      if(kind==="dot") return `<circle cx="${x}" cy="${y}" r="6.8" fill="var(--text)"/>`;
      if(kind==="v") return `<rect x="${x-3.5}" y="${y-16}" width="7" height="32" fill="var(--text)"/>`;
      if(kind==="h") return `<rect x="${x-16}" y="${y-3.5}" width="32" height="7" fill="var(--text)"/>`;
      return "";
    }).join("")
  }</svg>`;
}

function renderUpper(trial){
  upperEl.innerHTML = "";
  trial.upperItems.forEach((item, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = shapeSvg(trial.upperShapes[i], item.pattern);
    upperEl.appendChild(cell);
  });
}

function renderButtons(trial){
  buttonsEl.innerHTML = "";
  trial.lowerShapes.forEach((shape, i) => {
    const btn = document.createElement("div");
    btn.className = "btncell";
    btn.dataset.shape = shape;
    btn.innerHTML = shapeSvg(shape, null);
    btn.addEventListener("click", () => {
      const isCorrect = i === trial.validation.correctLowerIndex;
      statusLine.innerHTML = isCorrect
        ? `<span class="ok">Clicked CORRECT lower shape: ${shape}</span>`
        : `<span class="bad">Clicked WRONG lower shape: ${shape}</span>`;
    });
    buttonsEl.appendChild(btn);
  });
}

function describeTrial(trial, reveal=false){
  const v = trial.validation;
  let txt = "";
  txt += `VALIDATION: ${v.ok ? "PASS" : "FAIL"}\n`;
  txt += `Target family: ${trial.targetFamily}\n`;
  txt += `Target count: ${trial.targetCount}\n`;
  txt += `Required matching family in upper field: ${trial.matchFamily}\n\n`;

  txt += `Upper field contents (left screen, intermixed dots + lines):\n`;
  trial.upperItems.forEach((item, i) => {
    txt += `  [${i}] shape=${trial.upperShapes[i]} family=${item.family} count=${item.count}\n`;
  });

  txt += `\nLower response shapes:\n`;
  trial.lowerShapes.forEach((shape, i) => {
    txt += `  [${i}] shape=${shape}\n`;
  });

  if(reveal){
    txt += `\nCORRECT ANSWER:\n`;
    txt += `  upper index = ${v.correctUpperIndex}\n`;
    txt += `  upper shape = ${v.correctUpperShape}\n`;
    txt += `  lower index = ${v.correctLowerIndex}\n`;
    txt += `  lower shape = ${trial.lowerShapes[v.correctLowerIndex]}\n`;
  } else {
    txt += `\nCORRECT ANSWER: hidden\n`;
  }

  return txt;
}

function newTrial(){
  currentTrial = makeTrial();
  renderProbe(currentTrial);
  renderUpper(currentTrial);
  renderButtons(currentTrial);
  debugBox.textContent = describeTrial(currentTrial, false);
  statusLine.textContent = "New validated trial generated.";
}

function validateMany(n=100){
  let failures = 0;
  let lastError = "";
  for(let i=0;i<n;i++){
    try{
      const t = makeTrial();
      if(!t.validation.ok){
        failures += 1;
        lastError = t.validation.reason;
      }
    }catch(e){
      failures += 1;
      lastError = e.message;
    }
  }
  statusLine.innerHTML = failures === 0
    ? `<span class="ok">Validated ${n} trials successfully.</span>`
    : `<span class="bad">${failures} failures out of ${n}. Last error: ${lastError}</span>`;
}

document.getElementById("newTrialBtn").addEventListener("click", newTrial);
document.getElementById("showAnswerBtn").addEventListener("click", () => {
  if(!currentTrial) return;
  debugBox.textContent = describeTrial(currentTrial, true);
});
document.getElementById("run100Btn").addEventListener("click", () => validateMany(100));
document.getElementById("clearBtn").addEventListener("click", () => {
  statusLine.textContent = "";
  debugBox.textContent = "Cleared.";
});

newTrial();
