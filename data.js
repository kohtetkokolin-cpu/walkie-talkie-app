const APP_VERSION = '2026.07.16-live';

const LANGUAGES = [
  {code:'en', name:'English (US)', flag:'🇺🇸', ttsLocale:'en-US'},
  {code:'my', name:'Myanmar (မြန်မာ)', flag:'🇲🇲', ttsLocale:'my-MM'},
  {code:'zh', name:'Chinese (中文)', flag:'🇨🇳', ttsLocale:'zh-CN'},
  {code:'th', name:'Thai (ไทย)', flag:'🇹🇭', ttsLocale:'th-TH'},
  {code:'ja', name:'Japanese (日本語)', flag:'🇯🇵', ttsLocale:'ja-JP'},
  {code:'ko', name:'Korean (한국어)', flag:'🇰🇷', ttsLocale:'ko-KR'},
  {code:'vi', name:'Vietnamese (Tiếng Việt)', flag:'🇻🇳', ttsLocale:'vi-VN'},
  {code:'hi', name:'Hindi (हिन्दी)', flag:'🇮🇳', ttsLocale:'hi-IN'},
  {code:'fr', name:'French (Français)', flag:'🇫🇷', ttsLocale:'fr-FR'},
  {code:'es', name:'Spanish (Español)', flag:'🇪🇸', ttsLocale:'es-ES'},
  {code:'id', name:'Indonesian (Indonesia)', flag:'🇮🇩', ttsLocale:'id-ID'},
  {code:'ms', name:'Malay (Melayu)', flag:'🇲🇾', ttsLocale:'ms-MY'},
  {code:'tl', name:'Filipino (Tagalog)', flag:'🇵🇭', ttsLocale:'fil-PH'},
  {code:'ar', name:'Arabic (العربية)', flag:'🇸🇦', ttsLocale:'ar-SA'}
];
const langByCode = c => LANGUAGES.find(l => l.code === c);
const OFFLINE_LANG_CODES = new Set(['en', 'my', 'zh', 'th', 'fr', 'es']);
function langOptionLabel(l){ return `${l.flag} ${l.name}${OFFLINE_LANG_CODES.has(l.code) ? ' · Offline✓' : ''}`; }

const PHRASEBOOK = [
  {cat:'emergency', en:"I need help immediately.", my:"ငါအခုချက်ချင်း အကူအညီလိုအပ်နေပါတယ်။", zh:"我现在马上需要帮助。", th:"ฉันต้องการความช่วยเหลือทันทีครับ/ค่ะ", fr:"J'ai besoin d'aide immédiatement.", es:"Necesito ayuda de inmediato."},
  {cat:'emergency', en:"Please call the police.", my:"ရဲကိုခေါ်ပေးပါ။", zh:"请报警。", th:"กรุณาโทรแจ้งตำรวจครับ/ค่ะ", fr:"Veuillez appeler la police.", es:"Por favor, llame a la policía."},
  {cat:'medical', en:"I am sick and need a doctor.", my:"ငါနေမကောင်းဖြစ်နေလို့ ဆရာဝန်လိုအပ်ပါတယ်။", zh:"我生病了，需要看医生。", th:"ฉันไม่สบายและต้องการหมอครับ/ค่ะ", fr:"Je suis malade et j'ai besoin d'un médecin.", es:"Estoy enfermo y necesito un médico."},
  {cat:'workplace', en:"I was injured at work.", my:"ငါအလုပ်ခွင်မှာ ဒဏ်ရာရခဲ့ပါတယ်။", zh:"我在工作中受伤了。", th:"ฉันได้รับบาดเจ็บจากการทำงานครับ/ค่ะ", fr:"J'ai été blessé au travail.", es:"Me lastimé en el trabajo."},
  {cat:'housing', en:"The rent is due.", my:"အိမ်ငှားခ ပေးရမယ့်အချိန် ရောက်နေပါပြီ။", zh:"房租到期了。", th:"ถึงกำหนดจ่ายค่าเช่าแล้วครับ/ค่ะ", fr:"Le loyer est dû.", es:"El alquiler está vencido."},
  {cat:'wages', en:"When will I be paid?", my:"ငါ့ကို ဘယ်တော့လစာပေးမှာလဲ။", zh:"我什么时候能拿到工资？", th:"ฉันจะได้รับค่าจ้างเมื่อไหร่ครับ/ค่ะ", fr:"Quand serai-je payé ?", es:"¿Cuándo me pagarán?"},
  {cat:'immigration', en:"Where is the immigration office?", my:"လူဝင်မှုကြီးကြပ်ရေးရုံး ဘယ်မှာလဲ။", zh:"移民局在哪里？", th:"สำนักงานตรวจคนเข้าเมืองอยู่ที่ไหนครับ/ค่ะ", fr:"Où se trouve le bureau de l'immigration ?", es:"¿Dónde está la oficina de inmigración?"}
];

const PHRASES = [
  ...PHRASEBOOK.map(({cat, ...rest}) => rest),
  {en:"Hello.", my:"မင်္ဂလာပါ။", zh:"您好。", th:"สวัสดีครับ/ค่ะ", fr:"Bonjour.", es:"Hola."},
  {en:"Thank you very much.", my:"ကျေးဇူးအများကြီးတင်ပါတယ်။", zh:"非常感谢您。", th:"ขอบคุณมากครับ/ค่ะ", fr:"Merci beaucoup.", es:"Muchas gracias."}
];

const WORDS = [
  {en:"I", my:"ငါ", zh:"我", th:"ฉัน", fr:"je", es:"yo"},
  {en:"you", my:"နင်", zh:"你", th:"คุณ", fr:"tu", es:"tú"},
  {en:"water", my:"ရေ", zh:"水", th:"น้ำ", fr:"eau", es:"agua"}
];

let translationMemory = {};
try{ const raw = localStorage.getItem('wt_translationMemory'); if(raw) translationMemory = JSON.parse(raw); }catch(e){ translationMemory = {}; }
function tmNormalize(text){ return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[။၊.,!?]+$/g, ''); }
function tmKey(srcCode, tgtCode, text){ return srcCode + '|' + tgtCode + '|' + tmNormalize(text); }
function tmLookup(srcCode, tgtCode, text){ return translationMemory[tmKey(srcCode, tgtCode, text)] || null; }
function tmSave(srcCode, tgtCode, original, translated){
  if(!original || !translated) return;
  translationMemory[tmKey(srcCode, tgtCode, original)] = translated;
  try{
    const keys = Object.keys(translationMemory);
    if(keys.length > 600) keys.slice(0, keys.length - 600).forEach(k => delete translationMemory[k]);
    localStorage.setItem('wt_translationMemory', JSON.stringify(translationMemory));
  }catch(e){}
}

function offlineTranslate(rawText, srcCode, tgtCode){
  const norm = rawText.trim(); if(!norm) return null;
  const normLower = norm.toLowerCase();
  for(const p of PHRASES){
    const src = (p[srcCode] || '').trim();
    if(src && (src === norm || src.toLowerCase() === normLower)) return {text: p[tgtCode], approx:false};
  }
  const sortedPhrases = [...PHRASES].sort((a,b)=> (b[srcCode]||'').length - (a[srcCode]||'').length);
  for(const p of sortedPhrases){
    const src = (p[srcCode] || '').trim();
    if(src.length >= 3){
      const srcLower = src.toLowerCase();
      if(normLower.includes(srcLower) || srcLower.includes(normLower)) return {text: p[tgtCode], approx:false};
    }
  }
  const dict = [...PHRASES, ...WORDS].filter(d => d[srcCode] && d[tgtCode]).sort((a,b)=> (b[srcCode]||'').length - (a[srcCode]||'').length);
  let i = 0; const lowerNorm = normLower; const outParts = []; let matchedAny = false;
  while(i < norm.length){
    let matched = null;
    for(const d of dict){
      const src = d[srcCode].trim(); if(!src) continue;
      if(lowerNorm.startsWith(src.toLowerCase(), i)){ matched = d; break; }
    }
    if(matched){
      outParts.push(matched[tgtCode]);
      i += matched[srcCode].trim().length; matchedAny = true;
      while(i < norm.length && /\s/.test(norm[i])) i++;
    } else i++;
  }
  if(matchedAny && outParts.length){
    const wordCount = norm.split(/\s+/).filter(Boolean).length;
    if(wordCount > 4 && outParts.length < Math.ceil(wordCount / 2)) return null;
    return {text: outParts.join(' '), approx:true};
  }
  return null;
}

const WORK_DOMAINS = [
  { code: 'general', label: '🌐 General (No specific domain)', hint: '', suggestions: [] },
  { code: 'electronics', label: '🔌 Electronics / PCB Factory', hint: 'This conversation takes place in an electronics / PCB manufacturing factory.', suggestions: ["What is today's defect rate?", "Please check this solder joint again."] },
  { code: 'healthcare', label: '⚕️ Healthcare / Caregiving', hint: 'This conversation takes place in a healthcare or caregiving setting.', suggestions: ["Where does it hurt?", "Please take this medicine twice a day."] }
];
const domainByCode = c => WORK_DOMAINS.find(d => d.code === c) || WORK_DOMAINS[0];
