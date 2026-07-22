/* ==========================================================
   Walkie-Talkie Translator — app logic
   Depends on data.js (LANGUAGES, PHRASEBOOK, PHRASES, WORDS) being
   loaded first.
========================================================== */

/* =========================================================
   LANGUAGES
========================================================= */
const APP_VERSION = '2026.07.19-r2';

function showToast(message, type){
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeOut');
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

// Turns a raw HTTP status (+ optionally the response body, only used for
// console logging by the caller) into a short, friendly Burmese message.
// The raw JSON never reaches the chat bubble — only this classification does.
/**
 * Free fallback translation via MyMemory — no API key needed at all, works
 * directly from the browser (CORS-enabled). Used automatically when Gemini
 * is unreachable or every configured key has hit its quota. Quality is
 * noticeably below Gemini (crowdsourced translation memory + basic MT),
 * but it handles arbitrary sentences — unlike the offline dictionary,
 * which only matches known phrases. Returns null on any failure so the
 * caller can fall through to the offline dictionary as the last resort.
 */
async function translateViaMyMemory(text, sourceCode, targetCode){
  if(!text || !text.trim()) return null;
  try{
    const params = new URLSearchParams({
      q: text.slice(0, 490), // MyMemory's free tier caps ~500 bytes per request
      langpair: `${sourceCode}|${targetCode}`,
    });
    if(state.myMemoryEmail) params.set('de', state.myMemoryEmail);
    const resp = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
    if(!resp.ok) return null;
    const data = await resp.json();
    const result = data && data.responseData && data.responseData.translatedText;
    if(!result) return null;
    // MyMemory returns plain-English warning strings (not an HTTP error)
    // when a language pair is unsupported or the daily limit is hit.
    if(/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET) LANGUAGE|AMOUNT OF WORDS/i.test(result)) return null;
    // MyMemory's match score (0–1) reflects how close the crowdsourced TM
    // entry actually is to the input. Low-confidence matches can come back
    // completely unrelated to what was said (seen in testing: an unrelated
    // English sentence for ordinary Burmese conversation) — showing that as
    // if it were a real translation is worse than falling through to the
    // offline dictionary, so reject anything below a reasonable bar.
    const match = Number(data?.responseData?.match);
    if(!isNaN(match) && match < 0.6) return null;
    return result;
  }catch(e){
    console.error('MyMemory fallback failed:', e);
    return null;
  }
}

/**
 * Shared fallback chain used whenever Gemini is unavailable/exhausted:
 * try free key-less MyMemory first (handles arbitrary sentences), then the
 * offline phrase dictionary as the last resort. sourceCode can be
 * 'autodetect' for Quick Translate, where the source language isn't known.
 */
async function fallbackTranslateChain(text, sourceCode, targetCode){
  if(state.myMemoryEnabled && !state.offlineForced){
    const mm = await translateViaMyMemory(text, sourceCode, targetCode);
    if(mm) return { text: mm, approx: true, usedMyMemory: true };
  }
  if(sourceCode !== 'autodetect'){
    const off = offlineTranslate(text, sourceCode, targetCode);
    if(off) return { text: off.text, approx: off.approx, usedMyMemory: false };
  } else {
    // Quick Translate doesn't know the source language — try the offline
    // dictionary assuming each known language as a possible source.
    for(const l of LANGUAGES){
      if(l.code === targetCode) continue;
      const off = offlineTranslate(text, l.code, targetCode);
      if(off) return { text: off.text, approx: off.approx, usedMyMemory: false };
    }
  }
  return null;
}

function friendlyApiError(status){
  if(status === 429) return '⏳ AI quota ကုန်သွားပါပြီ (daily limit) — offline dictionary နဲ့ ပြန်ပြထားပါတယ်';
  if(status === 401 || status === 403) return '🔑 API key မှားနေနိုင်ပါတယ် — Settings → Account မှာ key ပြန်စစ်ပေးပါ';
  if(status >= 500) return '☁️ Google AI server ခဏပြဿနာ ရှိနေပါတယ် — ခဏနေ ထပ်စမ်းကြည့်ပါ';
  return '⚠️ AI ဆက်သွယ်လို့ မရပါ — offline dictionary နဲ့ ပြန်ပြထားပါတယ်';
}


function tmNormalize(text){
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[။၊.,!?]+$/g, '');
}
function tmKey(srcCode, tgtCode, text){
  return srcCode + '|' + tgtCode + '|' + tmNormalize(text);
}
function tmLookup(srcCode, tgtCode, text){
  return translationMemory[tmKey(srcCode, tgtCode, text)] || null;
}
function tmSave(srcCode, tgtCode, original, translated){
  if(!original || !translated) return;
  translationMemory[tmKey(srcCode, tgtCode, original)] = translated;
  try{
    const keys = Object.keys(translationMemory);
    // Keep the memory from growing without bound on very long-lived installs.
    if(keys.length > 600){
      keys.slice(0, keys.length - 600).forEach(k => delete translationMemory[k]);
    }
    localStorage.setItem('wt_translationMemory', JSON.stringify(translationMemory));
  }catch(e){ /* storage full or unavailable — memory still works for this session */ }
}

function offlineTranslate(rawText, srcCode, tgtCode){
  const norm = rawText.trim();
  if(!norm) return null;
  const normLower = norm.toLowerCase();

  // 1) Exact phrase match
  for(const p of PHRASES){
    const src = (p[srcCode] || '').trim();
    if(src && (src === norm || src.toLowerCase() === normLower)){
      return {text: p[tgtCode], approx:false};
    }
  }

  // 2) Substring phrase match (longest phrases first)
  const sortedPhrases = [...PHRASES].sort((a,b)=> (b[srcCode]||'').length - (a[srcCode]||'').length);
  for(const p of sortedPhrases){
    const src = (p[srcCode] || '').trim();
    if(src.length >= 3){
      const srcLower = src.toLowerCase();
      if(normLower.includes(srcLower) || srcLower.includes(normLower)){
        return {text: p[tgtCode], approx:false};
      }
    }
  }

  // 3) Compositional greedy word-by-word matching
  const dict = [...PHRASES, ...WORDS]
    .filter(d => d[srcCode] && d[tgtCode])
    .sort((a,b)=> (b[srcCode]||'').length - (a[srcCode]||'').length);

  let i = 0;
  const lowerNorm = normLower;
  const outParts = [];
  let matchedAny = false;

  while(i < norm.length){
    let matched = null;
    for(const d of dict){
      const src = d[srcCode].trim();
      if(!src) continue;
      if(lowerNorm.startsWith(src.toLowerCase(), i)){
        matched = d;
        break;
      }
    }
    if(matched){
      outParts.push(matched[tgtCode]);
      i += matched[srcCode].trim().length;
      matchedAny = true;
      while(i < norm.length && /\s/.test(norm[i])) i++;
    } else {
      i++;
    }
  }

  if(matchedAny && outParts.length){
    const wordCount = norm.split(/\s+/).filter(Boolean).length;
    // For anything longer than a couple of words, a sparse word-by-word
    // dictionary match is more likely to be confusing/wrong than helpful —
    // better to admit it couldn't translate than show a garbled fragment.
    if(wordCount > 4 && outParts.length < Math.ceil(wordCount / 2)){
      return null;
    }
    return {text: outParts.join(' '), approx:true};
  }
  return null;
}

/* =========================================================
   STATE
========================================================= */
const state = {
  langA: langByCode('en'),
  langB: langByCode('my'),
  messages: [], // newest first
  apiKey: '',
  apiKeys: ['', '', ''], // up to 3 keys; state.apiKey mirrors apiKeys[apiKeyIndex]
  apiKeyIndex: 0,
  myMemoryEnabled: true,
  myMemoryEmail: '',
  offlineForced: false,
  listening: {A:false, B:false},
  translating: {A:false, B:false},
  autoConversation: false,
  speechRate: 0.85,
  autoSpeak: true,
  showTranslatedOut: true,
  lastSent: {A: null, B: null},
  lightTheme: false,
  tone: 'neutral',
  glossary: '',
  saveHistory: false,
  voiceEngine: 'auto',
  currentView: 'home',
  backendMode: 'key',
  proxyUrl: '',
};

function otherSide(side){ return side === 'A' ? 'B' : 'A'; }

/**
 * Gboard-style "voice typing" for a text field: tapping the mic dictates
 * INTO the box (live, word-by-word) instead of immediately translating —
 * the person can review and edit before pressing Send. This is separate
 * from the tap-mic/Hold-to-Talk buttons, which translate right away; this
 * one is for when accuracy matters enough to want a last look first.
 * Free — same on-device SpeechRecognition as the rest of the app.
 */
function attachDictation(inputEl, micBtnEl, getLang){
  if(!SpeechRec){ micBtnEl.style.display = 'none'; return; }
  let rec = null;
  let listening = false;
  let baseValue = '';
  let finalText = '';

  micBtnEl.addEventListener('click', () => {
    if(listening){ try{ rec.stop(); }catch(e){} return; }
    if('speechSynthesis' in window) window.speechSynthesis.cancel();
    const lang = getLang();
    try{
      rec = new SpeechRec();
      rec.lang = lang.ttsLocale;
      rec.continuous = true;
      rec.interimResults = true;
      baseValue = inputEl.value ? inputEl.value.trim() + ' ' : '';
      finalText = '';
      listening = true;
      micBtnEl.classList.add('dictating');
      rec.onresult = (e) => {
        let interim = '';
        for(let i = e.resultIndex; i < e.results.length; i++){
          if(e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
          else interim += e.results[i][0].transcript;
        }
        inputEl.value = (baseValue + finalText + interim).trim();
      };
      rec.onerror = (e) => {
        if(e.error === 'not-allowed' || e.error === 'permission-denied'){
          showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။', 'error');
        }
      };
      rec.onend = () => {
        listening = false;
        micBtnEl.classList.remove('dictating');
      };
      rec.start();
    }catch(e){
      listening = false;
      micBtnEl.classList.remove('dictating');
    }
  });
}



/* =========================================================
   SPEECH: STT + TTS (Web Speech API)
========================================================= */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRec) {
  recognition = new SpeechRec();
  recognition.continuous = false;
  recognition.interimResults = false;
}

let cachedVoices = [];
function loadVoices(){
  if('speechSynthesis' in window){
    cachedVoices = window.speechSynthesis.getVoices();
  }
}
if('speechSynthesis' in window){
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice(localeCode){
  if(!cachedVoices.length) loadVoices();
  let v = cachedVoices.find(v => v.lang === localeCode);
  if(!v) v = cachedVoices.find(v => v.lang.toLowerCase() === localeCode.toLowerCase());
  if(!v) v = cachedVoices.find(v => v.lang.split('-')[0] === localeCode.split('-')[0]);
  return v || null;
}

// Lets the person directly see (in Settings → Voice) whether the phone has
// found a usable Myanmar voice — instead of guessing why audio does or
// doesn't cost an API call.
function updateVoiceDiag(){
  const el = document.getElementById('voiceDiag');
  if(!el) return;
  const myLang = langByCode('my') || { ttsLocale: 'my-MM' };
  const v = pickVoice(myLang.ttsLocale);
  el.textContent = v
    ? `✅ ဖုန်းမှာ မြန်မာ voice တွေ့ပါတယ် ("${v.name}") — Auto/Device mode မှာ API မကုန်ဘဲ အသံထွက်ပါလိမ့်မယ်`
    : '⚠️ ဖုန်းမှာ မြန်မာ voice မတွေ့သေးပါ — Settings → System → Text-to-speech output မှာ preferred engine ကို SM Myanmar TTS ပြောင်းထားလား စစ်ကြည့်ပါ';
}

document.getElementById('testVoiceBtn')?.addEventListener('click', () => {
  const myLang = langByCode('my') || { ttsLocale: 'my-MM', name: 'Myanmar' };
  const sample = 'မင်္ဂလာပါ၊ ဒါက အသံစမ်းသပ်ချက်ပါ';
  const engine = state.voiceEngine || 'auto';
  const willUseDevice = engine === 'device' || (engine === 'auto' && pickVoice(myLang.ttsLocale));
  showToast(willUseDevice ? '📱 Device voice ကို စမ်းနေပါတယ်...' : '🤖 AI voice ကို စမ်းနေပါတယ် (API 1 ကြိမ်သုံးပါမယ်)...', 'info');
  speak(sample, myLang);
});

function startStt(side){
  if(!recognition){
    showToast('ဒီ browser မှာ voice recognition ကို support မလုပ်ပါ။ Chrome browser သုံးကြည့်ပါ။', 'error');
    return;
  }
  // Interrupt any playback so listening starts immediately (feels faster)
  if('speechSynthesis' in window) window.speechSynthesis.cancel();

  const lang = side === 'A' ? state.langA : state.langB;
  recognition.lang = lang.ttsLocale;
  recognition.continuous = false;
  recognition.interimResults = false;
  state.listening[side] = true;
  renderPanel(side);
  renderStatusBar();

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if(text && text.trim()) handleTranslation(text, side, true);
  };
  recognition.onerror = (e) => {
    stopStt();
    if(e.error === 'not-allowed' || e.error === 'permission-denied'){
      state.autoConversation = false; // can't run hands-free without mic access
      renderStatusBar();
      showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။ Browser setting ထဲမှာ mic ခွင့်ပြုပေးပါ။', 'error');
    }
    // Other errors (e.g. 'no-speech') fail silently so Auto Chat doesn't spam alerts.
  };
  // Auto-stop as soon as the browser detects the person paused speaking —
  // no need to hold the button, this makes back-and-forth chat much faster.
  recognition.onspeechend = () => { try{ recognition.stop(); }catch(e){} };
  recognition.onend = () => { stopStt(); };

  try{ recognition.start(); } catch(e){ stopStt(); }
}
function stopStt(){
  state.listening.A = false;
  state.listening.B = false;
  renderPanel('A'); renderPanel('B');
  renderStatusBar();
}
function updateHoldCaption(side, text){
  const el = document.getElementById('pttCaption' + side);
  if(!el) return;
  el.textContent = text || '🎙️ Listening...';
  el.classList.add('show');
}
function clearHoldCaption(side){
  const el = document.getElementById('pttCaption' + side);
  if(!el) return;
  el.classList.remove('show');
  el.textContent = '';
}

function stopSttManual(){
  if(recognition){ try{ recognition.stop(); }catch(e){} }
  stopStt();
}

/* =========================================================
   HOLD-TO-TALK (Conversation screen, A/B)
   Hold the mic → free on-device SpeechRecognition transcribes live,
   writing straight into the visible text field as you speak (Gboard-style)
   → release → whatever's in the field is sent immediately. The language
   for each side is already known (state.langA/state.langB), so there's no
   need to send audio to Gemini just to figure out what was said.
   Quick Translate's Hold-to-Talk is different (see startHoldRecordingAudio
   below) because it doesn't know the source language in advance.
========================================================= */
const holdRecordingState = {}; // side -> { stream, mediaRecorder, chunks, mimeType }

/* =========================================================
   LIVE MODE — real-time simultaneous interpretation via the
   Gemini Live API (WebSocket, raw PCM audio streaming both ways).
   This is a fundamentally different, lower-level pipeline than the
   rest of the app (which uses simple HTTP calls) — it's the same
   technology behind Gemini's own "Live" voice mode. Configured here
   as a pure interpreter: it only translates what it hears, nothing else.

   NOTE (v1): only works in "My Own Key" backend mode — the bundled
   Secure Proxy (Cloudflare Worker) only relays simple HTTP requests,
   not WebSocket streams. Also requires internet the whole time it's on.
========================================================= */
const liveState = {
  ws: null,
  connected: false,
  micStream: null,
  micContext: null,
  micProcessor: null,
  playbackContext: null,
  nextPlayTime: 0,
};

function floatTo16BitPCM(float32Array){
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for(let i = 0, offset = 0; i < float32Array.length; i++, offset += 2){
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}
function arrayBufferToBase64(buffer){
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for(let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function pcm16Base64ToAudioBuffer(base64, audioCtx, sampleRate){
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.length / 2);
  const buffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  for(let i = 0; i < sampleCount; i++) channelData[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}
function scheduleLivePlayback(base64){
  const ctx = liveState.playbackContext;
  if(!ctx) return;
  const buffer = pcm16Base64ToAudioBuffer(base64, ctx, 24000);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const now = ctx.currentTime;
  if(liveState.nextPlayTime < now) liveState.nextPlayTime = now;
  source.start(liveState.nextPlayTime);
  liveState.nextPlayTime += buffer.duration;
}

function liveInterpreterSystemPrompt(){
  return `You are a real-time simultaneous interpreter for a live face-to-face conversation between two people speaking into the same device. `
    + `One person speaks ${state.langA.name}, the other speaks ${state.langB.name}. `
    + `Whenever you hear ${state.langA.name} being spoken, immediately speak the natural, fluent translation in ${state.langB.name} — nothing else. `
    + `Whenever you hear ${state.langB.name} being spoken, immediately speak the natural, fluent translation in ${state.langA.name} — nothing else. `
    + `Translate the way a professional human interpreter would say it, not word-for-word. `
    + `Do NOT have a conversation, do NOT answer questions, do NOT add commentary, greetings, or explanations of any kind — output ONLY the translation of what was actually said. `
    + `Wait for a natural pause or the end of a sentence before translating.`;
}

function updateLiveStatusText(text){
  const el = document.getElementById('liveStatusText');
  if(el) el.textContent = text;
}

async function startLiveMode(){
  if(state.backendMode === 'proxy'){
    showToast('Live Mode က "My Own Key" backend mode မှာသာ အလုပ်လုပ်ပါတယ် (v1) — Settings → Account ထဲမှာ ပြောင်းပေးပါ', 'warn');
    return;
  }
  if(!state.apiKey){
    showToast('Live Mode အတွက် AI Translation Key လိုအပ်ပါတယ်', 'warn');
    return;
  }
  try{
    if(!localStorage.getItem('wt_liveKeyWarningSeen')){
      showToast('⚠️ Live Mode မှာ AI Translation Key ကို Google ဆီ တိုက်ရိုက် ချိတ်ဆက်ဖို့ အသုံးပြုပါတယ် — public/shared device မှာ သတိထားပါ', 'warn');
      localStorage.setItem('wt_liveKeyWarningSeen', '1');
    }
  }catch(e){}
  document.getElementById('liveBtn').classList.add('on');
  document.getElementById('liveStatusBar').classList.add('show');
  document.getElementById('liveStartBtn').classList.add('on');
  document.getElementById('liveBigHint').textContent = 'Connecting…';
  updateLiveStatusText('⚡ Live Interpreter connecting…');
  liveAddTranscriptLine('system', 'Connecting…');

  try{
    liveState.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }catch(e){
    showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်', 'error');
    stopLiveMode();
    return;
  }

  const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${state.apiKey}`);
  liveState.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: liveInterpreterSystemPrompt() }] },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      }
    }));
  };

  ws.onerror = () => {
    showToast('Live Mode connection error ဖြစ်သွားပါတယ်', 'error');
  };

  ws.onclose = () => {
    if(liveState.connected) showToast('Live Mode connection ပြတ်တောက်သွားပါတယ်', 'warn');
    stopLiveMode();
  };

  ws.onmessage = async (event) => {
    let data = event.data;
    if(data instanceof Blob) data = await data.text();
    let msg;
    try{ msg = JSON.parse(data); }catch(e){ return; }

    if(msg.setupComplete){
      liveState.connected = true;
      const statusMsg = '⚡ Live — listening… (both sides can speak anytime)';
      updateLiveStatusText(statusMsg);
      document.getElementById('liveBigHint').textContent = 'Listening… tap to stop';
      liveAddTranscriptLine('system', 'Connected — start speaking, either language.');
      document.getElementById('liveBtn').classList.add('pulsing');
      startLiveMicCapture();
      return;
    }

    const sc = msg.serverContent;
    if(!sc) return;

    if(sc.interrupted){
      liveState.nextPlayTime = liveState.playbackContext ? liveState.playbackContext.currentTime : 0;
    }
    if(sc.modelTurn && sc.modelTurn.parts){
      for(const part of sc.modelTurn.parts){
        const inline = part.inlineData || part.inline_data;
        if(inline && inline.data) scheduleLivePlayback(inline.data);
      }
    }
    if(sc.inputTranscription && sc.inputTranscription.text){
      updateLiveStatusText('🎙️ ' + sc.inputTranscription.text);
      liveAddTranscriptLine('heard', sc.inputTranscription.text);
    }
    if(sc.outputTranscription && sc.outputTranscription.text){
      updateLiveStatusText('🔊 ' + sc.outputTranscription.text);
      liveAddTranscriptLine('spoken', sc.outputTranscription.text);
    }
  };
}

function liveInitLangSelects(){
  const selA = document.getElementById('liveLangA');
  const selB = document.getElementById('liveLangB');
  if(!selA || !selB) return;
  selA.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('');
  selB.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('');
  selA.value = state.langA.code;
  selB.value = state.langB.code;
  selA.addEventListener('change', (e) => {
    state.langA = langByCode(e.target.value);
    renderPanel('A'); renderPanel('B');
  });
  selB.addEventListener('change', (e) => {
    state.langB = langByCode(e.target.value);
    renderPanel('A'); renderPanel('B');
  });
}

let liveTranscriptHasContent = false;
function liveAddTranscriptLine(kind, text){
  const el = document.getElementById('liveTranscript');
  if(!el) return;
  if(!liveTranscriptHasContent){ el.innerHTML = ''; liveTranscriptHasContent = true; }
  const line = document.createElement('div');
  line.className = 'liveTranscriptLine ' + kind;
  const icon = kind === 'heard' ? '🎙️' : kind === 'spoken' ? '🔊' : 'ℹ️';
  line.innerHTML = `<span class="liveLineIcon">${icon}</span><span>${escapeHtml(text)}</span>`;
  el.insertBefore(line, el.firstChild);
}

document.getElementById('liveStartBtn').addEventListener('click', () => {
  if(liveState.ws || liveState.connected){
    stopLiveMode();
  } else {
    startLiveMode();
  }
});

function startLiveMicCapture(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  liveState.micContext = new AudioCtx({ sampleRate: 16000 });
  liveState.playbackContext = new AudioCtx({ sampleRate: 24000 });
  liveState.nextPlayTime = 0;

  const source = liveState.micContext.createMediaStreamSource(liveState.micStream);
  liveState.micProcessor = liveState.micContext.createScriptProcessor(4096, 1, 1);
  liveState.micProcessor.onaudioprocess = (e) => {
    if(!liveState.connected || !liveState.ws || liveState.ws.readyState !== WebSocket.OPEN) return;
    const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
    const b64 = arrayBufferToBase64(pcm);
    liveState.ws.send(JSON.stringify({
      realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${liveState.micContext.sampleRate}` } }
    }));
  };
  // Route through a silent gain node — some browsers require the processor
  // to reach a destination to keep firing, but we don't want to hear our
  // own raw mic input played back (that would cause feedback/echo).
  const muteGain = liveState.micContext.createGain();
  muteGain.gain.value = 0;
  source.connect(liveState.micProcessor);
  liveState.micProcessor.connect(muteGain);
  muteGain.connect(liveState.micContext.destination);
}

function stopLiveMode(){
  liveState.connected = false;
  if(liveState.ws){ try{ liveState.ws.close(); }catch(e){} liveState.ws = null; }
  if(liveState.micProcessor){ try{ liveState.micProcessor.disconnect(); }catch(e){} liveState.micProcessor = null; }
  if(liveState.micContext){ try{ liveState.micContext.close(); }catch(e){} liveState.micContext = null; }
  if(liveState.playbackContext){ try{ liveState.playbackContext.close(); }catch(e){} liveState.playbackContext = null; }
  if(liveState.micStream){ try{ liveState.micStream.getTracks().forEach(t => t.stop()); }catch(e){} liveState.micStream = null; }
  document.getElementById('liveBtn').classList.remove('on', 'pulsing');
  document.getElementById('liveStatusBar').classList.remove('show');
  const startBtn = document.getElementById('liveStartBtn');
  const hint = document.getElementById('liveBigHint');
  if(startBtn) startBtn.classList.remove('on');
  if(hint) hint.textContent = 'Tap to start Live Interpreter';
}

function pickAudioMimeType(){
  if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for(const c of candidates){ if(MediaRecorder.isTypeSupported(c)) return c; }
  return '';
}

// ---- Conversation screen (A/B) Hold-to-Talk: free, on-device transcription ----
// The language spoken on each side is already known (state.langA/state.langB),
// so there's no need to send audio to Gemini just to figure out what was
// said — the same free SpeechRecognition engine the tap-mic button already
// uses can transcribe it, and only the resulting TEXT (much cheaper, and
// reuses the existing cache/streaming/throttle path) goes to the API.
function startHoldRecording(side){
  if(side === 'QT') return startHoldRecordingAudio(side);
  if(!SpeechRec){
    showToast('ဒီ browser မှာ voice recognition ကို support မလုပ်ပါ။ Chrome ကို သုံးကြည့်ပါ။', 'error');
    return;
  }
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  const lang = side === 'A' ? state.langA : state.langB;
  const inputEl = document.getElementById('input'+side);
  try{
    const rec = new SpeechRec();
    rec.lang = lang.ttsLocale;
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for(let i = e.resultIndex; i < e.results.length; i++){
        if(e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if(inputEl) inputEl.value = (finalText + interim).trim();
    };
    rec.onerror = (e) => {
      if(e.error === 'not-allowed' || e.error === 'permission-denied'){
        showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။ Browser setting ထဲမှာ mic ခွင့်ပြုပေးပါ။', 'error');
      }
    };
    holdRecordingState[side] = { rec, getFinalText: () => finalText.trim() };
    rec.start();
  }catch(e){
    console.error('Hold-to-Talk speech recognition failed to start:', e);
    showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။', 'error');
  }
}

function stopHoldRecording(side){
  if(side === 'QT') return stopHoldRecordingAudio(side);
  const r = holdRecordingState[side];
  if(!r) return;
  const finish = () => {
    const text = r.getFinalText();
    delete holdRecordingState[side];
    // handleTranslation re-renders the panel (which naturally clears the
    // input), so nothing left over to wipe manually here.
    if(text) handleTranslation(text, side, true);
  };
  r.rec.onend = finish;
  try{ r.rec.stop(); }catch(e){ finish(); }
}

// ---- Quick Translate Hold-to-Talk: Gemini audio (needs language auto-detect) ----
// QT doesn't know what language you're about to speak, and SpeechRecognition
// has no reliable auto-detect — only sending the audio to Gemini can figure
// out the language AND transcribe it in one pass. This path is unchanged.
async function startHoldRecordingAudio(side){
  if(!window.MediaRecorder){
    showToast('ဒီ browser မှာ voice recording ကို support မလုပ်ပါ။ Chrome ကို သုံးကြည့်ပါ။', 'error');
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickAudioMimeType();
    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => { if(e.data && e.data.size > 0) chunks.push(e.data); };
    holdRecordingState[side] = { stream, mediaRecorder, chunks, mimeType: mediaRecorder.mimeType || mimeType || 'audio/webm' };
    mediaRecorder.start();
    startWaveform(side); // separate mic access purely for the visual bars; harmless in parallel
  }catch(e){
    console.error('Hold recording mic access failed:', e);
    showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။ Browser setting ထဲမှာ mic ခွင့်ပြုပေးပါ။', 'error');
    clearHoldCaption(side);
  }
}

function stopHoldRecordingAudio(side){
  const r = holdRecordingState[side];
  if(!r){ clearHoldCaption(side); return; }
  updateHoldCaption(side, '⏳ Processing...');

  const finish = (blob) => {
    try{ r.stream.getTracks().forEach(t => t.stop()); }catch(e){}
    delete holdRecordingState[side];
    if(!blob || blob.size < 500){
      // Too short / no audio actually captured — nothing to send.
      clearHoldCaption(side);
      return;
    }
    if(side === 'QT') qtHandleVoiceHold(blob);
  };

  if(r.mediaRecorder.state === 'inactive'){
    finish(new Blob(r.chunks, { type: r.mimeType }));
    return;
  }
  r.mediaRecorder.onstop = () => finish(new Blob(r.chunks, { type: r.mimeType }));
  try{ r.mediaRecorder.stop(); }catch(e){ finish(new Blob(r.chunks, { type: r.mimeType })); }
}


/* =========================================================
   WAVEFORM — real-time mic level visualization for Hold-to-Talk.
   Runs independently of SpeechRecognition (which manages its own mic
   access internally) via a separate getUserMedia + AnalyserNode, purely
   for the visual bars — so the person can see their voice is being
   picked up (and roughly how loud) while holding the button.
========================================================= */
const waveformState = {}; // side -> { stream, audioCtx, analyser, rafId, token }
let waveformTokenCounter = 0;
async function startWaveform(side){
  // Defense in depth: if a loop for this side is somehow still running
  // (e.g. overlapping press events), tear it down cleanly before starting
  // a fresh one, so we never have two draw() loops racing each other.
  stopWaveform(side);
  const myToken = ++waveformTokenCounter;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const bars = document.querySelectorAll('#waveform' + side + ' .wfBar');

    function draw(){
      // If this loop's generation has been superseded or torn down
      // (stopWaveform already ran), stop silently instead of crashing —
      // this is what actually fixes the infinite error loop.
      const current = waveformState[side];
      if(!current || current.token !== myToken) return;
      analyser.getByteFrequencyData(dataArray);
      bars.forEach((bar, i) => {
        const v = dataArray[i] || 0;
        const pct = Math.max(12, Math.min(100, (v / 255) * 100));
        bar.style.height = pct + '%';
        bar.classList.remove('idle');
      });
      current.rafId = requestAnimationFrame(draw);
    }
    waveformState[side] = { stream, audioCtx, analyser, rafId: null, token: myToken };
    draw();
  }catch(e){
    console.error('Waveform mic access failed:', e);
    // Non-fatal — Hold-to-Talk still works via SpeechRecognition even
    // without the visual waveform if mic permission/hardware has an issue.
  }
}
function stopWaveform(side){
  const w = waveformState[side];
  if(!w) return;
  if(w.rafId) cancelAnimationFrame(w.rafId);
  try{ w.stream.getTracks().forEach(t => t.stop()); }catch(e){}
  try{ w.audioCtx.close(); }catch(e){}
  delete waveformState[side];
  document.querySelectorAll('#waveform' + side + ' .wfBar').forEach(bar => {
    bar.style.height = '6px';
    bar.classList.add('idle');
  });
}

const ttsAudioCache = new Map(); // text -> object URL, avoids re-generating audio on repeat plays
let currentAudioEl = null;

// Mobile browsers block audio.play() unless it's tied to a recent user
// gesture. Auto-speak happens after a network round-trip (translation),
// so by the time we call play() the gesture has "expired" and it silently
// fails — meaning it only ever worked when someone tapped ▶ directly.
// Fix: the moment the person interacts with the page at all (tapping mic,
// send, camera, anything), we silently play a near-silent audio clip once.
// That grants this page "sticky" audio playback permission for the rest
// of the session, so later automatic TTS playback goes through normally.
let audioUnlocked = false;
function unlockAudioPlayback(){
  if(audioUnlocked) return;
  audioUnlocked = true;
  try{
    const silence = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
    silence.volume = 0.01;
    silence.play().catch(()=>{ audioUnlocked = false; });
  }catch(e){ audioUnlocked = false; }
  if(window.speechSynthesis){
    try{ window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); }catch(e){}
  }
}
['pointerdown','touchstart','click'].forEach(evt => {
  document.addEventListener(evt, unlockAudioPlayback, { once: true, passive: true });
});

function pcmBase64ToWavBlob(base64, sampleRate){
  const binary = atob(base64);
  const len = binary.length;
  const pcmBytes = new Uint8Array(len);
  for(let i = 0; i < len; i++) pcmBytes[i] = binary.charCodeAt(i);

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);   // block align
  view.setUint16(34, 16, true);  // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, len, true);

  return new Blob([header, pcmBytes], { type: 'audio/wav' });
}

/**
 * All Gemini calls go through this helper. In 'key' mode (default, current
 * behavior) it calls Google directly with the key stored on this device.
 * In 'proxy' mode it calls YOUR OWN backend (e.g. a Cloudflare Worker) which
 * holds the real API key server-side — the key never touches the client at
 * all, which is required before distributing this as a public APK/app.
 */
function hasBackend(){
  if(state.backendMode === 'proxy') return !!state.proxyUrl;
  return state.apiKeys.some(k => (k||'').trim()) || !!state.apiKey;
}

/**
 * ---- API usage guardrails ----
 * Free-tier Gemini quotas are mostly per-MINUTE request limits, so the
 * biggest risk isn't total volume — it's BURSTS (Auto Chat firing several
 * calls back-to-back, or a translate+verify+TTS combo landing in the same
 * second). apiThrottle() enforces a small minimum gap between outgoing
 * calls and automatically retries once (with a short backoff) on HTTP 429
 * instead of immediately giving up and falling back to the offline
 * dictionary — since a 429 is very often transient and gone half a second
 * later. sessionApiStats just counts calls so Settings can show the person
 * roughly how much they've used this session.
 */
const sessionApiStats = { calls: 0, retried: 0 };
let apiThrottleQueue = Promise.resolve();
const API_MIN_GAP_MS = 350;

/**
 * Rotates state.apiKey to the next configured (non-empty) key. Used when a
 * call comes back 429 (quota exceeded) — Google's free-tier quota is
 * per-project/per-account, so a second personal key has its own separate
 * allowance. Returns false if there's nothing else to rotate to (only one
 * key configured, or already cycled through all of them this call).
 */
function rotateApiKey(){
  const keys = state.apiKeys.map(k => (k||'').trim()).filter(Boolean);
  if(keys.length <= 1) return false;
  const currentPos = keys.indexOf(state.apiKey);
  const nextKey = keys[(currentPos + 1) % keys.length];
  if(nextKey === state.apiKey) return false;
  state.apiKey = nextKey;
  state.apiKeyIndex = state.apiKeys.findIndex(k => (k||'').trim() === nextKey);
  return true;
}

function apiThrottle(doFetch){
  const run = apiThrottleQueue.then(async () => {
    sessionApiStats.calls++;
    updateApiUsageBadge();
    let resp = await doFetch();
    const isRetryable = (r) => r && (r.status === 429 || r.status >= 500);
    const keyCount = state.apiKeys.filter(k => (k||'').trim()).length;
    let rotations = 0;
    while(isRetryable(resp) && rotations < keyCount - 1){
      sessionApiStats.retried++;
      if(!rotateApiKey()) break;
      showToast(resp.status === 429
        ? '🔄 Key quota ကုန်သွားလို့ backup key ကို ပြောင်းသုံးနေပါတယ်...'
        : '🔄 Server error ကြုံနေလို့ backup key ကို ပြောင်းစမ်းနေပါတယ်...', 'warn');
      resp = await doFetch();
      rotations++;
    }
    if(isRetryable(resp)){
      // Either only one key configured, or every key just failed the same
      // way — one short-wait retry in case it was transient (a burst limit,
      // or a brief Google server hiccup) rather than a hard/persistent error.
      sessionApiStats.retried++;
      await new Promise(r => setTimeout(r, 1200));
      resp = await doFetch();
    }
    return resp;
  });
  // Chain the next call after this one clears, with a small floor gap —
  // .catch keeps a failed call from wedging the whole queue.
  apiThrottleQueue = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, API_MIN_GAP_MS)));
  return run;
}

function updateApiUsageBadge(){
  const el = document.getElementById('apiUsageBadge');
  if(el) el.textContent = `ဒီ session မှာ AI call ${sessionApiStats.calls} ကြိမ်သုံးပြီးပါပြီ`;
}

async function geminiFetch(model, payload){
  if(state.backendMode === 'proxy' && state.proxyUrl){
    return apiThrottle(() => fetch(state.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, payload }),
    }));
  }
  return apiThrottle(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': state.apiKey,
    },
    body: JSON.stringify(payload),
  }));
}

/**
 * Streaming version: calls onChunk(textSoFar) every time more text arrives,
 * so the UI can show words appearing progressively instead of a blank
 * "translating…" bubble sitting there for several seconds. This is what
 * makes the app feel fast even when total generation time is unchanged —
 * the person sees something happening almost immediately.
 *
 * Falls back to a single non-streaming call automatically in Secure Proxy
 * mode (the bundled Cloudflare Worker doesn't pass through streams) or if
 * the browser/network doesn't support readable streams for some reason.
 */
async function geminiFetchStream(model, payload, onChunk){
  const useProxy = state.backendMode === 'proxy' && state.proxyUrl;
  if(useProxy || !window.ReadableStream){
    const resp = await geminiFetch(model, payload);
    if(!resp.ok) return { ok: false, status: resp.status, resp };
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const finishReason = data?.candidates?.[0]?.finishReason;
    if(text) onChunk(text);
    return { ok: true, fullText: text, finishReason };
  }

  let resp;
  try{
    resp = await apiThrottle(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
      body: JSON.stringify(payload),
    }));
  }catch(e){
    return { ok: false, error: e };
  }
  if(!resp.ok || !resp.body){
    return { ok: false, status: resp.status, resp };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason = null;

  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last (possibly incomplete) line carries over to next read
    for(const line of lines){
      const trimmed = line.trim();
      if(!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if(!jsonStr || jsonStr === '[DONE]') continue;
      try{
        const obj = JSON.parse(jsonStr);
        const piece = obj?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if(piece){ fullText += piece; onChunk(fullText); }
        if(obj?.candidates?.[0]?.finishReason) finishReason = obj.candidates[0].finishReason;
      }catch(e){ /* partial/incomplete JSON line — wait for more data */ }
    }
  }
  return { ok: true, fullText, finishReason };
}

async function speakViaGemini(text, onDone){
  try{
    let url = ttsAudioCache.get(text);
    if(!url){
      const resp = await geminiFetch('gemini-3.1-flash-tts-preview', {
        contents: [{ parts: [{ text: text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          maxOutputTokens: 8192,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
      });
      if(!resp.ok) throw new Error('TTS API ' + resp.status);
      const data = await resp.json();
      const finishReason = data?.candidates?.[0]?.finishReason;
      if(finishReason === 'MAX_TOKENS'){
        console.error('Gemini TTS truncated (MAX_TOKENS) for text length', text.length);
        throw new Error('TTS truncated — text too long for one request');
      }
      const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
      const inline = part?.inlineData || part?.inline_data;
      if(!inline?.data) throw new Error('No audio in TTS response');
      const wavBlob = pcmBase64ToWavBlob(inline.data, 24000);
      url = URL.createObjectURL(wavBlob);
      ttsAudioCache.set(text, url);
      // Cap the cache so long sessions don't accumulate unlimited audio blobs in memory.
      if(ttsAudioCache.size > 60){
        const oldestKey = ttsAudioCache.keys().next().value;
        const oldestUrl = ttsAudioCache.get(oldestKey);
        try{ URL.revokeObjectURL(oldestUrl); }catch(e){}
        ttsAudioCache.delete(oldestKey);
      }
    }

    if(currentAudioEl){ try{ currentAudioEl.pause(); }catch(e){} }
    const audio = new Audio(url);
    audio.playbackRate = state.speechRate;
    currentAudioEl = audio;
    let fired = false;
    const finish = () => { if(fired) return; fired = true; if(onDone) onDone(); };
    audio.onended = finish;
    audio.onerror = finish;
    await audio.play();
    return true;
  } catch(e){
    console.error('Gemini TTS failed, falling back to device voice:', e);
    return false;
  }
}

function speakLocal(text, lang, onDone){
  if(!('speechSynthesis' in window) || !text){ if(onDone) onDone(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang.ttsLocale);
  if(voice){ u.voice = voice; u.lang = voice.lang; }
  else { u.lang = lang.ttsLocale; }
  u.rate = state.speechRate;
  let fired = false;
  const finish = () => { if(fired) return; fired = true; if(onDone) onDone(); };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.speak(u);
}

async function speak(text, lang, onDone){
  if(!text){ if(onDone) onDone(); return; }
  if('speechSynthesis' in window) window.speechSynthesis.cancel();

  // Voice Engine preference (Settings): 'device' forces the phone's built-in
  // voice only; 'ai' forces Gemini's voice only; 'auto' (default) now tries
  // the FREE device voice first whenever the phone actually has one for this
  // language, and only spends a Gemini API call when it doesn't (e.g. many
  // phones lack a Myanmar voice). This cuts TTS-related API usage sharply
  // for well-supported languages, since every Play tap and every Auto Chat
  // turn used to cost a Gemini call regardless of what the phone could
  // already do for free.
  const engine = state.voiceEngine || 'auto';

  if(engine === 'device'){
    speakLocal(text, lang, onDone);
    return;
  }

  const canUseAi = !state.offlineForced && hasBackend();

  if(engine === 'auto' && pickVoice(lang.ttsLocale)){
    speakLocal(text, lang, onDone);
    return;
  }

  if(engine === 'ai' && !canUseAi){
    showToast('AI Voice အတွက် Internet/API Key လိုအပ်ပါတယ် — device voice ကို ယာယီသုံးပါမယ်', 'warn');
  }

  if(canUseAi){
    const ok = await speakViaGemini(text, onDone);
    if(ok) return;
    if(engine === 'ai'){
      showToast('AI Voice မရနိုင်ပါ — device voice ကို ယာယီသုံးပါမယ်', 'warn');
    }
  }
  speakLocal(text, lang, onDone);
}

/* =========================================================
   TRANSLATION (Gemini API, natural/context-aware, with
   advanced offline fallback)
========================================================= */
function toneInstruction(){
  if(state.tone === 'formal') return 'Use a formal, respectful, professional register appropriate for business or official contexts.';
  if(state.tone === 'casual') return 'Use a casual, friendly, relaxed everyday tone, like talking to a close friend.';
  return 'Use a natural, neutral everyday tone — polite but not overly formal, not overly casual.';
}
function glossaryInstruction(){
  if(!state.glossary) return '';
  const terms = state.glossary.split('\n').map(t => t.trim()).filter(Boolean);
  if(!terms.length) return '';
  return `\nThese specific words/names must be kept EXACTLY as written in the original, never translated: ${terms.join(', ')}.\n`;
}
function conversationContextBlock(){
  const recent = state.messages.slice(0, 5).filter(m => !m.pending).reverse();
  if(!recent.length) return '';
  const lines = recent.map(m => `${m.sender === 'A' ? 'Person A' : 'Person B'}: ${m.originalText}`).join('\n');
  return `\nRecent conversation so far (for context only — helps with pronouns/references like "he/she/it/that"; do NOT translate this part, only translate the new message below):\n${lines}\n`;
}

async function handleTranslation(rawText, sender, isVoice){
  rawText = (rawText || '').trim();
  if(!rawText) return;

  // Guard against accidental duplicate sends (double-tap Send, or Enter
  // firing twice) — ignore an identical message from the same side within
  // a short window rather than firing two API calls for it.
  const now = Date.now();
  if(state.lastSent[sender] && state.lastSent[sender].text === rawText && now - state.lastSent[sender].at < 1200){
    return;
  }
  state.lastSent[sender] = { text: rawText, at: now };

  const isA = sender === 'A';
  state.translating[sender] = true;

  // Clear the input immediately so the person can keep typing/talking
  // without waiting on the network — this is what makes chat feel fast.
  if(isA){ document.getElementById('inputA').value = ''; }
  else { document.getElementById('inputB').value = ''; }

  const sourceLang = isA ? state.langA : state.langB;
  const targetLang = isA ? state.langB : state.langA;

  // Optimistic bubble: show the original message right away, translation
  // fills in a moment later instead of the whole UI feeling frozen.
  const msgId = Date.now().toString();
  state.messages.unshift({
    id: msgId,
    sender,
    originalText: rawText,
    translatedText: '',
    isVoice: !!isVoice,
    approx: false,
    usedOffline: false,
    pending: true,
    timestamp: Date.now(),
  });
  renderPanel('A'); renderPanel('B');

  let translated = '';
  let approx = false;
  let usedOffline = false;
  let usedMyMemory = false;
  let errorDetail = '';

  async function fallbackOffline(prefix){
    usedOffline = true;
    const remembered = tmLookup(sourceLang.code, targetLang.code, rawText);
    if(remembered){
      translated = remembered;
      approx = false; // this is a real, previously-verified AI translation, not a guess
      return;
    }
    const result = await fallbackTranslateChain(rawText, sourceLang.code, targetLang.code);
    if(result){
      translated = result.text;
      approx = result.approx;
      usedMyMemory = result.usedMyMemory;
    } else {
      translated = `${prefix} ${rawText}`;
      approx = true;
    }
  }

  if(state.offlineForced || !hasBackend()){
    await fallbackOffline('[Offline]');
  } else {
    try{
      const prompt = `You are an expert interpreter helping two people communicate naturally in a live, real-time conversation. `
        + `Translate the following message from ${sourceLang.name} into ${targetLang.name}.\n\n`
        + `IMPORTANT: Do NOT translate word-for-word. Understand the full meaning, tone, and intent of the message, `
        + `then express it the way a native ${targetLang.name} speaker would naturally say it out loud in this real-life situation `
        + `(everyday / workplace conversation).\n\n`
        + `Tone: ${toneInstruction()}\n`
        + `${glossaryInstruction()}`
        + `${conversationContextBlock()}`
        + `\nRules:\n`
        + `- If translating into Burmese, use natural, everyday spoken Burmese (not overly formal/literary), unless Tone above says otherwise.\n`
        + `- If translating into Chinese, use the polite/respectful form (您) unless the tone is clearly casual.\n`
        + `- If translating into Thai, include natural polite particles (ครับ/ค่ะ) where appropriate.\n`
        + `- If translating into English, use natural, conversational English.\n\n`
        + `Return ONLY the translated sentence itself — no explanations, no notes, no quotation marks, no pronunciation guides.\n\n`
        + `Message to translate now: "${rawText}"`;

      // Tracks whether we've already done the one-time structural render
      // that swaps the "translating…" spinner for the real text+controls
      // markup. Doing a full renderPanel() on EVERY streamed chunk (the
      // old behavior) destroys and rebuilds ~15 DOM nodes and re-attaches
      // ~10 event listeners per panel per chunk — on a busy stream that's
      // dozens of synchronous reflows a second, which can starve the
      // browser's paint cycle so intermediate text never actually gets
      // drawn on screen (it looks like streaming "doesn't work" and the
      // text just pops in at the end). We now do that heavy rebuild only
      // once (to create the elements), then patch text directly for every
      // subsequent chunk — cheap enough to paint every frame.
      let streamStructureReady = false;
      const streamResult = await geminiFetchStream('gemini-3.5-flash', {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: 'minimal' }
        }
      }, (partialText) => {
        // Progressive update: show words as they arrive instead of a blank
        // "translating…" bubble sitting there for several seconds.
        const liveMsg = state.messages.find(m => m.id === msgId);
        if(!liveMsg) return;
        liveMsg.translatedText = partialText;
        liveMsg.pending = false;
        if(!streamStructureReady){
          streamStructureReady = true;
          renderPanel('A'); renderPanel('B');
        } else {
          patchStreamingText(msgId, partialText);
        }
      });

      if(streamResult.ok){
        const text = (streamResult.fullText || '').trim();
        if(text){
          translated = text;
          tmSave(sourceLang.code, targetLang.code, rawText, translated);
        }
        else {
          errorDetail = 'AI ကနေ အဖြေ မရနိုင်ပါ — offline dictionary နဲ့ ပြန်ပြထားပါတယ်';
          console.error('Gemini empty response for streamed request');
          await fallbackOffline('[Empty response]');
        }
      } else {
        let bodyText = '';
        try{ bodyText = streamResult.resp ? await streamResult.resp.text() : ''; }catch(e2){}
        errorDetail = friendlyApiError(streamResult.status);
        console.error('Gemini API error:', streamResult.status, bodyText);
        await fallbackOffline('[Network Error]');
      }
    } catch(e){
      errorDetail = 'Internet connection မရပါ — Wi-Fi/mobile data စစ်ကြည့်ပါ';
      console.error('Gemini fetch failed:', e);
      await fallbackOffline('[Error Connection]');
    }
  }

  const msg = state.messages.find(m => m.id === msgId);
  if(msg){
    msg.translatedText = translated;
    msg.approx = approx;
    msg.usedOffline = usedOffline;
    msg.usedMyMemory = usedMyMemory;
    msg.errorDetail = errorDetail;
    msg.pending = false;
  }

  state.translating[sender] = false;
  renderPanel('A'); renderPanel('B');
  vibrate(15);

  const continueAutoConversation = () => {
    // Auto Chat: once the translation has been spoken to the other person,
    // automatically open their mic so they can reply hands-free — like a
    // real walkie-talkie back-and-forth, no extra taps needed.
    if(state.autoConversation){
      const replySide = otherSide(sender);
      if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){
        setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350);
      }
    }
  };

  if(state.autoSpeak){
    speak(translated, targetLang, continueAutoConversation);
  } else {
    continueAutoConversation();
  }
}

/* =========================================================
   SCAN & TRANSLATE (camera photo -> Gemini vision OCR + natural translation)
========================================================= */
let currentScanSide = null;

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function scanAndTranslate(file, side){
  const isA = side === 'A';
  const sourceLang = isA ? state.langA : state.langB;
  const targetLang = isA ? state.langB : state.langA;

  if(state.offlineForced || !hasBackend()){
    showToast('Scan feature အတွက် AI Translation Key လိုအပ်ပါတယ်။ Settings ထဲမှာ ထည့်ပေးပါ။', 'warn');
    return;
  }

  state.translating[side] = true;
  const scanMsgId = Date.now().toString();
  state.messages.unshift({
    id: scanMsgId,
    sender: side,
    originalText: '(scanning photo…)',
    translatedText: '',
    isVoice: false,
    isScan: true,
    approx: false,
    usedOffline: false,
    pending: true,
    timestamp: Date.now(),
  });
  renderPanel('A'); renderPanel('B');

  try{
    const base64 = await fileToBase64(file);
    const isImage = file.type && file.type.startsWith('image/');
    const photoUrl = isImage ? `data:${file.type};base64,${base64}` : null;
    const prompt = `This file (a photo or PDF document — a sign, label, document, screen, form, or handwriting) contains visible text, likely in ${sourceLang.name} but it could be in any language. `
      + `Step 1: Read every piece of text visible exactly as written (if it's a multi-page PDF, read all pages). `
      + `Step 2: Translate it into natural, fluent, native-sounding ${targetLang.name} — translate the full meaning and intent the way a native speaker would actually say it, NOT word-for-word. `
      + `Tone: ${toneInstruction()} `
      + `${glossaryInstruction()}`
      + `Respond in EXACTLY this format with no extra commentary:\n`
      + `ORIGINAL: <the text you read>\n`
      + `TRANSLATED: <the natural translation into ${targetLang.name}>`;

    const resp = await geminiFetch('gemini-3.5-flash', {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'minimal' },
        // Medium resolution keeps text OCR-readable while cutting image
        // token processing (and therefore latency) noticeably vs default.
        mediaResolution: 'MEDIA_RESOLUTION_MEDIUM'
      }
    });

    if(!resp.ok){
      let bodyText = '';
      try{ bodyText = await resp.text(); }catch(e2){}
      console.error('Gemini scan API error:', resp.status, bodyText);
      showToast(`Scan translation မအောင်မြင်ပါ (Error ${resp.status})`, 'error');
      state.messages = state.messages.filter(m => m.id !== scanMsgId);
      state.translating[side] = false;
      renderPanel('A'); renderPanel('B');
      return;
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
    const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATED:/i);
    const transMatch = raw.match(/TRANSLATED:\s*([\s\S]*)/i);
    const originalText = origMatch ? origMatch[1].trim() : '(scanned image)';
    const translatedText = transMatch ? transMatch[1].trim() : raw;

    const scanMsg = state.messages.find(m => m.id === scanMsgId);
    if(scanMsg){
      scanMsg.originalText = originalText;
      scanMsg.translatedText = translatedText;
      scanMsg.photoUrl = photoUrl;
      scanMsg.pending = false;
    }

    state.translating[side] = false;
    renderPanel('A'); renderPanel('B');

    const continueAutoConversation = () => {
      if(state.autoConversation){
        const replySide = otherSide(side);
        if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){
          setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350);
        }
      }
    };

    if(state.autoSpeak){
      speak(translatedText, targetLang, continueAutoConversation);
    } else {
      continueAutoConversation();
    }
    return;
  } catch(e){
    console.error('Gemini scan fetch failed:', e);
    showToast(`Scan translation အမှားတစ်ခုဖြစ်သွားပါတယ်: ${e.message}`, 'error');
    state.messages = state.messages.filter(m => m.id !== scanMsgId);
  }

  state.translating[side] = false;
  renderPanel('A'); renderPanel('B');
}

document.getElementById('scanInput').addEventListener('change', (e)=>{
  const file = e.target.files && e.target.files[0];
  if(file && currentScanSide){
    scanAndTranslate(file, currentScanSide);
  }
  e.target.value = '';
});

/* =========================================================
   RENDERING
========================================================= */
function svgMic(){return `<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>`;}
function svgKeyboard(){return `<svg viewBox="0 0 24 24"><path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zM7 8h2v2H7V8zm0 3h2v2H7v-2zm-3 0h2v2H4v-2zm0-3h2v2H4V8zm12 7H8v-2h8v2zm0-4h-2V9h2v2zm0-3h-2V8h2v2zm3 3h-2V9h2v2zm0-3h-2V8h2v2z"/></svg>`;}
function svgWalkieTalkie(){return `<svg viewBox="0 0 24 24"><rect x="7" y="6.5" width="10" height="15" rx="2.2"/><rect x="8.7" y="2" width="2" height="5" rx="1"/><circle cx="12" cy="10.3" r="1.3" fill="#0C0D12"/><rect x="9" y="13.2" width="6" height="5.3" rx="1" fill="#0C0D12"/></svg>`;}
function svgSend(){return `<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>`;}
function svgVolume(){return `<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05A4.48 4.48 0 0 0 16.5 12z"/></svg>`;}
function svgPlay(){return `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;}
function svgCopy(){return `<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`;}
function svgCheck(){return `<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`;}
function svgVerify(){return `<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 8.74A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v4l5-5-5-5v4z"/></svg>`;}
function svgBook(){return `<svg viewBox="0 0 24 24"><path fill="#fff" d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h5v8l2.5-1.5L16 12V4h2v16z"/></svg>`;}
function svgTranslate(){return `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.05 4.98L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;}
function svgCamera(){return `<svg viewBox="0 0 24 24"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2l-1.83 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>`;}

function renderPanel(side){
  if(side === 'A' && state.saveHistory){
    try{
      // Keep the persisted log from growing forever.
      const trimmed = state.messages.slice(0, 200);
      localStorage.setItem('wt_messages', JSON.stringify(trimmed));
    }catch(e){ /* storage full/unavailable — history just won't persist this time */ }
  }
  const isA = side === 'A';
  const container = document.getElementById('panel' + side);
  const currentLang = isA ? state.langA : state.langB;
  const otherLang = isA ? state.langB : state.langA;
  const accent = isA ? 'var(--cyan)' : 'var(--red)';
  const isListening = state.listening[side];
  const isTranslating = state.translating[side];

  container.innerHTML = `
    <div class="panel-header">
      <div class="who">
        <div class="dot" style="background:${accent}"></div>
        <div class="label">${isA ? 'Colleague Perspective' : 'My Perspective'}</div>
      </div>
      <select class="langSelect" id="select${side}">
        ${LANGUAGES.map(l => `<option value="${l.code}" ${l.code===currentLang.code?'selected':''} ${l.code===otherLang.code?'disabled':''}>${langOptionLabel(l)}</option>`).join('')}
      </select>
    </div>
    <div class="chatLog" id="chatLog${side}"></div>
    <div class="inputRow">
      <div class="textFieldWrap" id="textFieldWrap${side}">
        <input type="text" id="input${side}" maxlength="4000" placeholder="${isA ? 'Hold mic to talk…' : 'Type or hold mic to talk…'}" aria-label="Message to translate" ${isA ? 'readonly' : ''}>
        <button class="sendBtn" id="sendBtn${side}" aria-label="Send and translate">${svgSend()}</button>
      </div>
      <button class="holdMicBtn ${isListening?'recording':''}" id="holdMic${side}" aria-label="Hold to talk, release to send">
        ${svgMic()}
      </button>
    </div>
    <div class="toolbarRow">
      <button class="camBtn ${isTranslating?'busy':''}" id="cam${side}" title="Scan photo, PDF, or file to translate" aria-label="Scan a photo, PDF, or file to translate">${svgCamera()}</button>
      <button class="camBtn" id="phrasebook${side}" title="Quick phrasebook — emergency, medical, work, housing" aria-label="Open quick phrasebook">${svgBook()}</button>
      <div class="pttHint" style="flex:1;text-align:right;padding-right:2px;">🎙️ Hold mic to talk, release to send</div>
    </div>
  `;

  renderChatLog(side);

  document.getElementById('select'+side).addEventListener('change', (e)=>{
    const newLang = langByCode(e.target.value);
    if(isA) state.langA = newLang; else state.langB = newLang;
    renderPanel('A'); renderPanel('B');
  });
  document.getElementById('sendBtn'+side).addEventListener('click', ()=>{
    vibrate(10);
    const input = document.getElementById('input'+side);
    handleTranslation(input.value, side, false);
  });
  document.getElementById('input'+side).addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') handleTranslation(e.target.value, side, false);
  });
  if(isA){
    document.getElementById('inputA').addEventListener('click', ()=>{
      openTypeOverlay('A');
    });
  }

  const holdMic = document.getElementById('holdMic'+side);
  let holdActive = false;
  holdMic.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    if(isTranslating) return;
    // Pointer capture keeps pointerup targeting this button even if the
    // finger drifts slightly during the hold — without this, mobile touch
    // tracking can misfire "pointerleave" almost instantly and cut off
    // the recording before any speech is captured.
    try{ holdMic.setPointerCapture(e.pointerId); }catch(err){}
    holdActive = true;
    vibrate(15);
    holdMic.classList.add('recording');
    startHoldRecording(side);
  });
  const endHold = ()=>{
    if(!holdActive) return;
    holdActive = false;
    vibrate(10);
    holdMic.classList.remove('recording');
    stopHoldRecording(side);
  };
  holdMic.addEventListener('pointerup', endHold);
  holdMic.addEventListener('pointercancel', endHold);

  const camBtn = document.getElementById('cam'+side);
  camBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    if(isTranslating) return;
    currentScanSide = side;
    document.getElementById('scanInput').click();
  });

  const phrasebookBtn = document.getElementById('phrasebook'+side);
  phrasebookBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    pbOpen(side);
  });
}

function renderChatLog(side){
  const el = document.getElementById('chatLog'+side);
  if(state.messages.length === 0){
    el.innerHTML = `<div class="emptyState">${svgTranslate()}<br>No communications logged.<br>Tap &amp; hold Mic or type to speak.</div>`;
    return;
  }
  el.innerHTML = state.messages.map(msg => {
    const isMine = msg.sender === side;
    const originalLabel = isMine ? 'Original' : 'Received (Translated)';
    const translationLabel = isMine ? 'Translated Out' : 'Original Source';
    const accent = msg.sender === 'A' ? 'var(--cyan)' : 'var(--red)';
    const mainRaw = isMine ? msg.originalText : msg.translatedText;
    const subRaw = isMine ? msg.translatedText : msg.originalText;
    const showMainPending = msg.pending && !isMine; // their translation not ready yet
    const showSubPending = msg.pending && isMine;   // your outgoing translation not ready yet
    // The top block is always shown in THIS panel's own language;
    // the bottom block is always shown in the other side's language.
    const mainSide = side;
    const subSide = otherSide(side);
    // "Translated Out" (the sub-block on your own outgoing messages) can be
    // hidden via settings to reduce clutter; received messages always show
    // their Original Source for reference.
    const hideSub = isMine && !state.showTranslatedOut;

    return `
      <div class="bubbleRow ${isMine?'mine':'theirs'}">
        <div class="bubble">
          <div class="topRow">
            <span class="tag" style="color:${accent}">${isMine ? originalLabel : translationLabel}</span>
            <div class="badges">
              ${msg.isVoice ? `<svg class="voiceIcon" viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/></svg>` : ''}
              ${msg.isScan ? `<span class="scanBadge">📷 scan</span>` : ''}
              ${msg.usedOffline ? (msg.usedMyMemory ? `<span class="myMemoryBadge">MyMemory</span>` : (msg.approx ? `<span class="offlineBadge">offline</span>` : `<span class="memoryBadge">✓ remembered</span>`)) : ''}
              ${msg.approx ? `<span class="approxBadge">≈ approx</span>` : ''}
            </div>
          </div>
          ${msg.photoUrl ? `<img src="${msg.photoUrl}" class="scanThumb" alt="Scanned photo">` : ''}
          <div class="mainText" ${showMainPending ? '' : `data-mid="${msg.id}" data-role="${isMine ? 'orig' : 'trans'}"`}>${showMainPending ? '<span class="dotFlicker">translating…</span>' : escapeHtml(mainRaw)}</div>
          ${showMainPending ? '' : `
          <div class="miniControls">
            <button class="iconBtn playBtn" data-mid="${msg.id}" data-block="main" data-side="${mainSide}" title="Play" aria-label="Play audio">${svgPlay()}</button>
            <button class="iconBtn copyBtn" data-mid="${msg.id}" data-block="main" data-side="${mainSide}" title="Copy" aria-label="Copy text">${svgCopy()}</button>
          </div>`}
          ${hideSub ? '' : `
          <hr>
          <div class="subRow">
            <span class="subLabel">${isMine ? translationLabel : originalLabel}</span>
          </div>
          <div class="subText" ${showSubPending ? '' : `data-mid="${msg.id}" data-role="${isMine ? 'trans' : 'orig'}"`}>${showSubPending ? '<span class="dotFlicker">translating…</span>' : escapeHtml(subRaw)}</div>
          ${showSubPending ? '' : `
          <div class="miniControls">
            <button class="iconBtn playBtn" data-mid="${msg.id}" data-block="sub" data-side="${subSide}" title="Play" aria-label="Play audio">${svgPlay()}</button>
            <button class="iconBtn copyBtn" data-mid="${msg.id}" data-block="sub" data-side="${subSide}" title="Copy" aria-label="Copy text">${svgCopy()}</button>
            ${isMine ? `<button class="iconBtn verifyBtn" data-mid="${msg.id}" data-from="${subSide}" data-to="${mainSide}" title="Verify: translate back to check accuracy">${svgVerify()}</button>` : ''}
          </div>
          ${isMine ? `<div id="verify-${msg.id}"></div>` : ''}`}`}
          ${msg.errorDetail ? `<div class="errorDetail">⚠ ${escapeHtml(msg.errorDetail)}</div>` : ''}
          ${msg.timestamp ? `<div class="msgTime">${formatTime(msg.timestamp)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Cheap incremental update used while a translation is streaming in:
// only touches the small text nodes that show the in-progress
// original/translated text (one pair per panel) instead of rebuilding
// the whole panel. fields = { orig?: string, trans?: string } — pass
// whichever field(s) changed this chunk.
function patchStreamingFields(msgId, fields){
  if(fields.orig !== undefined){
    document.querySelectorAll(`.mainText[data-mid="${msgId}"][data-role="orig"], .subText[data-mid="${msgId}"][data-role="orig"]`)
      .forEach(el => { el.textContent = fields.orig; });
  }
  if(fields.trans !== undefined){
    document.querySelectorAll(`.mainText[data-mid="${msgId}"][data-role="trans"], .subText[data-mid="${msgId}"][data-role="trans"]`)
      .forEach(el => { el.textContent = fields.trans; });
  }
}
// Back-compat convenience wrapper for the plain-text-only streaming case.
function patchStreamingText(msgId, text){ patchStreamingFields(msgId, { trans: text }); }
// Same idea for the Quick Translate screen's single-column history cards.
function patchQtStreamingText(id, text){
  const el = document.querySelector(`.qtTranslation[data-qtid="${id}"]`);
  if(el) el.textContent = text;
}
function patchQtStreamingOrig(id, text){
  const el = document.querySelector(`.qtOriginal[data-qtid-orig="${id}"]`);
  if(el) el.textContent = text;
}

// Resolves the original/translated text for a message + block ("main" or
// "sub") + panel side at click time, straight from state — nothing is ever
// serialized into an HTML attribute, so there's no way for message content
// (which can contain quotes, HTML, anything) to break out of markup.
function resolveBlockText(msg, block, panelSide){
  const isMine = msg.sender === panelSide;
  if(block === 'main') return isMine ? msg.originalText : msg.translatedText;
  return isMine ? msg.translatedText : msg.originalText;
}

document.addEventListener('click', (e) => {
  const playBtn = e.target.closest('.playBtn');
  if(playBtn){
    const msg = state.messages.find(m => m.id === playBtn.dataset.mid);
    if(msg) playBlock(resolveBlockText(msg, playBtn.dataset.block, playBtn.dataset.side), playBtn.dataset.side);
    return;
  }
  const copyBtn = e.target.closest('.copyBtn');
  if(copyBtn){
    const msg = state.messages.find(m => m.id === copyBtn.dataset.mid);
    if(msg) copyBlock(resolveBlockText(msg, copyBtn.dataset.block, copyBtn.dataset.side), copyBtn);
    return;
  }
  const verifyBtn = e.target.closest('.verifyBtn');
  if(verifyBtn){
    const msg = state.messages.find(m => m.id === verifyBtn.dataset.mid);
    if(msg) verifyBlock(msg.id, msg.translatedText, verifyBtn.dataset.from, verifyBtn.dataset.to, verifyBtn);
    return;
  }
  const qtCopyBtn = e.target.closest('.qtCopyBtn');
  if(qtCopyBtn){
    const item = state.qtHistory.find(i => i.id == qtCopyBtn.dataset.id);
    if(item) copyBlock(qtCopyBtn.dataset.field === 'orig' ? item.originalText : item.translatedText, qtCopyBtn);
    return;
  }
  const qtPlayBtn = e.target.closest('.qtPlayBtn');
  if(qtPlayBtn){
    qtPlay(Number(qtPlayBtn.dataset.id));
    return;
  }
});

function playBlock(text, side){
  const lang = side === 'A' ? state.langA : state.langB;
  speak(text, lang);
}

async function verifyBlock(msgId, text, fromSide, toSide, btnEl){
  if(state.offlineForced || !hasBackend()){
    showToast('Verify feature အတွက် AI Translation Key လိုအပ်ပါတယ်', 'warn');
    return;
  }
  const fromLang = fromSide === 'A' ? state.langA : state.langB;
  const toLang = toSide === 'A' ? state.langA : state.langB;
  const target = document.getElementById('verify-' + msgId);
  btnEl.disabled = true;
  const originalIcon = btnEl.innerHTML;
  btnEl.innerHTML = '<span class="dotFlicker">…</span>';

  try{
    const prompt = `Translate the following ${fromLang.name} text into ${toLang.name} as literally and accurately as possible `
      + `(this is for a back-translation accuracy check, not for natural conversation — precision matters more than fluency here). `
      + `Return ONLY the translation, nothing else.\n\nText: "${text}"`;
    const resp = await geminiFetch('gemini-3.5-flash', {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'minimal' } }
    });
    if(resp.ok){
      const data = await resp.json();
      const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
      if(target && raw){
        target.innerHTML = `<div class="verifyNote"><b>🔄 Back-translation check:</b> ${escapeHtml(raw)}</div>`;
      }
    } else {
      showToast('Verify မအောင်မြင်ပါ — ပြန်စမ်းကြည့်ပါ', 'error');
    }
  } catch(e){
    showToast('Verify အမှားဖြစ်သွားပါတယ်: ' + e.message, 'error');
  }
  btnEl.innerHTML = originalIcon;
  btnEl.disabled = false;
}

async function copyBlock(text, btnEl){
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    // Fallback for browsers/webviews without clipboard API permission
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); }catch(e2){}
    document.body.removeChild(ta);
  }
  const original = btnEl.innerHTML;
  btnEl.innerHTML = svgCheck();
  btnEl.disabled = true;
  vibrate(8);
  setTimeout(()=>{ btnEl.innerHTML = original; btnEl.disabled = false; }, 1100);
}


function vibrate(ms){
  try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){}
}

function formatTime(ts){
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if(h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.innerText = str;
  return d.innerHTML;
}

function renderStatusBar(){
  const bar = document.getElementById('statusBar');
  const text = document.getElementById('statusText');
  const online = !state.offlineForced && hasBackend();
  bar.classList.toggle('online', online);
  text.textContent = online
    ? 'Live Translation Active'
    : 'Offline Mode (Limited)';

  const autoBtn = document.getElementById('autoBtn');
  const isActive = state.autoConversation || state.listening.A || state.listening.B;
  autoBtn.classList.toggle('on', state.autoConversation);
  autoBtn.classList.toggle('pulsing', state.autoConversation && isActive);
}

['autoBtn', 'settingsBtn', 'liveBtn'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      document.getElementById(id).click();
    }
  });
});

document.getElementById('liveBtn').addEventListener('click', ()=>{
  if(liveState.ws || liveState.connected){
    stopLiveMode();
  } else {
    startLiveMode();
  }
});
document.getElementById('liveStopBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  stopLiveMode();
});

document.getElementById('autoBtn').addEventListener('click', ()=>{
  state.autoConversation = !state.autoConversation;
  if(!state.autoConversation){
    // Turning it off should immediately stop any in-progress listening.
    if(recognition){ try{ recognition.stop(); }catch(e){} }
    stopStt();
  }
  renderStatusBar();
});

/* =========================================================
   SETTINGS MODAL
========================================================= */
const overlay = document.getElementById('modalOverlay');
document.querySelectorAll('.settingsTab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settingsTab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.querySelectorAll('.settingsPane').forEach(pane => {
      pane.style.display = pane.dataset.pane === target ? 'block' : 'none';
    });
  });
});

document.getElementById('settingsBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.settingsTab').forEach(t => t.classList.remove('active'));
  document.querySelector('.settingsTab[data-tab="account"]').classList.add('active');
  document.querySelectorAll('.settingsPane').forEach(pane => {
    pane.style.display = pane.dataset.pane === 'account' ? 'block' : 'none';
  });
  document.getElementById('apiKeyInput').value = state.apiKeys[0] || '';
  document.getElementById('apiKeyInput2').value = state.apiKeys[1] || '';
  document.getElementById('apiKeyInput3').value = state.apiKeys[2] || '';
  document.getElementById('myMemoryToggle').checked = state.myMemoryEnabled;
  document.getElementById('myMemoryEmailInput').value = state.myMemoryEmail || '';
  document.getElementById('proxyUrlInput').value = state.proxyUrl;
  document.getElementById('ownKeyFields').style.display = state.backendMode === 'proxy' ? 'none' : 'block';
  document.getElementById('proxyFields').style.display = state.backendMode === 'proxy' ? 'block' : 'none';
  document.querySelectorAll('#backendModeRow .speedBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.backendMode);
  });
  document.getElementById('offlineToggle').checked = state.offlineForced;
  document.getElementById('autoSpeakToggle').checked = state.autoSpeak;
  document.getElementById('showTranslatedOutToggle').checked = state.showTranslatedOut;
  document.getElementById('lightThemeToggle').checked = state.lightTheme;
  document.getElementById('saveHistoryToggle').checked = state.saveHistory;
  document.getElementById('glossaryInput').value = state.glossary;
  document.getElementById('versionFooter').textContent = 'Walkie-Talkie Translator · v' + APP_VERSION;
  clearHistoryArmed = false;
  clearTimeout(clearHistoryResetTimer);
  const chBtn = document.getElementById('clearHistoryBtn');
  chBtn.textContent = '🗑 Clear Conversation History';
  chBtn.style.borderColor = '';
  chBtn.style.color = '';
  document.querySelectorAll('#speedRow .speedBtn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.rate) === state.speechRate);
  });
  document.querySelectorAll('#toneRow .speedBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tone === state.tone);
  });
  document.querySelectorAll('#voiceEngineRow .speedBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.engine === state.voiceEngine);
  });
  updateVoiceDiag();
  overlay.classList.add('show');
});
document.querySelectorAll('#backendModeRow .speedBtn').forEach(btn => {
  btn.addEventListener('click', ()=>{
    document.getElementById('ownKeyFields').style.display = btn.dataset.mode === 'proxy' ? 'none' : 'block';
    document.getElementById('proxyFields').style.display = btn.dataset.mode === 'proxy' ? 'block' : 'none';
  });
});
document.querySelectorAll('.speedBtn').forEach(btn => {
  btn.addEventListener('click', ()=>{
    const row = btn.closest('.speedRow');
    row.querySelectorAll('.speedBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});
document.getElementById('cancelBtn').addEventListener('click', ()=> overlay.classList.remove('show'));
document.getElementById('exportHistoryBtn').addEventListener('click', async ()=>{
  if(!state.messages.length){
    showToast('Export လုပ်စရာ message မရှိသေးပါ', 'warn');
    return;
  }
  const lines = [];
  lines.push('Walkie-Talkie Translator — Conversation Export');
  lines.push('Exported: ' + new Date().toLocaleString());
  lines.push('='.repeat(44));
  lines.push('');
  const chronological = [...state.messages].reverse().filter(m => !m.pending);
  chronological.forEach(m => {
    const who = m.sender === 'A' ? 'Person A' : 'Person B';
    const time = m.timestamp ? formatTime(m.timestamp) : '';
    lines.push(`[${time}] ${who}`);
    lines.push(`  Original:   ${m.originalText}`);
    lines.push(`  Translated: ${m.translatedText}`);
    lines.push('');
  });
  const text = lines.join('\n');
  const filename = `conversation-${new Date().toISOString().slice(0,10)}.txt`;

  try{
    const file = new File([text], filename, {type:'text/plain'});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Conversation Export'});
      return;
    }
  }catch(e){ /* fall through to direct download */ }

  const blob = new Blob([text], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
  showToast('Conversation ကို download လုပ်ပြီးပါပြီ။');
});

let clearHistoryArmed = false;
let clearHistoryResetTimer = null;
document.getElementById('clearHistoryBtn').addEventListener('click', (e)=>{
  const btn = e.currentTarget;
  if(!clearHistoryArmed){
    clearHistoryArmed = true;
    btn.textContent = '⚠️ ထပ်နှိပ်ရင် ပြန်ရအောင် မလုပ်နိုင်တော့ပါ — သေချာလား?';
    btn.style.borderColor = 'var(--red)';
    btn.style.color = 'var(--red)';
    clearHistoryResetTimer = setTimeout(()=>{
      clearHistoryArmed = false;
      btn.textContent = '🗑 Clear Conversation History';
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 3000);
    return;
  }
  clearTimeout(clearHistoryResetTimer);
  clearHistoryArmed = false;
  btn.textContent = '🗑 Clear Conversation History';
  btn.style.borderColor = '';
  btn.style.color = '';
  state.messages = [];
  try{ localStorage.removeItem('wt_messages'); }catch(e){}
  renderPanel('A'); renderPanel('B');
  showToast('Conversation history ကို ရှင်းလိုက်ပါပြီ။');
  vibrate(20);
});
document.getElementById('applyBtn').addEventListener('click', ()=>{
  state.apiKeys = [
    document.getElementById('apiKeyInput').value.trim(),
    document.getElementById('apiKeyInput2').value.trim(),
    document.getElementById('apiKeyInput3').value.trim(),
  ];
  state.apiKeyIndex = state.apiKeys.findIndex(k => k);
  if(state.apiKeyIndex === -1) state.apiKeyIndex = 0;
  state.apiKey = state.apiKeys[state.apiKeyIndex] || '';
  state.myMemoryEnabled = document.getElementById('myMemoryToggle').checked;
  state.myMemoryEmail = document.getElementById('myMemoryEmailInput').value.trim();
  state.proxyUrl = document.getElementById('proxyUrlInput').value.trim();
  const activeBackendBtn = document.querySelector('#backendModeRow .speedBtn.active');
  if(activeBackendBtn) state.backendMode = activeBackendBtn.dataset.mode;
  state.offlineForced = document.getElementById('offlineToggle').checked;
  state.autoSpeak = document.getElementById('autoSpeakToggle').checked;
  state.showTranslatedOut = document.getElementById('showTranslatedOutToggle').checked;
  state.lightTheme = document.getElementById('lightThemeToggle').checked;
  state.saveHistory = document.getElementById('saveHistoryToggle').checked;
  state.glossary = document.getElementById('glossaryInput').value.trim();
  document.body.classList.toggle('light-theme', state.lightTheme);
  const activeSpeedBtn = document.querySelector('#speedRow .speedBtn.active');
  if(activeSpeedBtn) state.speechRate = parseFloat(activeSpeedBtn.dataset.rate);
  const activeToneBtn = document.querySelector('#toneRow .speedBtn.active');
  if(activeToneBtn) state.tone = activeToneBtn.dataset.tone;
  const activeEngineBtn = document.querySelector('#voiceEngineRow .speedBtn.active');
  if(activeEngineBtn) state.voiceEngine = activeEngineBtn.dataset.engine;
  try{
    localStorage.setItem('wt_apiKeys', JSON.stringify(state.apiKeys));
    localStorage.setItem('wt_myMemoryEnabled', state.myMemoryEnabled ? '1' : '0');
    localStorage.setItem('wt_myMemoryEmail', state.myMemoryEmail);
    localStorage.setItem('wt_proxyUrl', state.proxyUrl);
    localStorage.setItem('wt_backendMode', state.backendMode);
    localStorage.setItem('wt_offlineForced', state.offlineForced ? '1' : '0');
    localStorage.setItem('wt_speechRate', String(state.speechRate));
    localStorage.setItem('wt_autoSpeak', state.autoSpeak ? '1' : '0');
    localStorage.setItem('wt_showTranslatedOut', state.showTranslatedOut ? '1' : '0');
    localStorage.setItem('wt_lightTheme', state.lightTheme ? '1' : '0');
    localStorage.setItem('wt_tone', state.tone);
    localStorage.setItem('wt_voiceEngine', state.voiceEngine);
    localStorage.setItem('wt_glossary', state.glossary);
    localStorage.setItem('wt_saveHistory', state.saveHistory ? '1' : '0');
    if(state.saveHistory){
      localStorage.setItem('wt_messages', JSON.stringify(state.messages.slice(0, 200)));
    } else {
      localStorage.removeItem('wt_messages');
    }
  }catch(e){ /* storage unavailable — settings just won't persist */ }
  overlay.classList.remove('show');
  renderStatusBar();
  renderPanel('A'); renderPanel('B');
  showToast('Settings သိမ်းပြီးပါပြီ။');
});
overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.classList.remove('show'); });

/* =========================================================
   QUICK TRANSLATE (one-way: paste text / scan photo / voice,
   translate whatever it is into a language YOU choose — not
   part of the two-person Walkie-Talkie conversation)
========================================================= */
state.qtTargetCode = 'en';
state.qtMicCode = 'my';
state.qtDomain = 'general';
state.qtHistory = [];

const WORK_DOMAINS = [
  {
    code: 'general', label: '🌐 General (No specific domain)',
    hint: '',
    suggestions: [],
  },
  {
    code: 'electronics', label: '🔌 Electronics / PCB Factory',
    hint: 'This conversation takes place in an electronics / PCB (printed circuit board) manufacturing factory. Use accurate industry-standard technical terminology for concepts like SMT (surface-mount technology), reflow soldering, pick-and-place machines, solder paste, wave soldering, PCB inspection, quality control (QC), defect rate, ESD (electrostatic discharge) precautions, and production line workflow — translate the way an experienced factory worker or engineer in this industry would actually say it, not literally word-for-word.',
    suggestions: [
      "What is today's defect rate?",
      "Please check this solder joint again.",
      "The machine needs maintenance.",
      "How many units per hour is the target?",
      "This board failed quality inspection.",
      "Please wear your ESD wrist strap.",
      "The reflow oven temperature looks wrong.",
      "We are short of components for this line.",
    ],
  },
  {
    code: 'factory_general', label: '🏭 General Factory / Manufacturing',
    hint: 'This conversation takes place in a general manufacturing factory. Use accurate terminology for production lines, shift schedules, machine operation, safety procedures, quality control, and factory management — the way a factory supervisor or worker would naturally say it.',
    suggestions: [
      "What time does the next shift start?",
      "Please report any injury immediately.",
      "This machine is not working properly.",
      "We need more raw materials.",
      "Please follow the safety procedure.",
      "How many pieces did we produce today?",
    ],
  },
  {
    code: 'construction', label: '🏗️ Construction Site',
    hint: 'This conversation takes place on a construction site. Use accurate terminology for scaffolding, rebar, concrete pouring, safety harnesses, blueprints, the foreman, crane operation, and building codes — the way an experienced construction worker would say it.',
    suggestions: [
      "Please wear your safety helmet and harness.",
      "This scaffolding looks unstable.",
      "We need more cement/concrete.",
      "Where are the blueprints for this floor?",
      "Please stop the crane, it's not safe.",
      "This area is dangerous, do not enter.",
    ],
  },
  {
    code: 'kitchen', label: '🍳 Restaurant / Kitchen',
    hint: 'This conversation takes place in a restaurant or food-service kitchen. Use accurate terminology for food preparation, kitchen equipment, food safety/hygiene, and service — the way kitchen staff would naturally say it.',
    suggestions: [
      "This needs to be cooked more.",
      "Please wash your hands before handling food.",
      "We are out of this ingredient.",
      "This customer has a food allergy.",
      "The kitchen needs to be cleaned now.",
    ],
  },
  {
    code: 'domestic', label: '🏠 Domestic / Housekeeping / Caregiving',
    hint: 'This conversation takes place in a household setting (housekeeping, childcare, or eldercare). Use natural, warm, everyday terminology appropriate for a home setting — precision matters especially for care/medical instructions.',
    suggestions: [
      "What time should I pick up the children?",
      "Please take this medicine after eating.",
      "The baby needs a diaper change.",
      "I finished cleaning the house.",
      "Please call me if there is an emergency.",
    ],
  },
  {
    code: 'logistics', label: '🚚 Warehouse / Logistics',
    hint: 'This conversation takes place in a warehouse/logistics setting. Use accurate terminology for inventory, shipping, forklift operation, loading docks, packing, and supply chain workflow — the way warehouse staff would say it.',
    suggestions: [
      "Where should this shipment go?",
      "Please check the inventory count.",
      "The forklift needs to move this pallet.",
      "This package is damaged.",
      "When is the next delivery truck arriving?",
    ],
  },
  {
    code: 'agriculture', label: '🌾 Farm / Agriculture',
    hint: 'This conversation takes place on a farm/agricultural setting. Use accurate terminology for crops, livestock, farming equipment, irrigation, and seasonal work — the way farm workers would say it.',
    suggestions: [
      "When should we harvest this crop?",
      "The irrigation system is not working.",
      "This animal looks sick.",
      "We need more fertilizer.",
      "The weather looks bad for today's work.",
    ],
  },
  {
    code: 'healthcare', label: '⚕️ Healthcare / Caregiving',
    hint: 'This conversation takes place in a healthcare or caregiving setting. Use accurate, careful medical/care terminology — be extra precise, since translation errors here could affect someone\'s health and safety.',
    suggestions: [
      "Where does it hurt?",
      "Please take this medicine twice a day.",
      "Do you have any allergies?",
      "We need to call an ambulance.",
      "Please rest and drink plenty of water.",
    ],
  },
];
const domainByCode = c => WORK_DOMAINS.find(d => d.code === c) || WORK_DOMAINS[0];

function qtPopulateDomains(){
  const sel = document.getElementById('qtDomain');
  sel.innerHTML = WORK_DOMAINS.map(d => `<option value="${d.code}">${d.label}</option>`).join('');
  sel.value = state.qtDomain;
}
function qtRenderSuggestions(){
  const el = document.getElementById('qtSuggestions');
  const domain = domainByCode(state.qtDomain);
  if(!domain.suggestions.length){ el.innerHTML = ''; return; }
  el.innerHTML = domain.suggestions.map(s =>
    `<div class="qtSuggestChip" data-text="${escapeHtml(s).replace(/"/g,'&quot;')}">${escapeHtml(s)}</div>`
  ).join('');
  el.querySelectorAll('.qtSuggestChip').forEach(chip => {
    chip.addEventListener('click', () => {
      vibrate(10);
      qtTranslate(chip.dataset.text);
    });
  });
}
document.getElementById('qtDomain').addEventListener('change', (e)=>{
  state.qtDomain = e.target.value;
  try{ localStorage.setItem('wt_qtDomain', state.qtDomain); }catch(err){}
  qtRenderSuggestions();
});

function qtPopulateSelects(){
  const targetSel = document.getElementById('qtTargetLang');
  const micSel = document.getElementById('qtMicLang');
  targetSel.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${langOptionLabel(l)}</option>`).join('');
  micSel.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${langOptionLabel(l)}</option>`).join('');
  targetSel.value = state.qtTargetCode;
  micSel.value = state.qtMicCode;
  qtPopulateDomains();
  qtRenderSuggestions();
}

/* =========================================================
   NAVIGATION — home/launcher screen with 3 modes + settings
========================================================= */
function showView(view){
  state.currentView = view;
  document.getElementById('homeScreen').style.display = view === 'home' ? 'flex' : 'none';
  document.getElementById('panelA').style.display = view === 'conversation' ? 'flex' : 'none';
  document.getElementById('divider').style.display = view === 'conversation' ? 'flex' : 'none';
  document.getElementById('panelB').style.display = view === 'conversation' ? 'flex' : 'none';
  document.getElementById('quickPanel').style.display = view === 'quick' ? 'flex' : 'none';
  document.getElementById('livePanel').style.display = view === 'live' ? 'flex' : 'none';
  document.getElementById('homeBtn').classList.toggle('show', view !== 'home');
}

document.querySelectorAll('.homeCard').forEach(card => {
  card.addEventListener('click', () => {
    const view = card.dataset.view;
    vibrate(10);
    if(view === 'settings'){
      document.getElementById('settingsBtn').click();
      return;
    }
    showView(view);
  });
});
document.getElementById('homeBtn').addEventListener('click', () => {
  vibrate(10);
  showView('home');
});

document.getElementById('qtTargetLang').addEventListener('change', (e) => { state.qtTargetCode = e.target.value; });
document.getElementById('qtMicLang').addEventListener('change', (e) => { state.qtMicCode = e.target.value; });

function qtRenderHistory(){
  const el = document.getElementById('qtHistory');
  if(!state.qtHistory.length){
    el.innerHTML = '<div class="qtEmpty">မသိတဲ့ စာသားကို ကူးထည့်ပါ၊ ဓာတ်ပုံရိုက်ပါ၊<br>သို့မဟုတ် အသံနဲ့ မေးပါ — AI က ရွေးထားတဲ့ဘာသာစကားသို့ တိကျစွာ ပြန်ပေးပါလိမ့်မယ်။</div>';
    return;
  }
  el.innerHTML = state.qtHistory.map(item => `
    <div class="qtCard">
      ${item.pending ? `
        <div class="qtOriginal">${escapeHtml(item.queryLabel || item.originalText || '')}</div>
        <hr>
        <div class="qtTranslation"><span class="dotFlicker">translating…</span></div>
      ` : `
        <div class="qtBadges">
          ${item.detectedLang ? `<span class="qtDetected">Detected: ${escapeHtml(item.detectedLang)}</span>` : ''}
          ${item.usedOffline ? (item.usedMyMemory ? `<span class="myMemoryBadge">MyMemory</span>` : (item.approx ? `<span class="offlineBadge">offline</span>` : `<span class="memoryBadge">✓ remembered</span>`)) : ''}
        </div>
        ${item.photoUrl ? `<img src="${item.photoUrl}" class="scanThumb" alt="Scanned photo">` : ''}
        <div class="qtOriginal" data-qtid-orig="${item.id}">${escapeHtml(item.originalText)}</div>
        <div class="miniControls">
          <button class="iconBtn qtCopyBtn" data-id="${item.id}" data-field="orig" title="Copy">${svgCopy()}</button>
        </div>
        <hr>
        <div class="qtTranslation" data-qtid="${item.id}">${escapeHtml(item.translatedText)}</div>
        <div class="miniControls">
          <button class="iconBtn qtPlayBtn" data-id="${item.id}" title="Play">${svgPlay()}</button>
          <button class="iconBtn qtCopyBtn" data-id="${item.id}" data-field="trans" title="Copy">${svgCopy()}</button>
        </div>
      `}
    </div>
  `).join('');
}

function qtPlay(id){
  const item = state.qtHistory.find(i => i.id === id);
  if(!item || !item.translatedText) return;
  const lang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  speak(item.translatedText, lang);
}

async function qtTranslate(rawText, queryLabel){
  rawText = (rawText || '').trim();
  if(!rawText) return;
  const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];

  const id = Date.now().toString();
  state.qtHistory.unshift({ id, pending: true, queryLabel: queryLabel || rawText });
  qtRenderHistory();

  let translatedText = '';
  let detectedLang = '';
  let usedOffline = false;
  let usedMyMemory = false;
  let approx = false;

  async function qtFallback(){
    usedOffline = true;
    const remembered = tmLookup('auto', targetLang.code, rawText);
    if(remembered){
      translatedText = remembered;
      approx = false;
      return;
    }
    const result = await fallbackTranslateChain(rawText, 'autodetect', targetLang.code);
    if(result){
      translatedText = result.text;
      approx = result.approx;
      usedMyMemory = result.usedMyMemory;
    } else {
      translatedText = `[Offline] ${rawText}`;
      approx = true;
    }
  }

  if(state.offlineForced || !hasBackend()){
    await qtFallback();
  } else {
    try{
      const domainHint = domainByCode(state.qtDomain).hint;
      const prompt = `Detect the language of the following message and translate it into ${targetLang.name}. `
        + `Understand the full meaning first, then translate naturally the way a native ${targetLang.name} speaker would say it — not word-for-word.\n\n`
        + `Tone: ${toneInstruction()}\n`
        + `${glossaryInstruction()}`
        + (domainHint ? `\nWork context: ${domainHint}\n` : '')
        + `\nRespond in EXACTLY this format, nothing else:\n`
        + `LANG: <name of the detected source language>\n`
        + `TRANSLATION: <the natural translation, full text, nothing added>\n\n`
        + `Message: "${rawText}"`;

      let qtStreamStructureReady = false;
      const streamResult = await geminiFetchStream('gemini-3.5-flash', {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } }
      }, (partialRaw) => {
        const partialMatch = partialRaw.match(/TRANSLATION:\s*([\s\S]*)/i);
        if(partialMatch){
          const liveItem = state.qtHistory.find(i => i.id === id);
          if(liveItem){
            liveItem.translatedText = partialMatch[1].trim();
            liveItem.pending = false;
            if(!qtStreamStructureReady){
              qtStreamStructureReady = true;
              qtRenderHistory();
            } else {
              patchQtStreamingText(id, liveItem.translatedText);
            }
          }
        }
      });

      if(streamResult.ok){
        const raw = streamResult.fullText || '';
        const langMatch = raw.match(/LANG:\s*(.*)/i);
        const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
        detectedLang = langMatch ? langMatch[1].trim() : '';
        translatedText = transMatch ? transMatch[1].trim() : raw;
        if(translatedText){
          tmSave('auto', targetLang.code, rawText, translatedText);
        } else {
          console.error('Gemini empty response for QT request');
          await qtFallback();
        }
      } else {
        console.error('Gemini API error (QT):', streamResult.status);
        await qtFallback();
      }
    } catch(e){
      console.error('Gemini fetch failed (QT):', e);
      await qtFallback();
    }
  }

  const item = state.qtHistory.find(i => i.id === id);
  if(item){
    Object.assign(item, {
      pending: false, originalText: rawText, translatedText, detectedLang, usedOffline, usedMyMemory, approx
    });
  }
  qtRenderHistory();
  if(state.autoSpeak) speak(translatedText, targetLang);
}

document.getElementById('qtSendBtn').addEventListener('click', () => {
  const input = document.getElementById('qtInput');
  const text = input.value.trim();
  if(!text) return;
  input.value = '';
  input.style.height = 'auto';
  qtTranslate(text);
});
document.getElementById('qtInput').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
});
attachDictation(document.getElementById('qtInput'), document.getElementById('qtDictateBtn'), () => state.langB);
document.getElementById('qtInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    document.getElementById('qtSendBtn').click();
  }
});

document.getElementById('qtCamBtn').addEventListener('click', () => {
  document.getElementById('qtScanInput').click();
});
document.getElementById('qtScanInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  await qtScanAndTranslate(file);
});

async function qtHandleVoiceHold(blob){
  const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  if(state.offlineForced || !hasBackend()){
    showToast('Hold-to-Talk အတွက် AI Translation Key/Internet လိုအပ်ပါတယ်', 'warn');
    clearHoldCaption('QT');
    return;
  }
  const id = Date.now().toString();
  state.qtHistory.unshift({ id, pending: true, queryLabel: '(transcribing voice…)' });
  qtRenderHistory();
  clearHoldCaption('QT');

  try{
    const base64 = await fileToBase64(blob);
    const domainHint = domainByCode(state.qtDomain).hint;
    const prompt = `Listen to this audio clip (any language, detect it) and translate what was said into ${targetLang.name}. `
      + `Understand the full meaning first, then translate naturally the way a native ${targetLang.name} speaker would say it — not word-for-word.\n\n`
      + `Tone: ${toneInstruction()}\n`
      + `${glossaryInstruction()}`
      + (domainHint ? `\nWork context: ${domainHint}\n` : '')
      + `\nRespond in EXACTLY this format, nothing else:\n`
      + `LANG: <name of the detected source language>\n`
      + `ORIGINAL: <exact transcription of what was said>\n`
      + `TRANSLATION: <the natural translation into ${targetLang.name}>`;

    const streamResult = await geminiFetchStream('gemini-3.5-flash', {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: blob.type || 'audio/webm', data: base64 } }
      ] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } }
    }, (partialRaw) => {
      const liveItem = state.qtHistory.find(i => i.id === id);
      if(!liveItem) return;
      const origMatch = partialRaw.match(/ORIGINAL:\s*([\s\S]*?)(\nTRANSLATION:|$)/i);
      const transMatch = partialRaw.match(/TRANSLATION:\s*([\s\S]*)/i);
      if(origMatch) liveItem.originalText = origMatch[1].trim();
      if(transMatch) liveItem.translatedText = transMatch[1].trim();
      const wasPending = liveItem.pending;
      liveItem.pending = false;
      if(wasPending){
        qtRenderHistory();
      } else {
        if(origMatch) patchQtStreamingOrig(id, liveItem.originalText);
        if(transMatch) patchQtStreamingText(id, liveItem.translatedText);
      }
    });

    if(!streamResult.ok){
      let bodyText = ''; try{ bodyText = streamResult.resp ? await streamResult.resp.text() : ''; }catch(e2){}
      console.error('QT voice hold API error:', streamResult.status, bodyText);
      showToast(`Voice translation မအောင်မြင်ပါ (Error ${streamResult.status || ''})`, 'error');
      state.qtHistory = state.qtHistory.filter(i => i.id !== id);
      qtRenderHistory();
      return;
    }

    const raw = streamResult.fullText || '';
    const langMatch = raw.match(/LANG:\s*(.*)/i);
    const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATION:/i);
    const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
    const detectedLang = langMatch ? langMatch[1].trim() : '';
    const originalText = origMatch ? origMatch[1].trim() : '(voice message)';
    const translatedText = transMatch ? transMatch[1].trim() : raw;

    const item = state.qtHistory.find(i => i.id === id);
    if(item){
      Object.assign(item, { pending: false, originalText, translatedText, detectedLang, usedOffline: false, approx: false });
    }
    if(originalText) tmSave('auto', targetLang.code, originalText, translatedText);
    qtRenderHistory();
    vibrate(15);
    if(state.autoSpeak) speak(translatedText, targetLang);
  }catch(e){
    console.error('qtHandleVoiceHold failed:', e);
    showToast(`Voice translation အမှားဖြစ်သွားပါတယ်: ${e.message}`, 'error');
    state.qtHistory = state.qtHistory.filter(i => i.id !== id);
    qtRenderHistory();
  }
}

async function qtScanAndTranslate(file){
  const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  if(state.offlineForced || !hasBackend()){
    showToast('Scan feature အတွက် AI Translation Key လိုအပ်ပါတယ်။ Settings ထဲမှာ ထည့်ပေးပါ။', 'warn');
    return;
  }
  const id = Date.now().toString();
  state.qtHistory.unshift({ id, pending: true, queryLabel: '(scanning photo…)' });
  qtRenderHistory();

  try{
    const base64 = await fileToBase64(file);
    const isImage = file.type && file.type.startsWith('image/');
    const photoUrl = isImage ? `data:${file.type};base64,${base64}` : null;
    const domainHint = domainByCode(state.qtDomain).hint;
    const prompt = `Read all the text in this file (a photo or PDF document, any language; if multi-page PDF, read all pages). Detect its language, then translate it into ${targetLang.name}, `
      + `understanding the full meaning naturally rather than word-for-word.\n\n`
      + `Tone: ${toneInstruction()}\n`
      + `${glossaryInstruction()}`
      + (domainHint ? `\nWork context: ${domainHint}\n` : '')
      + `\nRespond in EXACTLY this format, nothing else:\n`
      + `LANG: <name of the detected source language>\n`
      + `ORIGINAL: <the text you read>\n`
      + `TRANSLATION: <the natural translation into ${targetLang.name}>`;

    const resp = await geminiFetch('gemini-3.5-flash', {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } }
      ] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'minimal' },
        mediaResolution: 'MEDIA_RESOLUTION_MEDIUM'
      }
    });

    if(!resp.ok){
      let bodyText = ''; try{ bodyText = await resp.text(); }catch(e2){}
      console.error('QT scan API error:', resp.status, bodyText);
      showToast(`Scan translation မအောင်မြင်ပါ (Error ${resp.status})`, 'error');
      state.qtHistory = state.qtHistory.filter(i => i.id !== id);
      qtRenderHistory();
      return;
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
    const langMatch = raw.match(/LANG:\s*(.*)/i);
    const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATION:/i);
    const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
    const detectedLang = langMatch ? langMatch[1].trim() : '';
    const originalText = origMatch ? origMatch[1].trim() : '(scanned image)';
    const translatedText = transMatch ? transMatch[1].trim() : raw;

    const item = state.qtHistory.find(i => i.id === id);
    if(item){
      Object.assign(item, { pending: false, originalText, translatedText, detectedLang, photoUrl, usedOffline: false, approx: false });
    }
    if(originalText) tmSave('auto', targetLang.code, originalText, translatedText);
    qtRenderHistory();
    if(state.autoSpeak) speak(translatedText, targetLang);
  } catch(e){
    console.error('QT scan failed:', e);
    showToast(`Scan translation အမှားဖြစ်သွားပါတယ်: ${e.message}`, 'error');
    state.qtHistory = state.qtHistory.filter(i => i.id !== id);
    qtRenderHistory();
  }
}

let qtRecognition = null;
let qtPttHoldActive = false;

function qtStartRecognition(){
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognitionCtor){
    showToast('ဒီ browser မှာ voice input ကို support မလုပ်ပါ။ Chrome ကို သုံးကြည့်ပါ။', 'error');
    return;
  }
  if(qtRecognition){ try{ qtRecognition.stop(); }catch(e){} qtRecognition = null; }

  const micLang = langByCode(state.qtMicCode) || LANGUAGES[0];
  qtRecognition = new SpeechRecognitionCtor();
  qtRecognition.lang = micLang.ttsLocale;
  qtRecognition.continuous = false;
  qtRecognition.interimResults = false;
  qtRecognition.maxAlternatives = 1;
  document.getElementById('qtMicBtn').classList.add('listening');

  qtRecognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if(text && text.trim()) qtTranslate(text, `🎙️ ${text}`);
  };
  qtRecognition.onerror = (e) => {
    if(e.error !== 'no-speech' && e.error !== 'aborted'){
      showToast('Voice input အမှားဖြစ်သွားပါတယ်: ' + e.error, 'error');
    }
  };
  qtRecognition.onspeechend = () => { try{ qtRecognition.stop(); }catch(e){} };
  qtRecognition.onend = () => {
    qtRecognition = null;
    document.getElementById('qtMicBtn').classList.remove('listening');
  };

  try{ qtRecognition.start(); } catch(e){
    qtRecognition = null;
    document.getElementById('qtMicBtn').classList.remove('listening');
  }
}
function qtStopRecognition(){
  if(qtRecognition){ try{ qtRecognition.stop(); }catch(e){} }
}

document.getElementById('qtMicBtn').addEventListener('click', () => {
  if(qtRecognition){ qtStopRecognition(); return; }
  qtStartRecognition();
});

document.getElementById('qtModeToggle').addEventListener('click', () => {
  qtStopRecognition();
  const toggle = document.getElementById('qtModeToggle');
  const textWrap = document.getElementById('qtTextFieldWrap');
  const pttWrap = document.getElementById('qtPttWrap');
  const nowPtt = pttWrap.style.display === 'none';
  textWrap.style.display = nowPtt ? 'none' : 'flex';
  pttWrap.style.display = nowPtt ? 'flex' : 'none';
  toggle.classList.toggle('active', nowPtt);
  toggle.innerHTML = nowPtt ? svgKeyboard() : svgWalkieTalkie();
  vibrate(10);
});

const qtPttCircle = document.getElementById('qtPttCircle');
qtPttCircle.addEventListener('pointerdown', (e)=>{
  e.preventDefault();
  try{ qtPttCircle.setPointerCapture(e.pointerId); }catch(err){}
  qtPttHoldActive = true;
  vibrate(15);
  qtPttCircle.classList.add('recording');
  updateHoldCaption('QT', '🎙️ Recording... release to send');
  startHoldRecording('QT');
});
const endQtPttHold = ()=>{
  if(!qtPttHoldActive) return;
  qtPttHoldActive = false;
  vibrate(10);
  qtPttCircle.classList.remove('recording');
  stopWaveform('QT');
  stopHoldRecording('QT');
};
qtPttCircle.addEventListener('pointerup', endQtPttHold);
qtPttCircle.addEventListener('pointercancel', endQtPttHold);

/* =========================================================
   QUICK PHRASEBOOK — one-tap common phrases for migrant workers
   (emergency, medical, workplace, housing, wages, immigration).
   Inserts into the input box in the side's own language; sending
   it afterward translates & speaks it as normal, and since these
   exact phrases are also in the offline dictionary, they translate
   accurately even with zero internet.
========================================================= */
const PB_CATEGORIES = [
  {key:'emergency', label:'🚨 Emergency'},
  {key:'medical', label:'🏥 Medical'},
  {key:'workplace', label:'💼 Workplace'},
  {key:'housing', label:'🏠 Housing'},
  {key:'wages', label:'💰 Wages'},
  {key:'immigration', label:'✈️ Immigration'},
];
let pbActiveCategory = 'emergency';
let pbActiveSide = 'A';

function pbRenderCategories(){
  const el = document.getElementById('pbCategories');
  el.innerHTML = PB_CATEGORIES.map(c => `
    <button type="button" class="pbCatBtn ${c.key===pbActiveCategory?'active':''}" data-cat="${c.key}">${c.label}</button>
  `).join('');
  el.querySelectorAll('.pbCatBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      pbActiveCategory = btn.dataset.cat;
      pbRenderCategories();
      pbRenderPhrases();
    });
  });
}

function pbRenderPhrases(){
  const el = document.getElementById('pbPhraseList');
  const lang = pbActiveSide === 'A' ? state.langA : state.langB;
  const items = PHRASEBOOK.filter(p => p.cat === pbActiveCategory);
  el.innerHTML = items.map(p => {
    const text = p[lang.code] || p.en;
    return `<div class="pbPhraseItem" data-text="${escapeHtml(text).replace(/"/g,'&quot;')}">${escapeHtml(text)}</div>`;
  }).join('');
  el.querySelectorAll('.pbPhraseItem').forEach(item => {
    item.addEventListener('click', () => {
      const input = document.getElementById('input' + pbActiveSide);
      input.value = item.dataset.text;
      document.getElementById('phrasebookOverlay').classList.remove('show');
      input.focus();
      vibrate(10);
    });
  });
}

function pbOpen(side){
  pbActiveSide = side;
  pbRenderCategories();
  pbRenderPhrases();
  document.getElementById('phrasebookOverlay').classList.add('show');
}

document.getElementById('pbCloseBtn').addEventListener('click', () => {
  document.getElementById('phrasebookOverlay').classList.remove('show');
});
document.getElementById('phrasebookOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'phrasebookOverlay') document.getElementById('phrasebookOverlay').classList.remove('show');
});

/* =========================================================
   TYPE OVERLAY — a normal, non-rotated typing sheet.
   The rotated panel's native keyboard can't be flipped by CSS (it's a
   system overlay, always in the phone's true physical orientation), so
   whoever reads that panel right-side-up would see the keyboard upside
   down. This overlay gives them a properly-oriented place to type instead.
========================================================= */
let typeOverlaySide = 'A';
function openTypeOverlay(side){
  typeOverlaySide = side;
  const input = document.getElementById('typeOverlayInput');
  input.value = document.getElementById('input'+side).value;
  document.getElementById('typeOverlay').classList.add('show');
  setTimeout(()=>input.focus(), 50);
}
function closeTypeOverlay(){
  document.getElementById('typeOverlay').classList.remove('show');
}
document.getElementById('typeOverlayCloseBtn').addEventListener('click', closeTypeOverlay);
document.getElementById('typeOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'typeOverlay') closeTypeOverlay();
});
document.getElementById('typeOverlaySendBtn').addEventListener('click', ()=>{
  const text = document.getElementById('typeOverlayInput').value;
  if(!text.trim()) return;
  closeTypeOverlay();
  vibrate(10);
  handleTranslation(text, typeOverlaySide, false);
});
document.getElementById('typeOverlayInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    document.getElementById('typeOverlaySendBtn').click();
  }
});
attachDictation(
  document.getElementById('typeOverlayInput'),
  document.getElementById('typeOverlayDictateBtn'),
  () => (typeOverlaySide === 'A' ? state.langA : state.langB)
);

qtPopulateSelects();
qtRenderHistory();

/* =========================================================
   INIT
========================================================= */
try{
  const savedKeysRaw = localStorage.getItem('wt_apiKeys');
  const savedKeyOld = localStorage.getItem('wt_apiKey'); // pre-rotation format, migrated below
  const savedMyMemoryEnabled = localStorage.getItem('wt_myMemoryEnabled');
  const savedMyMemoryEmail = localStorage.getItem('wt_myMemoryEmail');
  const savedProxyUrl = localStorage.getItem('wt_proxyUrl');
  const savedBackendMode = localStorage.getItem('wt_backendMode');
  const savedOffline = localStorage.getItem('wt_offlineForced');
  const savedRate = localStorage.getItem('wt_speechRate');
  const savedAutoSpeak = localStorage.getItem('wt_autoSpeak');
  const savedShowSub = localStorage.getItem('wt_showTranslatedOut');
  const savedTheme = localStorage.getItem('wt_lightTheme');
  const savedTone = localStorage.getItem('wt_tone');
  const savedQtDomain = localStorage.getItem('wt_qtDomain');
  const savedVoiceEngine = localStorage.getItem('wt_voiceEngine');
  const savedGlossary = localStorage.getItem('wt_glossary');
  const savedSaveHistory = localStorage.getItem('wt_saveHistory');
  if(savedKeysRaw){
    try{
      const parsed = JSON.parse(savedKeysRaw);
      if(Array.isArray(parsed)) state.apiKeys = [parsed[0]||'', parsed[1]||'', parsed[2]||''];
    }catch(e){}
  } else if(savedKeyOld){
    // One-time migration from the pre-rotation single-key format.
    state.apiKeys = [savedKeyOld, '', ''];
  }
  state.apiKeyIndex = state.apiKeys.findIndex(k => k);
  if(state.apiKeyIndex === -1) state.apiKeyIndex = 0;
  state.apiKey = state.apiKeys[state.apiKeyIndex] || '';
  if(savedMyMemoryEnabled !== null) state.myMemoryEnabled = savedMyMemoryEnabled === '1';
  if(savedMyMemoryEmail) state.myMemoryEmail = savedMyMemoryEmail;
  if(savedProxyUrl) state.proxyUrl = savedProxyUrl;
  if(savedBackendMode) state.backendMode = savedBackendMode;
  if(savedOffline !== null) state.offlineForced = savedOffline === '1';
  if(savedRate) state.speechRate = parseFloat(savedRate);
  if(savedAutoSpeak !== null) state.autoSpeak = savedAutoSpeak === '1';
  if(savedShowSub !== null) state.showTranslatedOut = savedShowSub === '1';
  if(savedTheme === '1'){ state.lightTheme = true; document.body.classList.add('light-theme'); }
  if(savedTone) state.tone = savedTone;
  if(savedQtDomain) state.qtDomain = savedQtDomain;
  if(savedVoiceEngine) state.voiceEngine = savedVoiceEngine;
  if(savedGlossary) state.glossary = savedGlossary;
  if(savedSaveHistory !== null) state.saveHistory = savedSaveHistory === '1';

  if(state.saveHistory){
    const savedMsgs = localStorage.getItem('wt_messages');
    if(savedMsgs) state.messages = JSON.parse(savedMsgs);
  }
}catch(e){ /* storage unavailable — falls back to blank each launch */ }

renderStatusBar();
renderPanel('A');
renderPanel('B');
qtPopulateDomains();
qtRenderSuggestions();
showView('home');
liveInitLangSelects();

// First-launch onboarding: explain the rotated face-to-face panel design.
try{
  if(!localStorage.getItem('wt_onboardingSeen')){
    document.getElementById('onboardingOverlay').classList.add('show');
  }
}catch(e){}
document.getElementById('onboardingCloseBtn').addEventListener('click', ()=>{
  document.getElementById('onboardingOverlay').classList.remove('show');
  try{ localStorage.setItem('wt_onboardingSeen', '1'); }catch(e){}
});

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      // Check for a newer service-worker.js every time the app opens.
      reg.update().catch(()=>{});
    }).catch(()=>{});
  });

  // When a new service worker takes over (i.e. an update was found and
  // installed), reload once automatically so the fresh version is shown
  // without the person needing to manually clear cache.
  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(refreshed) return;
    refreshed = true;
    window.location.reload();
  });
}
