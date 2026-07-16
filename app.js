function showToast(message, type){
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fadeOut'); setTimeout(() => el.remove(), 300); }, 4200);
}

const state = {
  langA: langByCode('en'), langB: langByCode('my'), messages: [], apiKey: '', offlineForced: false,
  listening: {A:false, B:false}, translating: {A:false, B:false}, autoConversation: false, speechRate: 0.85,
  autoSpeak: true, showTranslatedOut: true, lastSent: {A: null, B: null}, lightTheme: false, tone: 'neutral',
  glossary: '', saveHistory: false, voiceEngine: 'auto', pttMode: {A: false, B: false}, currentView: 'home',
  backendMode: 'key', proxyUrl: '', qtTargetCode: 'en', qtMicCode: 'my', qtDomain: 'general', qtHistory: []
};

function otherSide(side){ return side === 'A' ? 'B' : 'A'; }

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRec) { recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = false; }

let cachedVoices = [];
function loadVoices(){ if('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices(); }
if('speechSynthesis' in window){ loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }

function pickVoice(localeCode){
  if(!cachedVoices.length) loadVoices();
  let v = cachedVoices.find(v => v.lang === localeCode);
  if(!v) v = cachedVoices.find(v => v.lang.toLowerCase() === localeCode.toLowerCase());
  if(!v) v = cachedVoices.find(v => v.lang.split('-')[0] === localeCode.split('-')[0]);
  return v || null;
}

function startStt(side){
  if(!recognition){ showToast('ဒီ browser မှာ voice recognition ကို support မလုပ်ပါ။ Chrome browser သုံးကြည့်ပါ။', 'error'); return; }
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  const lang = side === 'A' ? state.langA : state.langB;
  recognition.lang = lang.ttsLocale; recognition.continuous = false; recognition.interimResults = false;
  state.listening[side] = true; renderPanel(side); renderStatusBar();
  recognition.onresult = (e) => { const text = e.results[0][0].transcript; if(text && text.trim()) handleTranslation(text, side, true); };
  recognition.onerror = (e) => {
    stopStt();
    if(e.error === 'not-allowed' || e.error === 'permission-denied'){
      state.autoConversation = false; renderStatusBar(); showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။ Browser setting ထဲမှာ mic ခွင့်ပြုပေးပါ။', 'error');
    }
  };
  recognition.onspeechend = () => { try{ recognition.stop(); }catch(e){} };
  recognition.onend = () => { stopStt(); };
  try{ recognition.start(); } catch(e){ stopStt(); }
}
function stopStt(){ state.listening.A = false; state.listening.B = false; renderPanel('A'); renderPanel('B'); renderStatusBar(); }
function updateHoldCaption(side, text){ const el = document.getElementById('pttCaption' + side); if(!el) return; el.textContent = text || '🎙️ Listening...'; el.classList.add('show'); }
function clearHoldCaption(side){ const el = document.getElementById('pttCaption' + side); if(!el) return; el.classList.remove('show'); el.textContent = ''; }
function stopSttManual(){ if(recognition){ try{ recognition.stop(); }catch(e){} } stopStt(); }

const holdRecordingState = {};
const liveState = { ws: null, connected: false, micStream: null, micContext: null, micProcessor: null, playbackContext: null, nextPlayTime: 0 };

function floatTo16BitPCM(float32Array){
  const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer);
  for(let i = 0, offset = 0; i < float32Array.length; i++, offset += 2){
    const s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  } return buffer;
}
function arrayBufferToBase64(buffer){
  let binary = ''; const bytes = new Uint8Array(buffer);
  for(let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function pcm16Base64ToAudioBuffer(base64, audioCtx, sampleRate){
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer); const sampleCount = Math.floor(bytes.length / 2);
  const buffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  for(let i = 0; i < sampleCount; i++) channelData[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}
function scheduleLivePlayback(base64){
  const ctx = liveState.playbackContext; if(!ctx) return;
  const buffer = pcm16Base64ToAudioBuffer(base64, ctx, 24000); const source = ctx.createBufferSource();
  source.buffer = buffer; source.connect(ctx.destination);
  const now = ctx.currentTime; if(liveState.nextPlayTime < now) liveState.nextPlayTime = now;
  source.start(liveState.nextPlayTime); liveState.nextPlayTime += buffer.duration;
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
function updateLiveStatusText(text){ const el = document.getElementById('liveStatusText'); if(el) el.textContent = text; }

async function startLiveMode(){
  if(state.backendMode === 'proxy'){ showToast('Live Mode က "My Own Key" backend mode မှာသာ အလုပ်လုပ်ပါတယ် (v1) — Settings → Account ထဲမှာ ပြောင်းပေးပါ', 'warn'); return; }
  if(!state.apiKey){ showToast('Live Mode အတွက် AI Translation Key လိုအပ်ပါတယ်', 'warn'); return; }
  document.getElementById('liveBtn').classList.add('on'); document.getElementById('liveStatusBar').classList.add('show');
  document.getElementById('liveStartBtn').classList.add('on'); document.getElementById('liveBigHint').textContent = 'Connecting…';
  updateLiveStatusText('⚡ Live Interpreter connecting…'); liveAddTranscriptLine('system', 'Connecting…');
  try{ liveState.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }catch(e){ showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်', 'error'); stopLiveMode(); return; }
  const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${state.apiKey}`);
  liveState.ws = ws;
  ws.onopen = () => { ws.send(JSON.stringify({ setup: { model: 'models/gemini-3.1-flash-live-preview', generationConfig: { responseModalities: ['AUDIO'] }, systemInstruction: { parts: [{ text: liveInterpreterSystemPrompt() }] }, outputAudioTranscription: {}, inputAudioTranscription: {}, } })); };
  ws.onerror = () => { showToast('Live Mode connection error ဖြစ်သွားပါတယ်', 'error'); };
  ws.onclose = () => { if(liveState.connected) showToast('Live Mode connection ပြတ်တောက်သွားပါတယ်', 'warn'); stopLiveMode(); };
  ws.onmessage = async (event) => {
    let data = event.data; if(data instanceof Blob) data = await data.text();
    let msg; try{ msg = JSON.parse(data); }catch(e){ return; }
    if(msg.setupComplete){
      liveState.connected = true; updateLiveStatusText('⚡ Live — listening… (both sides can speak anytime)');
      document.getElementById('liveBigHint').textContent = 'Listening… tap to stop'; liveAddTranscriptLine('system', 'Connected — start speaking, either language.');
      document.getElementById('liveBtn').classList.add('pulsing'); startLiveMicCapture(); return;
    }
    const sc = msg.serverContent; if(!sc) return;
    if(sc.interrupted){ liveState.nextPlayTime = liveState.playbackContext ? liveState.playbackContext.currentTime : 0; }
    if(sc.modelTurn && sc.modelTurn.parts){
      for(const part of sc.modelTurn.parts){ const inline = part.inlineData || part.inline_data; if(inline && inline.data) scheduleLivePlayback(inline.data); }
    }
    if(sc.inputTranscription && sc.inputTranscription.text){ updateLiveStatusText('🎙️ ' + sc.inputTranscription.text); liveAddTranscriptLine('heard', sc.inputTranscription.text); }
    if(sc.outputTranscription && sc.outputTranscription.text){ updateLiveStatusText('🔊 ' + sc.outputTranscription.text); liveAddTranscriptLine('spoken', sc.outputTranscription.text); }
  };
}

function liveInitLangSelects(){
  const selA = document.getElementById('liveLangA'); const selB = document.getElementById('liveLangB');
  if(!selA || !selB) return;
  selA.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('');
  selB.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('');
  selA.value = state.langA.code; selB.value = state.langB.code;
  selA.addEventListener('change', (e) => { state.langA = langByCode(e.target.value); renderPanel('A'); renderPanel('B'); });
  selB.addEventListener('change', (e) => { state.langB = langByCode(e.target.value); renderPanel('A'); renderPanel('B'); });
}

let liveTranscriptHasContent = false;
function liveAddTranscriptLine(kind, text){
  const el = document.getElementById('liveTranscript'); if(!el) return;
  if(!liveTranscriptHasContent){ el.innerHTML = ''; liveTranscriptHasContent = true; }
  const line = document.createElement('div'); line.className = 'liveTranscriptLine ' + kind;
  const icon = kind === 'heard' ? '🎙️' : kind === 'spoken' ? '🔊' : 'ℹ️';
  line.innerHTML = `<span class="liveLineIcon">${icon}</span><span>${escapeHtml(text)}</span>`;
  el.insertBefore(line, el.firstChild);
}

document.getElementById('liveStartBtn').addEventListener('click', () => { if(liveState.ws || liveState.connected){ stopLiveMode(); } else { startLiveMode(); } });

function startLiveMicCapture(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  liveState.micContext = new AudioCtx({ sampleRate: 16000 }); liveState.playbackContext = new AudioCtx({ sampleRate: 24000 }); liveState.nextPlayTime = 0;
  const source = liveState.micContext.createMediaStreamSource(liveState.micStream);
  liveState.micProcessor = liveState.micContext.createScriptProcessor(4096, 1, 1);
  liveState.micProcessor.onaudioprocess = (e) => {
    if(!liveState.connected || !liveState.ws || liveState.ws.readyState !== WebSocket.OPEN) return;
    const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0)); const b64 = arrayBufferToBase64(pcm);
    liveState.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${liveState.micContext.sampleRate}` } } }));
  };
  const muteGain = liveState.micContext.createGain(); muteGain.gain.value = 0;
  source.connect(liveState.micProcessor); liveState.micProcessor.connect(muteGain); muteGain.connect(liveState.micContext.destination);
}

function stopLiveMode(){
  liveState.connected = false;
  if(liveState.ws){ try{ liveState.ws.close(); }catch(e){} liveState.ws = null; }
  if(liveState.micProcessor){ try{ liveState.micProcessor.disconnect(); }catch(e){} liveState.micProcessor = null; }
  if(liveState.micContext){ try{ liveState.micContext.close(); }catch(e){} liveState.micContext = null; }
  if(liveState.playbackContext){ try{ liveState.playbackContext.close(); }catch(e){} liveState.playbackContext = null; }
  if(liveState.micStream){ try{ liveState.micStream.getTracks().forEach(t => t.stop()); }catch(e){} liveState.micStream = null; }
  document.getElementById('liveBtn').classList.remove('on', 'pulsing'); document.getElementById('liveStatusBar').classList.remove('show');
  const startBtn = document.getElementById('liveStartBtn'); const hint = document.getElementById('liveBigHint');
  if(startBtn) startBtn.classList.remove('on'); if(hint) hint.textContent = 'Tap to start Live Interpreter';
}

function pickAudioMimeType(){
  if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for(const c of candidates){ if(MediaRecorder.isTypeSupported(c)) return c; } return '';
}

async function startHoldRecording(side){
  if(!window.MediaRecorder){ showToast('ဒီ browser မှာ voice recording ကို support မလုပ်ပါ။ Chrome ကို သုံးကြည့်ပါ။', 'error'); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickAudioMimeType();
    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => { if(e.data && e.data.size > 0) chunks.push(e.data); };
    holdRecordingState[side] = { stream, mediaRecorder, chunks, mimeType: mediaRecorder.mimeType || mimeType || 'audio/webm' };
    mediaRecorder.start(); startWaveform(side);
  }catch(e){ console.error('Hold recording mic access failed:', e); showToast('Microphone ခွင့်ပြုချက် လိုအပ်ပါတယ်။ Browser setting ထဲမှာ mic ခွင့်ပြုပေးပါ။', 'error'); clearHoldCaption(side); }
}

function stopHoldRecording(side){
  const r = holdRecordingState[side]; if(!r){ clearHoldCaption(side); return; }
  updateHoldCaption(side, '⏳ Processing...');
  const finish = (blob) => {
    try{ r.stream.getTracks().forEach(t => t.stop()); }catch(e){} delete holdRecordingState[side];
    if(!blob || blob.size < 500){ clearHoldCaption(side); return; }
    if(side === 'QT') qtHandleVoiceHold(blob); else handleVoiceHold(side, blob);
  };
  if(r.mediaRecorder.state === 'inactive'){ finish(new Blob(r.chunks, { type: r.mimeType })); return; }
  r.mediaRecorder.onstop = () => finish(new Blob(r.chunks, { type: r.mimeType }));
  try{ r.mediaRecorder.stop(); }catch(e){ finish(new Blob(r.chunks, { type: r.mimeType })); }
}

async function handleVoiceHold(side, blob){
  if(state.offlineForced || !hasBackend()){ showToast('Hold-to-Talk အတွက် AI Translation Key/Internet လိုအပ်ပါတယ်', 'warn'); clearHoldCaption(side); return; }
  const sourceLang = side === 'A' ? state.langA : state.langB; const targetLang = side === 'A' ? state.langB : state.langA;
  state.translating[side] = true;
  const msgId = Date.now().toString();
  state.messages.unshift({ id: msgId, sender: side, originalText: '(transcribing voice…)', translatedText: '', isVoice: true, approx: false, usedOffline: false, pending: true, timestamp: Date.now() });
  renderPanel('A'); renderPanel('B'); clearHoldCaption(side);
  try{
    const base64 = await fileToBase64(blob);
    const prompt = `Listen to this audio clip — someone speaking in ${sourceLang.name} (it could be a different language, detect it). `
      + `Step 1: Transcribe exactly what they said. `
      + `Step 2: Translate it into natural, fluent, native-sounding ${targetLang.name} — the full meaning and intent the way a native speaker would actually say it, NOT word-for-word. `
      + `Tone: ${toneInstruction()} ` + `${glossaryInstruction()}` + `${conversationContextBlock()}`
      + `Respond in EXACTLY this format with no extra commentary:\nORIGINAL: <exact transcription of what was said>\nTRANSLATED: <the natural translation into ${targetLang.name}>`;
    const streamResult = await geminiFetchStream('gemini-3.5-flash', {
      contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: blob.type || 'audio/webm', data: base64 } } ] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } }
    }, (partialRaw) => {
      const liveMsg = state.messages.find(m => m.id === msgId); if(!liveMsg) return;
      const origMatch = partialRaw.match(/ORIGINAL:\s*([\s\S]*?)(\nTRANSLATED:|$)/i); const transMatch = partialRaw.match(/TRANSLATED:\s*([\s\S]*)/i);
      if(origMatch) liveMsg.originalText = origMatch[1].trim() || '(transcribing voice…)';
      if(transMatch) liveMsg.translatedText = transMatch[1].trim(); liveMsg.pending = false; renderPanel('A'); renderPanel('B');
    });
    const msg = state.messages.find(m => m.id === msgId);
    if(!streamResult.ok){
      if(msg){ msg.originalText = '(voice message)'; msg.translatedText = `[Error] Could not process voice`; msg.errorDetail = `API Error ${streamResult.status || ''}`; msg.pending = false; }
      state.translating[side] = false; renderPanel('A'); renderPanel('B'); return;
    }
    const raw = streamResult.fullText || '';
    const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATED:/i); const transMatch = raw.match(/TRANSLATED:\s*([\s\S]*)/i);
    const originalText = origMatch ? origMatch[1].trim() : '(voice message)'; const translatedText = transMatch ? transMatch[1].trim() : raw;
    if(msg){ msg.originalText = originalText; msg.translatedText = translatedText; msg.pending = false; }
    if(originalText && translatedText) tmSave(sourceLang.code, targetLang.code, originalText, translatedText);
    state.translating[side] = false; renderPanel('A'); renderPanel('B'); vibrate(15);
    const continueAutoConversation = () => {
      if(state.autoConversation){ const replySide = otherSide(side); if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){ setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350); } }
    };
    if(state.autoSpeak) speak(translatedText, targetLang, continueAutoConversation); else continueAutoConversation();
  }catch(e){
    console.error('handleVoiceHold failed:', e); const msg = state.messages.find(m => m.id === msgId);
    if(msg){ msg.originalText = '(voice message)'; msg.translatedText = `[Error] ${e.message}`; msg.errorDetail = `Connection error: ${e.message}`; msg.pending = false; }
    state.translating[side] = false; renderPanel('A'); renderPanel('B');
  }
}

const waveformState = {}; let waveformTokenCounter = 0;
async function startWaveform(side){
  stopWaveform(side); const myToken = ++waveformTokenCounter;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtx = window.AudioContext || window.webkitAudioContext; const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream); const analyser = audioCtx.createAnalyser(); analyser.fftSize = 32;
    source.connect(analyser); const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const bars = document.querySelectorAll('#waveform' + side + ' .wfBar');
    function draw(){
      const current = waveformState[side]; if(!current || current.token !== myToken) return;
      analyser.getByteFrequencyData(dataArray);
      bars.forEach((bar, i) => { const v = dataArray[i] || 0; const pct = Math.max(12, Math.min(100, (v / 255) * 100)); bar.style.height = pct + '%'; bar.classList.remove('idle'); });
      current.rafId = requestAnimationFrame(draw);
    }
    waveformState[side] = { stream, audioCtx, analyser, rafId: null, token: myToken }; draw();
  }catch(e){}
}
function stopWaveform(side){
  const w = waveformState[side]; if(!w) return;
  if(w.rafId) cancelAnimationFrame(w.rafId);
  try{ w.stream.getTracks().forEach(t => t.stop()); }catch(e){} try{ w.audioCtx.close(); }catch(e){}
  delete waveformState[side];
  document.querySelectorAll('#waveform' + side + ' .wfBar').forEach(bar => { bar.style.height = '6px'; bar.classList.add('idle'); });
}

const ttsAudioCache = new Map(); let currentAudioEl = null; let audioUnlocked = false;
function unlockAudioPlayback(){
  if(audioUnlocked) return; audioUnlocked = true;
  try{ const silence = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='); silence.volume = 0.01; silence.play().catch(()=>{ audioUnlocked = false; }); }catch(e){ audioUnlocked = false; }
  if(window.speechSynthesis){ try{ window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); }catch(e){} }
}
['pointerdown','touchstart','click'].forEach(evt => { document.addEventListener(evt, unlockAudioPlayback, { once: true, passive: true }); });

function pcmBase64ToWavBlob(base64, sampleRate){
  const binary = atob(base64); const len = binary.length; const pcmBytes = new Uint8Array(len);
  for(let i = 0; i < len; i++) pcmBytes[i] = binary.charCodeAt(i);
  const header = new ArrayBuffer(44); const view = new DataView(header);
  const writeStr = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + len, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, 'data'); view.setUint32(40, len, true);
  return new Blob([header, pcmBytes], { type: 'audio/wav' });
}

function hasBackend(){ if(state.backendMode === 'proxy') return !!state.proxyUrl; return !!state.apiKey; }

async function geminiFetch(model, payload){
  if(state.backendMode === 'proxy' && state.proxyUrl){ return fetch(state.proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, payload }), }); }
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey }, body: JSON.stringify(payload), });
}

async function geminiFetchStream(model, payload, onChunk){
  const useProxy = state.backendMode === 'proxy' && state.proxyUrl;
  if(useProxy || !window.ReadableStream){
    const resp = await geminiFetch(model, payload);
    if(!resp.ok) return { ok: false, status: resp.status, resp };
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const finishReason = data?.candidates?.[0]?.finishReason;
    if(text) onChunk(text); return { ok: true, fullText: text, finishReason };
  }
  let resp;
  try{ resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey }, body: JSON.stringify(payload), }); }catch(e){ return { ok: false, error: e }; }
  if(!resp.ok || !resp.body){ return { ok: false, status: resp.status, resp }; }
  const reader = resp.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let fullText = ''; let finishReason = null;
  while(true){
    const { done, value } = await reader.read(); if(done) break;
    buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
    for(const line of lines){
      const trimmed = line.trim(); if(!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim(); if(!jsonStr || jsonStr === '[DONE]') continue;
      try{
        const obj = JSON.parse(jsonStr); const piece = obj?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if(piece){ fullText += piece; onChunk(fullText); }
        if(obj?.candidates?.[0]?.finishReason) finishReason = obj.candidates[0].finishReason;
      }catch(e){}
    }
  }
  return { ok: true, fullText, finishReason };
}

async function speakViaGemini(text, onDone){
  try{
    let url = ttsAudioCache.get(text);
    if(!url){
      const resp = await geminiFetch('gemini-3.1-flash-tts-preview', { contents: [{ parts: [{ text: text }] }], generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 8192, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } });
      if(!resp.ok) throw new Error('TTS API ' + resp.status);
      const data = await resp.json(); const finishReason = data?.candidates?.[0]?.finishReason;
      if(finishReason === 'MAX_TOKENS') throw new Error('TTS truncated');
      const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
      const inline = part?.inlineData || part?.inline_data; if(!inline?.data) throw new Error('No audio');
      const wavBlob = pcmBase64ToWavBlob(inline.data, 24000); url = URL.createObjectURL(wavBlob); ttsAudioCache.set(text, url);
      if(ttsAudioCache.size > 60){ const oldestKey = ttsAudioCache.keys().next().value; const oldestUrl = ttsAudioCache.get(oldestKey); try{ URL.revokeObjectURL(oldestUrl); }catch(e){} ttsAudioCache.delete(oldestKey); }
    }
    if(currentAudioEl){ try{ currentAudioEl.pause(); }catch(e){} }
    const audio = new Audio(url); audio.playbackRate = state.speechRate; currentAudioEl = audio;
    let fired = false; const finish = () => { if(fired) return; fired = true; if(onDone) onDone(); }; audio.onended = finish; audio.onerror = finish; await audio.play(); return true;
  } catch(e){ return false; }
}

function speakLocal(text, lang, onDone){
  if(!('speechSynthesis' in window) || !text){ if(onDone) onDone(); return; }
  window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); const voice = pickVoice(lang.ttsLocale);
  if(voice){ u.voice = voice; u.lang = voice.lang; } else { u.lang = lang.ttsLocale; }
  u.rate = state.speechRate; let fired = false; const finish = () => { if(fired) return; fired = true; if(onDone) onDone(); }; u.onend = finish; u.onerror = finish; window.speechSynthesis.speak(u);
}

async function speak(text, lang, onDone){
  if(!text){ if(onDone) onDone(); return; }
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  const engine = state.voiceEngine || 'auto';
  if(engine === 'device'){ speakLocal(text, lang, onDone); return; }
  const canUseAi = !state.offlineForced && hasBackend();
  if(engine === 'ai' && !canUseAi){ showToast('AI Voice အတွက် Internet/API Key လိုအပ်ပါတယ် — device voice ကို ယာယီသုံးပါမယ်', 'warn'); }
  if(canUseAi){ const ok = await speakViaGemini(text, onDone); if(ok) return; if(engine === 'ai'){ showToast('AI Voice မရနိုင်ပါ — device voice ကို ယာယီသုံးပါမယ်', 'warn'); } }
  speakLocal(text, lang, onDone);
}

function toneInstruction(){
  if(state.tone === 'formal') return 'Use a formal, respectful, professional register appropriate for business or official contexts.';
  if(state.tone === 'casual') return 'Use a casual, friendly, relaxed everyday tone, like talking to a close friend.';
  return 'Use a natural, neutral everyday tone — polite but not overly formal, not overly casual.';
}
function glossaryInstruction(){
  if(!state.glossary) return ''; const terms = state.glossary.split('\n').map(t => t.trim()).filter(Boolean); if(!terms.length) return '';
  return `\nThese specific words/names must be kept EXACTLY as written in the original, never translated: ${terms.join(', ')}.\n`;
}
function conversationContextBlock(){
  const recent = state.messages.slice(0, 5).filter(m => !m.pending).reverse(); if(!recent.length) return '';
  const lines = recent.map(m => `${m.sender === 'A' ? 'Person A' : 'Person B'}: ${m.originalText}`).join('\n');
  return `\nRecent conversation so far (for context only — helps with pronouns/references like "he/she/it/that"; do NOT translate this part, only translate the new message below):\n${lines}\n`;
}

async function handleTranslation(rawText, sender, isVoice){
  rawText = (rawText || '').trim(); if(!rawText) return;
  const now = Date.now();
  if(state.lastSent[sender] && state.lastSent[sender].text === rawText && now - state.lastSent[sender].at < 1200){ return; }
  state.lastSent[sender] = { text: rawText, at: now };
  const isA = sender === 'A'; state.translating[sender] = true;
  if(isA){ document.getElementById('inputA').value = ''; } else { document.getElementById('inputB').value = ''; }
  const sourceLang = isA ? state.langA : state.langB; const targetLang = isA ? state.langB : state.langA;
  const msgId = Date.now().toString();
  state.messages.unshift({ id: msgId, sender, originalText: rawText, translatedText: '', isVoice: !!isVoice, approx: false, usedOffline: false, pending: true, timestamp: Date.now() });
  renderPanel('A'); renderPanel('B');

  let translated = ''; let approx = false; let usedOffline = false; let errorDetail = '';

  async function fallbackOffline(prefix){
    usedOffline = true; const remembered = tmLookup(sourceLang.code, targetLang.code, rawText);
    if(remembered){ translated = remembered; approx = false; return; }
    const off = offlineTranslate(rawText, sourceLang.code, targetLang.code);
    if(off){ translated = off.text; approx = off.approx; } else { translated = `${prefix} ${rawText}`; approx = true; }
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
        + `Tone: ${toneInstruction()}\n` + `${glossaryInstruction()}` + `${conversationContextBlock()}`
        + `\nRules:\n`
        + `- If translating into Burmese, use natural, everyday spoken Burmese (not overly formal/literary), unless Tone above says otherwise.\n`
        + `- If translating into Chinese, use the polite/respectful form (您) unless the tone is clearly casual.\n`
        + `- If translating into Thai, include natural polite particles (ครับ/ค่ะ) where appropriate.\n`
        + `- If translating into English, use natural, conversational English.\n\n`
        + `Return ONLY the translated sentence itself — no explanations, no notes, no quotation marks, no pronunciation guides.\n\n`
        + `Message to translate now: "${rawText}"`;

      const streamResult = await geminiFetchStream('gemini-3.5-flash', { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } } }, (partialText) => {
        const liveMsg = state.messages.find(m => m.id === msgId);
        if(liveMsg){ liveMsg.translatedText = partialText; liveMsg.pending = false; renderPanel('A'); renderPanel('B'); }
      });

      if(streamResult.ok){
        const text = (streamResult.fullText || '').trim();
        if(text){ translated = text; tmSave(sourceLang.code, targetLang.code, rawText, translated); }
        else { errorDetail = `Empty response (finishReason: ${streamResult.finishReason || 'unknown'})`; await fallbackOffline('[Empty response]'); }
      } else {
        let bodyText = ''; try{ bodyText = streamResult.resp ? await streamResult.resp.text() : ''; }catch(e2){}
        errorDetail = `API Error ${streamResult.status || ''}: ${bodyText.slice(0, 200)}`; await fallbackOffline('[Network Error]');
      }
    } catch(e){
      errorDetail = `Connection error: ${e.message} — VPN/firewall ရှိရင် ပိတ်ကြည့်ပါ, Wi-Fi/mobile data ပြောင်းကြည့်ပါ`; await fallbackOffline('[Error Connection]');
    }
  }

  const msg = state.messages.find(m => m.id === msgId);
  if(msg){ msg.translatedText = translated; msg.approx = approx; msg.usedOffline = usedOffline; msg.errorDetail = errorDetail; msg.pending = false; }
  state.translating[sender] = false; renderPanel('A'); renderPanel('B'); vibrate(15);
  const continueAutoConversation = () => {
    if(state.autoConversation){
      const replySide = otherSide(sender);
      if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){ setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350); }
    }
  };
  if(state.autoSpeak){ speak(translated, targetLang, continueAutoConversation); } else { continueAutoConversation(); }
}

let currentScanSide = null;
function fileToBase64(file){ return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }

async function scanAndTranslate(file, side){
  const isA = side === 'A'; const sourceLang = isA ? state.langA : state.langB; const targetLang = isA ? state.langB : state.langA;
  if(state.offlineForced || !hasBackend()){ showToast('Scan feature အတွက် AI Translation Key လိုအပ်ပါတယ်။ Settings ထဲမှာ ထည့်ပေးပါ။', 'warn'); return; }
  state.translating[side] = true;
  const scanMsgId = Date.now().toString();
  state.messages.unshift({ id: scanMsgId, sender: side, originalText: '(scanning photo…)', translatedText: '', isVoice: false, isScan: true, approx: false, usedOffline: false, pending: true, timestamp: Date.now() });
  renderPanel('A'); renderPanel('B');
  try{
    const base64 = await fileToBase64(file); const isImage = file.type && file.type.startsWith('image/'); const photoUrl = isImage ? `data:${file.type};base64,${base64}` : null;
    const prompt = `This file (a photo or PDF document — a sign, label, document, screen, form, or handwriting) contains visible text, likely in ${sourceLang.name} but it could be in any language. `
      + `Step 1: Read every piece of text visible exactly as written (if it's a multi-page PDF, read all pages). `
      + `Step 2: Translate it into natural, fluent, native-sounding ${targetLang.name} — translate the full meaning and intent the way a native speaker would actually say it, NOT word-for-word. `
      + `Tone: ${toneInstruction()} ` + `${glossaryInstruction()}`
      + `Respond in EXACTLY this format with no extra commentary:\nORIGINAL: <the text you read>\nTRANSLATED: <the natural translation into ${targetLang.name}>`;
    const resp = await geminiFetch('gemini-3.5-flash', { contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } } ] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' }, mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' } });
    if(!resp.ok){
      showToast(`Scan translation မအောင်မြင်ပါ (Error ${resp.status})`, 'error'); state.messages = state.messages.filter(m => m.id !== scanMsgId); state.translating[side] = false; renderPanel('A'); renderPanel('B'); return;
    }
    const data = await resp.json(); const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
    const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATED:/i); const transMatch = raw.match(/TRANSLATED:\s*([\s\S]*)/i);
    const originalText = origMatch ? origMatch[1].trim() : '(scanned image)'; const translatedText = transMatch ? transMatch[1].trim() : raw;
    const scanMsg = state.messages.find(m => m.id === scanMsgId);
    if(scanMsg){ scanMsg.originalText = originalText; scanMsg.translatedText = translatedText; scanMsg.photoUrl = photoUrl; scanMsg.pending = false; }
    state.translating[side] = false; renderPanel('A'); renderPanel('B');
    const continueAutoConversation = () => { if(state.autoConversation){ const replySide = otherSide(side); if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){ setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350); } } };
    if(state.autoSpeak){ speak(translatedText, targetLang, continueAutoConversation); } else { continueAutoConversation(); }
    return;
  } catch(e){
    showToast(`Scan translation အမှားတစ်ခုဖြစ်သွားပါတယ်: ${e.message}`, 'error'); state.messages = state.messages.filter(m => m.id !== scanMsgId);
  }
  state.translating[side] = false; renderPanel('A'); renderPanel('B');
}

document.getElementById('scanInput').addEventListener('change', (e)=>{ const file = e.target.files && e.target.files[0]; if(file && currentScanSide){ scanAndTranslate(file, currentScanSide); } e.target.value = ''; });

function svgMic(){return `<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>`;}
function svgKeyboard(){return `<svg viewBox="0 0 24 24"><path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zM7 8h2v2H7V8zm0 3h2v2H7v-2zm-3 0h2v2H4v-2zm0-3h2v2H4V8zm12 7H8v-2h8v2zm0-4h-2V9h2v2zm0-3h-2V8h2v2zm3 3h-2V9h2v2zm0-3h-2V8h2v2z"/></svg>`;}
function svgWalkieTalkie(){return `<svg viewBox="0 0 24 24"><rect x="7" y="6.5" width="10" height="15" rx="2.2"/><rect x="8.7" y="2" width="2" height="5" rx="1"/><circle cx="12" cy="10.3" r="1.3" fill="#0C0D12"/><rect x="9" y="13.2" width="6" height="5.3" rx="1" fill="#0C0D12"/></svg>`;}
function svgSend(){return `<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>`;}
function svgPlay(){return `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;}
function svgCopy(){return `<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`;}
function svgCheck(){return `<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`;}
function svgVerify(){return `<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 8.74A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v4l5-5-5-5v4z"/></svg>`;}
function svgBook(){return `<svg viewBox="0 0 24 24"><path fill="#fff" d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h5v8l2.5-1.5L16 12V4h2v16z"/></svg>`;}
function svgTranslate(){return `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.05 4.98L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;}
function svgCamera(){return `<svg viewBox="0 0 24 24"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2l-1.83 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>`;}

function renderPanel(side){
  if(side === 'A' && state.saveHistory){ try{ const trimmed = state.messages.slice(0, 200); localStorage.setItem('wt_messages', JSON.stringify(trimmed)); }catch(e){} }
  const isA = side === 'A'; const container = document.getElementById('panel' + side);
  const currentLang = isA ? state.langA : state.langB; const otherLang = isA ? state.langB : state.langA;
  const accent = isA ? 'var(--cyan)' : 'var(--red)'; const isListening = state.listening[side]; const isTranslating = state.translating[side];

  container.innerHTML = `
    <div class="panel-header">
      <div class="who"><div class="dot" style="background:${accent}"></div><div class="label">${isA ? 'Colleague Perspective' : 'My Perspective'}</div></div>
      <select class="langSelect" id="select${side}">
        ${LANGUAGES.map(l => `<option value="${l.code}" ${l.code===currentLang.code?'selected':''} ${l.code===otherLang.code?'disabled':''}>${langOptionLabel(l)}</option>`).join('')}
      </select>
    </div>
    <div class="chatLog" id="chatLog${side}"></div>
    <div class="pttCaption" id="pttCaption${side}"></div>
    <div class="inputRow">
      <button class="modeToggleBtn ${state.pttMode[side]?'active':''}" id="modeToggle${side}">${state.pttMode[side] ? svgKeyboard() : svgWalkieTalkie()}</button>
      <div class="textFieldWrap" id="textFieldWrap${side}" style="${state.pttMode[side]?'display:none;':''}"><input type="text" id="input${side}" placeholder="Type message to translate..." ${isA ? 'readonly' : ''}><button class="sendBtn" id="sendBtn${side}">${svgSend()}</button></div>
      <div class="pttWrap" id="pttWrap${side}" style="${state.pttMode[side]?'':'display:none;'}">
        <div class="waveformBox" id="waveform${side}">${Array.from({length:9}).map(()=>'<div class="wfBar idle" style="height:6px;"></div>').join('')}</div>
        <button class="pttCircle ${isListening?'recording':''}" id="pttCircle${side}">${svgMic()}</button>
      </div>
    </div>
    <div class="toolbarRow">
      <button class="camBtn ${isTranslating?'busy':''}" id="cam${side}">${svgCamera()}</button>
      <button class="camBtn" id="phrasebook${side}">${svgBook()}</button>
      <button class="camBtn ${isListening&&!state.pttMode[side]?'listening '+side:''} ${isTranslating?'busy':''}" id="mic${side}">${isTranslating ? '<div class="spinner" style="width:16px;height:16px;"></div>' : svgMic()}</button>
      <div class="pttHint" style="flex:1;text-align:right;padding-right:2px;">${state.pttMode[side] ? '🎙️ Hold circle to talk' : ''}</div>
    </div>
  `;
  renderChatLog(side);
  document.getElementById('select'+side).addEventListener('change', (e)=>{ const newLang = langByCode(e.target.value); if(isA) state.langA = newLang; else state.langB = newLang; renderPanel('A'); renderPanel('B'); });
  document.getElementById('sendBtn'+side).addEventListener('click', ()=>{ vibrate(10); const input = document.getElementById('input'+side); handleTranslation(input.value, side, false); });
  document.getElementById('input'+side).addEventListener('keydown', (e)=>{ if(e.key === 'Enter') handleTranslation(e.target.value, side, false); });
  if(isA){ document.getElementById('inputA').addEventListener('click', ()=>{ openTypeOverlay('A'); }); }
  const micBtn = document.getElementById('mic'+side);
  micBtn.addEventListener('click', (e)=>{ e.preventDefault(); if(isTranslating) return; if(state.listening[side]){ stopSttManual(); } else { vibrate(10); startStt(side); } });
  document.getElementById('modeToggle'+side).addEventListener('click', ()=>{ if(state.listening[side]) stopSttManual(); state.pttMode[side] = !state.pttMode[side]; vibrate(10); renderPanel(side); });
  const pttCircle = document.getElementById('pttCircle'+side); let pttHoldActive = false;
  pttCircle.addEventListener('pointerdown', (e)=>{
    e.preventDefault(); if(isTranslating) return; try{ pttCircle.setPointerCapture(e.pointerId); }catch(err){}
    pttHoldActive = true; vibrate(15); pttCircle.classList.add('recording'); updateHoldCaption(side, '🎙️ Recording... release to send'); startHoldRecording(side);
  });
  const endPttHold = ()=>{ if(!pttHoldActive) return; pttHoldActive = false; vibrate(10); pttCircle.classList.remove('recording'); stopWaveform(side); stopHoldRecording(side); };
  pttCircle.addEventListener('pointerup', endPttHold); pttCircle.addEventListener('pointercancel', endPttHold);
  const camBtn = document.getElementById('cam'+side);
  camBtn.addEventListener('click', (e)=>{ e.preventDefault(); if(isTranslating) return; currentScanSide = side; document.getElementById('scanInput').click(); });
  const phrasebookBtn = document.getElementById('phrasebook'+side);
  phrasebookBtn.addEventListener('click', (e)=>{ e.preventDefault(); pbOpen(side); });
}

function renderChatLog(side){
  const el = document.getElementById('chatLog'+side);
  if(state.messages.length === 0){ el.innerHTML = `<div class="emptyState">${svgTranslate()}<br>No communications logged.<br>Tap &amp; hold Mic or type to speak.</div>`; return; }
  el.innerHTML = state.messages.map(msg => {
    const isMine = msg.sender === side; const originalLabel = isMine ? 'Original' : 'Received (Translated)'; const translationLabel = isMine ? 'Translated Out' : 'Original Source';
    const accent = msg.sender === 'A' ? 'var(--cyan)' : 'var(--red)'; const mainRaw = isMine ? msg.originalText : msg.translatedText; const subRaw = isMine ? msg.translatedText : msg.originalText;
    const showMainPending = msg.pending && !isMine; const showSubPending = msg.pending && isMine; const mainSide = side; const subSide = otherSide(side); const hideSub = isMine && !state.showTranslatedOut;
    return `
      <div class="bubbleRow ${isMine?'mine':'theirs'}">
        <div class="bubble">
          <div class="topRow">
            <span class="tag" style="color:${accent}">${isMine ? originalLabel : translationLabel}</span>
            <div class="badges">${msg.isVoice ? `<svg class="voiceIcon" viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/></svg>` : ''}${msg.isScan ? `<span class="scanBadge">📷 scan</span>` : ''}${msg.usedOffline ? (msg.approx ? `<span class="offlineBadge">offline</span>` : `<span class="memoryBadge">✓ remembered</span>`) : ''}${msg.approx ? `<span class="approxBadge">≈ approx</span>` : ''}</div>
          </div>
          ${msg.photoUrl ? `<img src="${msg.photoUrl}" class="scanThumb">` : ''}
          <div class="mainText">${showMainPending ? '<span class="dotFlicker">translating…</span>' : escapeHtml(mainRaw)}</div>
          ${showMainPending ? '' : `<div class="miniControls"><button class="iconBtn" onclick='playBlock(${JSON.stringify(mainRaw)}, "${mainSide}")'>${svgPlay()}</button><button class="iconBtn" onclick='copyBlock(${JSON.stringify(mainRaw)}, this)'>${svgCopy()}</button></div>`}
          ${hideSub ? '' : `<hr><div class="subRow"><span class="subLabel">${isMine ? translationLabel : originalLabel}</span></div><div class="subText">${showSubPending ? '<span class="dotFlicker">translating…</span>' : escapeHtml(subRaw)}</div>${showSubPending ? '' : `<div class="miniControls"><button class="iconBtn" onclick='playBlock(${JSON.stringify(subRaw)}, "${subSide}")'>${svgPlay()}</button><button class="iconBtn" onclick='copyBlock(${JSON.stringify(subRaw)}, this)'>${svgCopy()}</button>${isMine ? `<button class="iconBtn" onclick='verifyBlock("${msg.id}", ${JSON.stringify(subRaw)}, "${subSide}", "${mainSide}", this)'>${svgVerify()}</button>` : ''}</div>${isMine ? `<div id="verify-${msg.id}"></div>` : ''}`}`}
          ${msg.errorDetail ? `<div class="errorDetail">⚠ ${escapeHtml(msg.errorDetail)}</div>` : ''}
          ${msg.timestamp ? `<div class="msgTime">${formatTime(msg.timestamp)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function playBlock(text, side){ const lang = side === 'A' ? state.langA : state.langB; speak(text, lang); }
async function verifyBlock(msgId, text, fromSide, toSide, btnEl){
  if(state.offlineForced || !hasBackend()){ showToast('Verify feature အတွက် AI Translation Key လိုအပ်ပါတယ်', 'warn'); return; }
  const fromLang = fromSide === 'A' ? state.langA : state.langB; const toLang = toSide === 'A' ? state.langA : state.langB;
  const target = document.getElementById('verify-' + msgId); btnEl.disabled = true; const originalIcon = btnEl.innerHTML; btnEl.innerHTML = '<span class="dotFlicker">…</span>';
  try{
    const prompt = `Translate the following ${fromLang.name} text into ${toLang.name} as literally and accurately as possible (this is for a back-translation accuracy check, not for natural conversation — precision matters more than fluency here). Return ONLY the translation, nothing else.\n\nText: "${text}"`;
    const resp = await geminiFetch('gemini-3.5-flash', { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'minimal' } } });
    if(resp.ok){ const data = await resp.json(); const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim(); if(target && raw){ target.innerHTML = `<div class="verifyNote"><b>🔄 Back-translation check:</b> ${escapeHtml(raw)}</div>`; } } else { showToast('Verify မအောင်မြင်ပါ — ပြန်စမ်းကြည့်ပါ', 'error'); }
  } catch(e){ showToast('Verify အမှားဖြစ်သွားပါတယ်: ' + e.message, 'error'); }
  btnEl.innerHTML = originalIcon; btnEl.disabled = false;
}
async function copyBlock(text, btnEl){
  try{ await navigator.clipboard.writeText(text); }catch(e){ const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e2){} document.body.removeChild(ta); }
  const original = btnEl.innerHTML; btnEl.innerHTML = svgCheck(); btnEl.disabled = true; vibrate(8); setTimeout(()=>{ btnEl.innerHTML = original; btnEl.disabled = false; }, 1100);
}
function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
function formatTime(ts){ const d = new Date(ts); let h = d.getHours(); const m = d.getMinutes().toString().padStart(2, '0'); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12; if(h === 0) h = 12; return `${h}:${m} ${ampm}`; }
function escapeHtml(str){ const d = document.createElement('div'); d.innerText = str; return d.innerHTML; }

function renderStatusBar(){
  const bar = document.getElementById('statusBar'); const text = document.getElementById('statusText'); const online = !state.offlineForced && hasBackend();
  bar.classList.toggle('online', online); text.textContent = online ? 'Live Translation Active' : 'Offline Mode (Limited)';
  const autoBtn = document.getElementById('autoBtn'); const isActive = state.autoConversation || state.listening.A || state.listening.B;
  autoBtn.classList.toggle('on', state.autoConversation); autoBtn.classList.toggle('pulsing', state.autoConversation && isActive);
}
['autoBtn', 'settingsBtn', 'liveBtn'].forEach(id => { document.getElementById(id).addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); document.getElementById(id).click(); } }); });
document.getElementById('liveBtn').addEventListener('click', ()=>{ if(liveState.ws || liveState.connected){ stopLiveMode(); } else { startLiveMode(); } });
document.getElementById('liveStopBtn').addEventListener('click', (e)=>{ e.stopPropagation(); stopLiveMode(); });
document.getElementById('autoBtn').addEventListener('click', ()=>{
  state.autoConversation = !state.autoConversation; if(!state.autoConversation){ if(recognition){ try{ recognition.stop(); }catch(e){} } stopStt(); } renderStatusBar();
});

const overlay = document.getElementById('modalOverlay');
document.querySelectorAll('.settingsTab').forEach(tab => { tab.addEventListener('click', () => { document.querySelectorAll('.settingsTab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); const target = tab.dataset.tab; document.querySelectorAll('.settingsPane').forEach(pane => { pane.style.display = pane.dataset.pane === target ? 'block' : 'none'; }); }); });
document.getElementById('settingsBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.settingsTab').forEach(t => t.classList.remove('active')); document.querySelector('.settingsTab[data-tab="account"]').classList.add('active'); document.querySelectorAll('.settingsPane').forEach(pane => { pane.style.display = pane.dataset.pane === 'account' ? 'block' : 'none'; });
  document.getElementById('apiKeyInput').value = state.apiKey; document.getElementById('proxyUrlInput').value = state.proxyUrl; document.getElementById('ownKeyFields').style.display = state.backendMode === 'proxy' ? 'none' : 'block'; document.getElementById('proxyFields').style.display = state.backendMode === 'proxy' ? 'block' : 'none'; document.querySelectorAll('#backendModeRow .speedBtn').forEach(btn => { btn.classList.toggle('active', btn.dataset.mode === state.backendMode); });
  document.getElementById('offlineToggle').checked = state.offlineForced; document.getElementById('autoSpeakToggle').checked = state.autoSpeak; document.getElementById('showTranslatedOutToggle').checked = state.showTranslatedOut; document.getElementById('lightThemeToggle').checked = state.lightTheme; document.getElementById('saveHistoryToggle').checked = state.saveHistory; document.getElementById('glossaryInput').value = state.glossary; document.getElementById('versionFooter').textContent = 'Walkie-Talkie Translator · v' + APP_VERSION;
  clearHistoryArmed = false; clearTimeout(clearHistoryResetTimer); const chBtn = document.getElementById('clearHistoryBtn'); chBtn.textContent = '🗑 Clear History'; chBtn.style.borderColor = ''; chBtn.style.color = '';
  document.querySelectorAll('#speedRow .speedBtn').forEach(btn => { btn.classList.toggle('active', parseFloat(btn.dataset.rate) === state.speechRate); }); document.querySelectorAll('#toneRow .speedBtn').forEach(btn => { btn.classList.toggle('active', btn.dataset.tone === state.tone); }); document.querySelectorAll('#voiceEngineRow .speedBtn').forEach(btn => { btn.classList.toggle('active', btn.dataset.engine === state.voiceEngine); }); overlay.classList.add('show');
});
document.querySelectorAll('#backendModeRow .speedBtn').forEach(btn => { btn.addEventListener('click', ()=>{ document.getElementById('ownKeyFields').style.display = btn.dataset.mode === 'proxy' ? 'none' : 'block'; document.getElementById('proxyFields').style.display = btn.dataset.mode === 'proxy' ? 'block' : 'none'; }); });
document.querySelectorAll('.speedBtn').forEach(btn => { btn.addEventListener('click', ()=>{ const row = btn.closest('.speedRow'); row.querySelectorAll('.speedBtn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }); });
document.getElementById('cancelBtn').addEventListener('click', ()=> overlay.classList.remove('show'));
document.getElementById('exportHistoryBtn').addEventListener('click', async ()=>{
  if(!state.messages.length){ showToast('Export လုပ်စရာ message မရှိသေးပါ', 'warn'); return; }
  const lines = []; lines.push('Walkie-Talkie Translator — Conversation Export'); lines.push('Exported: ' + new Date().toLocaleString()); lines.push('='.repeat(44)); lines.push('');
  const chronological = [...state.messages].reverse().filter(m => !m.pending);
  chronological.forEach(m => { const who = m.sender === 'A' ? 'Person A' : 'Person B'; const time = m.timestamp ? formatTime(m.timestamp) : ''; lines.push(`[${time}] ${who}`); lines.push(`  Original:   ${m.originalText}`); lines.push(`  Translated: ${m.translatedText}`); lines.push(''); });
  const text = lines.join('\n'); const filename = `conversation-${new Date().toISOString().slice(0,10)}.txt`;
  try{ const file = new File([text], filename, {type:'text/plain'}); if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:'Conversation Export'}); return; } }catch(e){}
  const blob = new Blob([text], {type:'text/plain'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url), 3000); showToast('Conversation ကို download လုပ်ပြီးပါပြီ။');
});
let clearHistoryArmed = false; let clearHistoryResetTimer = null;
document.getElementById('clearHistoryBtn').addEventListener('click', (e)=>{
  const btn = e.currentTarget;
  if(!clearHistoryArmed){ clearHistoryArmed = true; btn.textContent = '⚠️ သေချာလား?'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'; clearHistoryResetTimer = setTimeout(()=>{ clearHistoryArmed = false; btn.textContent = '🗑 Clear History'; btn.style.borderColor = ''; btn.style.color = ''; }, 3000); return; }
  clearTimeout(clearHistoryResetTimer); clearHistoryArmed = false; btn.textContent = '🗑 Clear History'; btn.style.borderColor = ''; btn.style.color = ''; state.messages = []; try{ localStorage.removeItem('wt_messages'); }catch(e){} renderPanel('A'); renderPanel('B'); showToast('Conversation history ကို ရှင်းလိုက်ပါပြီ။'); vibrate(20);
});
document.getElementById('applyBtn').addEventListener('click', ()=>{
  state.apiKey = document.getElementById('apiKeyInput').value.trim(); state.proxyUrl = document.getElementById('proxyUrlInput').value.trim();
  const activeBackendBtn = document.querySelector('#backendModeRow .speedBtn.active'); if(activeBackendBtn) state.backendMode = activeBackendBtn.dataset.mode;
  state.offlineForced = document.getElementById('offlineToggle').checked; state.autoSpeak = document.getElementById('autoSpeakToggle').checked; state.showTranslatedOut = document.getElementById('showTranslatedOutToggle').checked; state.lightTheme = document.getElementById('lightThemeToggle').checked; state.saveHistory = document.getElementById('saveHistoryToggle').checked; state.glossary = document.getElementById('glossaryInput').value.trim();
  document.body.classList.toggle('light-theme', state.lightTheme);
  const activeSpeedBtn = document.querySelector('#speedRow .speedBtn.active'); if(activeSpeedBtn) state.speechRate = parseFloat(activeSpeedBtn.dataset.rate);
  const activeToneBtn = document.querySelector('#toneRow .speedBtn.active'); if(activeToneBtn) state.tone = activeToneBtn.dataset.tone;
  const activeEngineBtn = document.querySelector('#voiceEngineRow .speedBtn.active'); if(activeEngineBtn) state.voiceEngine = activeEngineBtn.dataset.engine;
  try{ localStorage.setItem('wt_apiKey', state.apiKey); localStorage.setItem('wt_proxyUrl', state.proxyUrl); localStorage.setItem('wt_backendMode', state.backendMode); localStorage.setItem('wt_offlineForced', state.offlineForced ? '1' : '0'); localStorage.setItem('wt_speechRate', String(state.speechRate)); localStorage.setItem('wt_autoSpeak', state.autoSpeak ? '1' : '0'); localStorage.setItem('wt_showTranslatedOut', state.showTranslatedOut ? '1' : '0'); localStorage.setItem('wt_lightTheme', state.lightTheme ? '1' : '0'); localStorage.setItem('wt_tone', state.tone); localStorage.setItem('wt_voiceEngine', state.voiceEngine); localStorage.setItem('wt_glossary', state.glossary); localStorage.setItem('wt_saveHistory', state.saveHistory ? '1' : '0'); if(state.saveHistory){ localStorage.setItem('wt_messages', JSON.stringify(state.messages.slice(0, 200))); } else { localStorage.removeItem('wt_messages'); } }catch(e){}
  overlay.classList.remove('show'); renderStatusBar(); renderPanel('A'); renderPanel('B'); showToast('Settings သိမ်းပြီးပါပြီ။');
});
overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.classList.remove('show'); });

function qtPopulateDomains(){ const sel = document.getElementById('qtDomain'); sel.innerHTML = WORK_DOMAINS.map(d => `<option value="${d.code}">${d.label}</option>`).join(''); sel.value = state.qtDomain; }
function qtRenderSuggestions(){
  const el = document.getElementById('qtSuggestions'); const domain = domainByCode(state.qtDomain); if(!domain.suggestions.length){ el.innerHTML = ''; return; }
  el.innerHTML = domain.suggestions.map(s => `<div class="qtSuggestChip" data-text="${escapeHtml(s).replace(/"/g,'&quot;')}">${escapeHtml(s)}</div>`).join('');
  el.querySelectorAll('.qtSuggestChip').forEach(chip => { chip.addEventListener('click', () => { vibrate(10); qtTranslate(chip.dataset.text); }); });
}
document.getElementById('qtDomain').addEventListener('change', (e)=>{ state.qtDomain = e.target.value; try{ localStorage.setItem('wt_qtDomain', state.qtDomain); }catch(err){} qtRenderSuggestions(); });

function qtPopulateSelects(){
  const targetSel = document.getElementById('qtTargetLang'); const micSel = document.getElementById('qtMicLang');
  targetSel.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${langOptionLabel(l)}</option>`).join(''); micSel.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${langOptionLabel(l)}</option>`).join('');
  targetSel.value = state.qtTargetCode; micSel.value = state.qtMicCode; qtPopulateDomains(); qtRenderSuggestions();
}

function showView(view){
  state.currentView = view; document.getElementById('homeScreen').style.display = view === 'home' ? 'flex' : 'none'; document.getElementById('panelA').style.display = view === 'conversation' ? 'flex' : 'none'; document.getElementById('divider').style.display = view === 'conversation' ? 'flex' : 'none'; document.getElementById('panelB').style.display = view === 'conversation' ? 'flex' : 'none'; document.getElementById('quickPanel').style.display = view === 'quick' ? 'flex' : 'none'; document.getElementById('livePanel').style.display = view === 'live' ? 'flex' : 'none'; document.getElementById('homeBtn').classList.toggle('show', view !== 'home');
}
document.querySelectorAll('.homeCard').forEach(card => { card.addEventListener('click', () => { const view = card.dataset.view; vibrate(10); if(view === 'settings'){ document.getElementById('settingsBtn').click(); return; } showView(view); }); });
document.getElementById('homeBtn').addEventListener('click', () => { vibrate(10); showView('home'); });
document.getElementById('qtTargetLang').addEventListener('change', (e) => { state.qtTargetCode = e.target.value; }); document.getElementById('qtMicLang').addEventListener('change', (e) => { state.qtMicCode = e.target.value; });

function qtRenderHistory(){
  const el = document.getElementById('qtHistory');
  if(!state.qtHistory.length){ el.innerHTML = '<div class="qtEmpty">မသိတဲ့ စာသားကို ကူးထည့်ပါ၊ ဓာတ်ပုံရိုက်ပါ၊<br>သို့မဟုတ် အသံနဲ့ မေးပါ — AI က ရွေးထားတဲ့ဘာသာစကားသို့ တိကျစွာ ပြန်ပေးပါလိမ့်မယ်။</div>'; return; }
  el.innerHTML = state.qtHistory.map(item => `
    <div class="qtCard">
      ${item.pending ? `<div class="qtOriginal">${escapeHtml(item.queryLabel || item.originalText || '')}</div><hr><div class="qtTranslation"><span class="dotFlicker">translating…</span></div>` : `<div class="qtBadges">${item.detectedLang ? `<span class="qtDetected">Detected: ${escapeHtml(item.detectedLang)}</span>` : ''}${item.usedOffline ? (item.approx ? `<span class="offlineBadge">offline</span>` : `<span class="memoryBadge">✓ remembered</span>`) : ''}</div>${item.photoUrl ? `<img src="${item.photoUrl}" class="scanThumb">` : ''}<div class="qtOriginal">${escapeHtml(item.originalText)}</div><div class="miniControls"><button class="iconBtn" onclick='copyBlock(${JSON.stringify(item.originalText)}, this)'>${svgCopy()}</button></div><hr><div class="qtTranslation">${escapeHtml(item.translatedText)}</div><div class="miniControls"><button class="iconBtn" onclick='qtPlay(${item.id})'>${svgPlay()}</button><button class="iconBtn" onclick='copyBlock(${JSON.stringify(item.translatedText)}, this)'>${svgCopy()}</button></div>`}
    </div>`).join('');
}
function qtPlay(id){ const item = state.qtHistory.find(i => i.id === id); if(!item || !item.translatedText) return; const lang = langByCode(state.qtTargetCode) || LANGUAGES[0]; speak(item.translatedText, lang); }

async function qtTranslate(rawText, queryLabel){
  rawText = (rawText || '').trim(); if(!rawText) return; const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  const id = Date.now().toString(); state.qtHistory.unshift({ id, pending: true, queryLabel: queryLabel || rawText }); qtRenderHistory();
  let translatedText = ''; let detectedLang = ''; let usedOffline = false; let approx = false;
  if(state.offlineForced || !hasBackend()){
    usedOffline = true; const remembered = tmLookup('auto', targetLang.code, rawText);
    if(remembered){ translatedText = remembered; approx = false; } else {
      let found = null; for(const l of LANGUAGES){ if(l.code === targetLang.code) continue; const off = offlineTranslate(rawText, l.code, targetLang.code); if(off){ found = off; break; } }
      if(found){ translatedText = found.text; approx = found.approx; } else { translatedText = `[Offline] ${rawText}`; approx = true; }
    }
  } else {
    try{
      const domainHint = domainByCode(state.qtDomain).hint;
      const prompt = `Detect the language of the following message and translate it into ${targetLang.name}. Understand the full meaning first, then translate naturally the way a native ${targetLang.name} speaker would say it — not word-for-word.\n\nTone: ${toneInstruction()}\n${glossaryInstruction()}${domainHint ? `\nWork context: ${domainHint}\n` : ''}\nRespond in EXACTLY this format, nothing else:\nLANG: <name of the detected source language>\nTRANSLATION: <the natural translation, full text, nothing added>\n\nMessage: "${rawText}"`;
      const streamResult = await geminiFetchStream('gemini-3.5-flash', { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } } }, (partialRaw) => { const partialMatch = partialRaw.match(/TRANSLATION:\s*([\s\S]*)/i); if(partialMatch){ const liveItem = state.qtHistory.find(i => i.id === id); if(liveItem){ liveItem.translatedText = partialMatch[1].trim(); liveItem.pending = false; qtRenderHistory(); } } });
      if(streamResult.ok){
        const raw = streamResult.fullText || ''; const langMatch = raw.match(/LANG:\s*(.*)/i); const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
        detectedLang = langMatch ? langMatch[1].trim() : ''; translatedText = transMatch ? transMatch[1].trim() : raw;
        if(translatedText){ tmSave('auto', targetLang.code, rawText, translatedText); } else { usedOffline = true; approx = true; translatedText = `[Empty response] ${rawText}`; }
      } else { usedOffline = true; approx = true; translatedText = `[Network Error] ${rawText}`; }
    } catch(e){ usedOffline = true; approx = true; translatedText = `[Error Connection] ${rawText}`; }
  }
  const item = state.qtHistory.find(i => i.id === id); if(item){ Object.assign(item, { pending: false, originalText: rawText, translatedText, detectedLang, usedOffline, approx }); }
  qtRenderHistory(); if(state.autoSpeak) speak(translatedText, targetLang);
}

document.getElementById('qtSendBtn').addEventListener('click', () => { const input = document.getElementById('qtInput'); const text = input.value.trim(); if(!text) return; input.value = ''; input.style.height = 'auto'; qtTranslate(text); });
document.getElementById('qtInput').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px'; });
document.getElementById('qtInput').addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); document.getElementById('qtSendBtn').click(); } });
document.getElementById('qtCamBtn').addEventListener('click', () => { document.getElementById('qtScanInput').click(); });
document.getElementById('qtScanInput').addEventListener('change', async (e) => { const file = e.target.files[0]; e.target.value = ''; if(!file) return; await qtScanAndTranslate(file); });

async function qtHandleVoiceHold(blob){
  const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  if(state.offlineForced || !hasBackend()){ showToast('Hold-to-Talk အတွက် AI Translation Key/Internet လိုအပ်ပါတယ်', 'warn'); clearHoldCaption('QT'); return; }
  const id = Date.now().toString(); state.qtHistory.unshift({ id, pending: true, queryLabel: '(transcribing voice…)' }); qtRenderHistory(); clearHoldCaption('QT');
  try{
    const base64 = await fileToBase64(blob); const domainHint = domainByCode(state.qtDomain).hint;
    const prompt = `Listen to this audio clip (any language, detect it) and translate what was said into ${targetLang.name}. Understand the full meaning first, then translate naturally the way a native ${targetLang.name} speaker would say it — not word-for-word.\n\nTone: ${toneInstruction()}\n${glossaryInstruction()}${domainHint ? `\nWork context: ${domainHint}\n` : ''}\nRespond in EXACTLY this format, nothing else:\nLANG: <name of the detected source language>\nORIGINAL: <exact transcription of what was said>\nTRANSLATION: <the natural translation into ${targetLang.name}>`;
    const streamResult = await geminiFetchStream('gemini-3.5-flash', { contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: blob.type || 'audio/webm', data: base64 } } ] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } } }, (partialRaw) => { const liveItem = state.qtHistory.find(i => i.id === id); if(!liveItem) return; const origMatch = partialRaw.match(/ORIGINAL:\s*([\s\S]*?)(\nTRANSLATION:|$)/i); const transMatch = partialRaw.match(/TRANSLATION:\s*([\s\S]*)/i); if(origMatch) liveItem.originalText = origMatch[1].trim(); if(transMatch) liveItem.translatedText = transMatch[1].trim(); liveItem.pending = false; qtRenderHistory(); });
    if(!streamResult.ok){ showToast(`Voice translation မအောင်မြင်ပါ (Error ${streamResult.status || ''})`, 'error'); state.qtHistory = state.qtHistory.filter(i => i.id !== id); qtRenderHistory(); return; }
    const raw = streamResult.fullText || ''; const langMatch = raw.match(/LANG:\s*(.*)/i); const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATION:/i); const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
    const detectedLang = langMatch ? langMatch[1].trim() : ''; const originalText = origMatch ? origMatch[1].trim() : '(voice message)'; const translatedText = transMatch ? transMatch[1].trim() : raw;
    const item = state.qtHistory.find(i => i.id === id); if(item){ Object.assign(item, { pending: false, originalText, translatedText, detectedLang, usedOffline: false, approx: false }); }
    if(originalText) tmSave('auto', targetLang.code, originalText, translatedText); qtRenderHistory(); vibrate(15); if(state.autoSpeak) speak(translatedText, targetLang);
  }catch(e){ showToast(`Voice translation အမှားဖြစ်သွားပါတယ်: ${e.message}`, 'error'); state.qtHistory = state.qtHistory.filter(i => i.id !== id); qtRenderHistory(); }
}

async function qtScanAndTranslate(file){
  const targetLang = langByCode(state.qtTargetCode) || LANGUAGES[0];
  if(state.offlineForced || !hasBackend()){ showToast('Scan feature အတွက် AI Translation Key လိုအပ်ပါတယ်။ Settings ထဲမှာ ထည့်ပေးပါ။', 'warn'); return; }
  const id = Date.now().toString(); state.qtHistory.unshift({ id, pending: true, queryLabel: '(scanning photo…)' }); qtRenderHistory();
  try{
    const base64 = await fileToBase64(file); const isImage = file.type && file.type.startsWith('image/'); const photoUrl = isImage ? `data:${file.type};base64,${base64}` : null; const domainHint = domainByCode(state.qtDomain).hint;
    const prompt = `Read all the text in this file (a photo or PDF document, any language; if multi-page PDF, read all pages). Detect its language, then translate it into ${targetLang.name}, understanding the full meaning naturally rather than word-for-word.\n\nTone: ${toneInstruction()}\n${glossaryInstruction()}${domainHint ? `\nWork context: ${domainHint}\n` : ''}\nRespond in EXACTLY this format, nothing else:\nLANG: <name of the detected source language>\nORIGINAL: <the text you read>\nTRANSLATION: <the natural translation into ${targetLang.name}>`;
    const resp = await geminiFetch('gemini-3.5-flash', { contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } } ] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' }, mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' } });
    if(!resp.ok){ showToast(`Scan translation မအောင်မြင်ပါ`, 'error'); state.qtHistory = state.qtHistory.filter(i => i.id !== id); qtRenderHistory(); return; }
    const data = await resp.json(); const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
    const langMatch = raw.match(/LANG:\s*(.*)/i); const origMatch = raw.match(/ORIGINAL:\s*([\s\S]*?)\nTRANSLATION:/i); const transMatch = raw.match(/TRANSLATION:\s*([\s\S]*)/i);
    const detectedLang = langMatch ? langMatch[1].trim() : ''; const originalText = origMatch ? origMatch[1].trim() : '(scanned image)'; const translatedText = transMatch ? transMatch[1].trim() : raw;
    const item = state.qtHistory.find(i => i.id === id); if(item){ Object.assign(item, { pending: false, originalText, translatedText, detectedLang, photoUrl, usedOffline: false, approx: false }); }
    if(originalText) tmSave('auto', targetLang.code, originalText, translatedText); qtRenderHistory(); if(state.autoSpeak) speak(translatedText, targetLang);
  } catch(e){ showToast(`Scan translation အမှားဖြစ်သွားပါတယ်: ${e.message}`, 'error'); state.qtHistory = state.qtHistory.filter(i => i.id !== id); qtRenderHistory(); }
}

let qtRecognition = null; let qtPttHoldActive = false;
function qtStartRecognition(){
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition; if(!SpeechRecognitionCtor){ showToast('ဒီ browser မှာ voice input ကို support မလုပ်ပါ။', 'error'); return; }
  if(qtRecognition){ try{ qtRecognition.stop(); }catch(e){} qtRecognition = null; }
  const micLang = langByCode(state.qtMicCode) || LANGUAGES[0]; qtRecognition = new SpeechRecognitionCtor(); qtRecognition.lang = micLang.ttsLocale; qtRecognition.continuous = false; qtRecognition.interimResults = false; qtRecognition.maxAlternatives = 1; document.getElementById('qtMicBtn').classList.add('listening');
  qtRecognition.onresult = (e) => { const text = e.results[0][0].transcript; if(text && text.trim()) qtTranslate(text, `🎙️ ${text}`); };
  qtRecognition.onerror = (e) => { if(e.error !== 'no-speech' && e.error !== 'aborted'){ showToast('Voice input အမှားဖြစ်သွားပါတယ်: ' + e.error, 'error'); } };
  qtRecognition.onspeechend = () => { try{ qtRecognition.stop(); }catch(e){} }; qtRecognition.onend = () => { qtRecognition = null; document.getElementById('qtMicBtn').classList.remove('listening'); };
  try{ qtRecognition.start(); } catch(e){ qtRecognition = null; document.getElementById('qtMicBtn').classList.remove('listening'); }
}
function qtStopRecognition(){ if(qtRecognition){ try{ qtRecognition.stop(); }catch(e){} } }
document.getElementById('qtMicBtn').addEventListener('click', () => { if(qtRecognition){ qtStopRecognition(); return; } qtStartRecognition(); });
document.getElementById('qtModeToggle').addEventListener('click', () => { qtStopRecognition(); const toggle = document.getElementById('qtModeToggle'); const textWrap = document.getElementById('qtTextFieldWrap'); const pttWrap = document.getElementById('qtPttWrap'); const nowPtt = pttWrap.style.display === 'none'; textWrap.style.display = nowPtt ? 'none' : 'flex'; pttWrap.style.display = nowPtt ? 'flex' : 'none'; toggle.classList.toggle('active', nowPtt); toggle.innerHTML = nowPtt ? svgKeyboard() : svgWalkieTalkie(); vibrate(10); });
const qtPttCircle = document.getElementById('qtPttCircle');
qtPttCircle.addEventListener('pointerdown', (e)=>{ e.preventDefault(); try{ qtPttCircle.setPointerCapture(e.pointerId); }catch(err){} qtPttHoldActive = true; vibrate(15); qtPttCircle.classList.add('recording'); updateHoldCaption('QT', '🎙️ Recording... release to send'); startHoldRecording('QT'); });
const endQtPttHold = ()=>{ if(!qtPttHoldActive) return; qtPttHoldActive = false; vibrate(10); qtPttCircle.classList.remove('recording'); stopWaveform('QT'); stopHoldRecording('QT'); };
qtPttCircle.addEventListener('pointerup', endQtPttHold); qtPttCircle.addEventListener('pointercancel', endQtPttHold);

const PB_CATEGORIES = [ {key:'emergency', label:'🚨 Emergency'}, {key:'medical', label:'🏥 Medical'}, {key:'workplace', label:'💼 Workplace'}, {key:'housing', label:'🏠 Housing'}, {key:'wages', label:'💰 Wages'}, {key:'immigration', label:'✈️ Immigration'} ];
let pbActiveCategory = 'emergency'; let pbActiveSide = 'A';
function pbRenderCategories(){ const el = document.getElementById('pbCategories'); el.innerHTML = PB_CATEGORIES.map(c => `<button type="button" class="pbCatBtn ${c.key===pbActiveCategory?'active':''}" data-cat="${c.key}">${c.label}</button>`).join(''); el.querySelectorAll('.pbCatBtn').forEach(btn => { btn.addEventListener('click', () => { pbActiveCategory = btn.dataset.cat; pbRenderCategories(); pbRenderPhrases(); }); }); }
function pbRenderPhrases(){ const el = document.getElementById('pbPhraseList'); const lang = pbActiveSide === 'A' ? state.langA : state.langB; const items = PHRASEBOOK.filter(p => p.cat === pbActiveCategory); el.innerHTML = items.map(p => { const text = p[lang.code] || p.en; return `<div class="pbPhraseItem" data-text="${escapeHtml(text).replace(/"/g,'&quot;')}">${escapeHtml(text)}</div>`; }).join(''); el.querySelectorAll('.pbPhraseItem').forEach(item => { item.addEventListener('click', () => { const input = document.getElementById('input' + pbActiveSide); input.value = item.dataset.text; document.getElementById('phrasebookOverlay').classList.remove('show'); input.focus(); vibrate(10); }); }); }
function pbOpen(side){ pbActiveSide = side; pbRenderCategories(); pbRenderPhrases(); document.getElementById('phrasebookOverlay').classList.add('show'); }
document.getElementById('pbCloseBtn').addEventListener('click', () => { document.getElementById('phrasebookOverlay').classList.remove('show'); }); document.getElementById('phrasebookOverlay').addEventListener('click', (e) => { if(e.target.id === 'phrasebookOverlay') document.getElementById('phrasebookOverlay').classList.remove('show'); });

let typeOverlaySide = 'A';
function openTypeOverlay(side){ typeOverlaySide = side; const input = document.getElementById('typeOverlayInput'); input.value = document.getElementById('input'+side).value; document.getElementById('typeOverlay').classList.add('show'); setTimeout(()=>input.focus(), 50); }
function closeTypeOverlay(){ document.getElementById('typeOverlay').classList.remove('show'); }
document.getElementById('typeOverlayCloseBtn').addEventListener('click', closeTypeOverlay); document.getElementById('typeOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'typeOverlay') closeTypeOverlay(); });
document.getElementById('typeOverlaySendBtn').addEventListener('click', ()=>{ const text = document.getElementById('typeOverlayInput').value; if(!text.trim()) return; closeTypeOverlay(); vibrate(10); handleTranslation(text, typeOverlaySide, false); });
document.getElementById('typeOverlayInput').addEventListener('keydown', (e)=>{ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); document.getElementById('typeOverlaySendBtn').click(); } });

qtPopulateSelects(); qtRenderHistory();

try{
  const savedKey = localStorage.getItem('wt_apiKey'); const savedProxyUrl = localStorage.getItem('wt_proxyUrl'); const savedBackendMode = localStorage.getItem('wt_backendMode'); const savedOffline = localStorage.getItem('wt_offlineForced'); const savedRate = localStorage.getItem('wt_speechRate'); const savedAutoSpeak = localStorage.getItem('wt_autoSpeak'); const savedShowSub = localStorage.getItem('wt_showTranslatedOut'); const savedTheme = localStorage.getItem('wt_lightTheme'); const savedTone = localStorage.getItem('wt_tone'); const savedQtDomain = localStorage.getItem('wt_qtDomain'); const savedVoiceEngine = localStorage.getItem('wt_voiceEngine'); const savedGlossary = localStorage.getItem('wt_glossary'); const savedSaveHistory = localStorage.getItem('wt_saveHistory');
  if(savedKey) state.apiKey = savedKey; if(savedProxyUrl) state.proxyUrl = savedProxyUrl; if(savedBackendMode) state.backendMode = savedBackendMode; if(savedOffline !== null) state.offlineForced = savedOffline === '1'; if(savedRate) state.speechRate = parseFloat(savedRate); if(savedAutoSpeak !== null) state.autoSpeak = savedAutoSpeak === '1'; if(savedShowSub !== null) state.showTranslatedOut = savedShowSub === '1'; if(savedTheme === '1'){ state.lightTheme = true; document.body.classList.add('light-theme'); } if(savedTone) state.tone = savedTone; if(savedQtDomain) state.qtDomain = savedQtDomain; if(savedVoiceEngine) state.voiceEngine = savedVoiceEngine; if(savedGlossary) state.glossary = savedGlossary; if(savedSaveHistory !== null) state.saveHistory = savedSaveHistory === '1';
  if(state.saveHistory){ const savedMsgs = localStorage.getItem('wt_messages'); if(savedMsgs) state.messages = JSON.parse(savedMsgs); }
}catch(e){}

renderStatusBar(); renderPanel('A'); renderPanel('B'); qtPopulateDomains(); qtRenderSuggestions(); showView('home'); liveInitLangSelects();

try{ if(!localStorage.getItem('wt_onboardingSeen')){ document.getElementById('onboardingOverlay').classList.add('show'); } }catch(e){}
document.getElementById('onboardingCloseBtn').addEventListener('click', ()=>{ document.getElementById('onboardingOverlay').classList.remove('show'); try{ localStorage.setItem('wt_onboardingSeen', '1'); }catch(e){} });

if('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').then((reg) => { reg.update().catch(()=>{}); }).catch(()=>{}); });
  let refreshed = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if(refreshed) return; refreshed = true; window.location.reload(); });
}
