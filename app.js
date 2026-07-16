// ====== API Token & Speed Optimization ======
// 1. Context History ဖျက်ထားသည် (Token သက်သာရန်)
// 2. TTS Voice ကို ဖုန်းအသံဖြင့် Default ထားသည် (Token သက်သာရန်)
// 3. Prompt ကို အတိုဆုံးချုံ့ထားသည် (မြန်ဆန်ရန်)
// 4. Gemini 1.5 Flash သီးသန့် အသုံးပြုထားသည်

function showToast(message, type){
  const container = document.getElementById('toastContainer');
  if(!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fadeOut'); setTimeout(() => el.remove(), 300); }, 3000);
}

const state = {
  langA: langByCode('en'), langB: langByCode('my'), messages: [], apiKey: '', offlineForced: false,
  listening: {A:false, B:false}, translating: {A:false, B:false}, autoConversation: false, speechRate: 0.9,
  autoSpeak: true, showTranslatedOut: true, lastSent: {A: null, B: null}, voiceEngine: 'device', // Always default to device to save tokens
  pttMode: {A: false, B: false}, currentView: 'conversation', backendMode: 'key'
};

function otherSide(side){ return side === 'A' ? 'B' : 'A'; }

// Text-To-Speech (Device Native - Free & Fast)
function speakLocal(text, lang, onDone){
  if(!('speechSynthesis' in window) || !text){ if(onDone) onDone(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang.ttsLocale; u.rate = state.speechRate;
  let fired = false; const finish = () => { if(fired) return; fired = true; if(onDone) onDone(); };
  u.onend = finish; u.onerror = finish; window.speechSynthesis.speak(u);
}

// API Call Logic (Optimized for gemini-1.5-flash)
async function geminiFetchFast(payload){
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
    body: JSON.stringify(payload),
  });
}

// Core Translation Logic
async function handleTranslation(rawText, sender, isVoice){
  rawText = (rawText || '').trim(); if(!rawText) return;
  const isA = sender === 'A'; state.translating[sender] = true;
  if(isA){ document.getElementById('inputA').value = ''; } else { document.getElementById('inputB').value = ''; }
  
  const sourceLang = isA ? state.langA : state.langB; const targetLang = isA ? state.langB : state.langA;
  const msgId = Date.now().toString();
  
  state.messages.unshift({ id: msgId, sender, originalText: rawText, translatedText: '', isVoice: !!isVoice, pending: true, timestamp: Date.now() });
  renderPanel('A'); renderPanel('B');

  let translated = ''; 

  if(state.offlineForced || !state.apiKey){
    // Offline Logic Fallback
    const remembered = tmLookup(sourceLang.code, targetLang.code, rawText);
    if(remembered){ translated = remembered; } 
    else {
      const off = offlineTranslate(rawText, sourceLang.code, targetLang.code);
      translated = off ? off.text : `[Offline] ${rawText}`;
    }
  } else {
    try{
      // ULTA-SHORT PROMPT: Saves input tokens and makes AI respond instantly.
      const prompt = `Translate to ${targetLang.name}. Return ONLY the translation, no extra notes. Text: "${rawText}"`;
      
      const resp = await geminiFetchFast({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 256, temperature: 0.3 } // Limit output tokens drastically
      });

      if(resp.ok){
        const data = await resp.json();
        translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if(translated) tmSave(sourceLang.code, targetLang.code, rawText, translated);
      } else {
        translated = `[Network Error] ${rawText}`;
      }
    } catch(e){
      translated = `[Connection Error] ${rawText}`;
    }
  }

  const msg = state.messages.find(m => m.id === msgId);
  if(msg){ msg.translatedText = translated; msg.pending = false; }
  state.translating[sender] = false; 
  renderPanel('A'); renderPanel('B');
  vibrate(15);

  const continueAutoConversation = () => {
    if(state.autoConversation){
      const replySide = otherSide(sender);
      if(!state.listening.A && !state.listening.B && !state.translating.A && !state.translating.B){ 
        setTimeout(() => { if(state.autoConversation) startStt(replySide); }, 350); 
      }
    }
  };

  if(state.autoSpeak){ speakLocal(translated, targetLang, continueAutoConversation); } 
  else { continueAutoConversation(); }
}

// ... (Keep the rest of the generic Event Listeners, renderPanel functions exactly as they were in the previous complete script) ...
// Ensure you don't delete the `renderPanel` UI generator string which I minimized slightly in CSS to fit nicely.
