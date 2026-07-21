/* ==========================================================
   Walkie-Talkie Translator — static data
   Language list, offline phrasebook/dictionary. No app logic here;
   app.js depends on these being loaded first (plain <script> tags
   share one global scope, so this just needs to load before app.js).
========================================================== */

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
  {code:'ar', name:'Arabic (العربية)', flag:'🇸🇦', ttsLocale:'ar-SA'},
];
const langByCode = c => LANGUAGES.find(l => l.code === c);

// Languages with real offline dictionary + translation-memory support.
// Shown as "Offline✓" in language pickers so people know what still works
// with zero internet, versus languages that need the AI (online only).
const OFFLINE_LANG_CODES = new Set(['en', 'my', 'zh', 'th', 'fr', 'es']);
function langOptionLabel(l){
  return `${l.flag} ${l.name}${OFFLINE_LANG_CODES.has(l.code) ? ' · Offline✓' : ''}`;
}

/* =========================================================
   OFFLINE TRANSLATION ENGINE
   Unified multilingual table (phrase-level + word-level),
   works for ANY of the 4 languages -> ANY of the 4 languages,
   with exact match, substring match, and compositional
   (word-by-word) fallback matching for network-down scenarios.
========================================================= */
const PHRASEBOOK = [
  // 🚨 Emergency
  {cat:'emergency', en:"I need help immediately.", my:"ငါအခုချက်ချင်း အကူအညီလိုအပ်နေပါတယ်။", zh:"我现在马上需要帮助。", th:"ฉันต้องการความช่วยเหลือทันทีครับ/ค่ะ", fr:"J'ai besoin d'aide immédiatement.", es:"Necesito ayuda de inmediato."},
  {cat:'emergency', en:"Please call the police.", my:"ရဲကိုခေါ်ပေးပါ။", zh:"请报警。", th:"กรุณาโทรแจ้งตำรวจครับ/ค่ะ", fr:"Veuillez appeler la police.", es:"Por favor, llame a la policía."},
  {cat:'emergency', en:"I lost my passport/ID.", my:"ငါ့ passport/ID ပျောက်သွားပါတယ်။", zh:"我的护照/身份证丢了。", th:"หนังสือเดินทาง/บัตรประชาชนของฉันหายครับ/ค่ะ", fr:"J'ai perdu mon passeport/pièce d'identité.", es:"Perdí mi pasaporte/identificación."},
  {cat:'emergency', en:"There has been an accident.", my:"မတော်တဆမှု ဖြစ်ပွားခဲ့ပါတယ်။", zh:"发生了一起事故。", th:"เกิดอุบัติเหตุขึ้นครับ/ค่ะ", fr:"Il y a eu un accident.", es:"Ha habido un accidente."},
  {cat:'emergency', en:"I am in danger, please help.", my:"ငါအန္တရာယ်ရှိနေပါတယ်၊ ကူညီပေးပါ။", zh:"我有危险，请帮帮我。", th:"ฉันอยู่ในอันตราย กรุณาช่วยด้วยครับ/ค่ะ", fr:"Je suis en danger, aidez-moi s'il vous plaît.", es:"Estoy en peligro, por favor ayúdenme."},
  {cat:'emergency', en:"Please take me to a hospital.", my:"ငါ့ကိုဆေးရုံခေါ်သွားပေးပါ။", zh:"请带我去医院。", th:"กรุณาพาฉันไปโรงพยาบาลครับ/ค่ะ", fr:"Emmenez-moi à l'hôpital, s'il vous plaît.", es:"Por favor, llévenme a un hospital."},

  // 🏥 Medical
  {cat:'medical', en:"I am sick and need a doctor.", my:"ငါနေမကောင်းဖြစ်နေလို့ ဆရာဝန်လိုအပ်ပါတယ်။", zh:"我生病了，需要看医生。", th:"ฉันไม่สบายและต้องการหมอครับ/ค่ะ", fr:"Je suis malade et j'ai besoin d'un médecin.", es:"Estoy enfermo y necesito un médico."},
  {cat:'medical', en:"I am allergic to this medicine.", my:"ငါဒီဆေးကို allergy ဖြစ်တယ်။", zh:"我对这种药过敏。", th:"ฉันแพ้ยาตัวนี้ครับ/ค่ะ", fr:"Je suis allergique à ce médicament.", es:"Soy alérgico a este medicamento."},
  {cat:'medical', en:"I am pregnant.", my:"ငါကိုယ်ဝန်ရှိပါတယ်။", zh:"我怀孕了。", th:"ฉันตั้งครรภ์ครับ/ค่ะ", fr:"Je suis enceinte.", es:"Estoy embarazada."},
  {cat:'medical', en:"I have a fever.", my:"ငါဖျားနေတယ်။", zh:"我发烧了。", th:"ฉันมีไข้ครับ/ค่ะ", fr:"J'ai de la fièvre.", es:"Tengo fiebre."},
  {cat:'medical', en:"It hurts here.", my:"ဒီနေရာကနာနေတယ်။", zh:"这里很痛。", th:"ตรงนี้เจ็บครับ/ค่ะ", fr:"Ça fait mal ici.", es:"Me duele aquí."},
  {cat:'medical', en:"I need to buy medicine.", my:"ငါဆေးဝယ်ရန်လိုအပ်ပါတယ်။", zh:"我需要买药。", th:"ฉันต้องการซื้อยาครับ/ค่ะ", fr:"J'ai besoin d'acheter des médicaments.", es:"Necesito comprar medicina."},

  // 💼 Workplace
  {cat:'workplace', en:"I want to report unsafe working conditions.", my:"အန္တရာယ်ရှိတဲ့ အလုပ်ခွင်အခြေအနေကို တိုင်ကြားချင်ပါတယ်။", zh:"我想举报不安全的工作条件。", th:"ฉันต้องการแจ้งสภาพการทำงานที่ไม่ปลอดภัยครับ/ค่ะ", fr:"Je veux signaler des conditions de travail dangereuses.", es:"Quiero denunciar condiciones de trabajo inseguras."},
  {cat:'workplace', en:"I have not been paid yet.", my:"ငါ့ကို လစာမပေးရသေးပါဘူး။", zh:"我还没有拿到工资。", th:"ฉันยังไม่ได้รับค่าจ้างครับ/ค่ะ", fr:"Je n'ai pas encore été payé.", es:"Todavía no me han pagado."},
  {cat:'workplace', en:"I was injured at work.", my:"ငါအလုပ်ခွင်မှာ ဒဏ်ရာရခဲ့ပါတယ်။", zh:"我在工作中受伤了。", th:"ฉันได้รับบาดเจ็บจากการทำงานครับ/ค่ะ", fr:"J'ai été blessé au travail.", es:"Me lastimé en el trabajo."},
  {cat:'workplace', en:"Can I have a day off?", my:"ငါတစ်ရက်ခွင့်ယူလို့ရမလား။", zh:"我可以请一天假吗？", th:"ฉันขอลาหยุดหนึ่งวันได้ไหมครับ/ค่ะ", fr:"Puis-je prendre un jour de congé ?", es:"¿Puedo tomarme un día libre?"},
  {cat:'workplace', en:"What are my working hours?", my:"ငါ့ အလုပ်ချိန်က ဘယ်လိုလဲ။", zh:"我的工作时间是怎样的？", th:"เวลาทำงานของฉันคือเมื่อไหร่ครับ/ค่ะ", fr:"Quels sont mes horaires de travail ?", es:"¿Cuáles son mis horas de trabajo?"},
  {cat:'workplace', en:"I want to keep a copy of my contract.", my:"ငါ့ contract ကူးမိတ္တူတစ်စောင် ငါလက်ဝယ်ထားချင်ပါတယ်။", zh:"我想保留一份我的合同副本。", th:"ฉันต้องการเก็บสำเนาสัญญาของฉันครับ/ค่ะ", fr:"Je veux garder une copie de mon contrat.", es:"Quiero conservar una copia de mi contrato."},

  // 🏠 Housing
  {cat:'housing', en:"I need a place to stay.", my:"ငါနေစရာနေရာလိုအပ်ပါတယ်။", zh:"我需要一个住的地方。", th:"ฉันต้องการที่พักครับ/ค่ะ", fr:"J'ai besoin d'un endroit où loger.", es:"Necesito un lugar donde alojarme."},
  {cat:'housing', en:"The rent is due.", my:"အိမ်ငှားခ ပေးရမယ့်အချိန် ရောက်နေပါပြီ။", zh:"房租到期了。", th:"ถึงกำหนดจ่ายค่าเช่าแล้วครับ/ค่ะ", fr:"Le loyer est dû.", es:"El alquiler está vencido."},
  {cat:'housing', en:"The landlord has not fixed this.", my:"အိမ်ရှင်က ဒါကို မပြင်ပေးသေးပါဘူး။", zh:"房东还没有修理这个。", th:"เจ้าของบ้านยังไม่ได้ซ่อมสิ่งนี้ครับ/ค่ะ", fr:"Le propriétaire n'a pas encore réparé ceci.", es:"El propietario no ha reparado esto todavía."},
  {cat:'housing', en:"I want to move out.", my:"ငါပြောင်းရွှေ့ချင်ပါတယ်။", zh:"我想搬出去。", th:"ฉันต้องการย้ายออกครับ/ค่ะ", fr:"Je veux déménager.", es:"Quiero mudarme."},

  // 💰 Wages
  {cat:'wages', en:"When will I be paid?", my:"ငါ့ကို ဘယ်တော့လစာပေးမှာလဲ။", zh:"我什么时候能拿到工资？", th:"ฉันจะได้รับค่าจ้างเมื่อไหร่ครับ/ค่ะ", fr:"Quand serai-je payé ?", es:"¿Cuándo me pagarán?"},
  {cat:'wages', en:"This is not the correct amount.", my:"ဒါက မှန်ကန်တဲ့ ပမာဏ မဟုတ်ပါဘူး။", zh:"这个金额不对。", th:"จำนวนเงินนี้ไม่ถูกต้องครับ/ค่ะ", fr:"Ce n'est pas le bon montant.", es:"Esta no es la cantidad correcta."},
  {cat:'wages', en:"I need a receipt for this payment.", my:"ဒီငွေပေးချေမှုအတွက် ငွေလက်ခံဖြတ်ပိုင်း လိုအပ်ပါတယ်။", zh:"我需要这笔付款的收据。", th:"ฉันต้องการใบเสร็จสำหรับการชำระเงินนี้ครับ/ค่ะ", fr:"J'ai besoin d'un reçu pour ce paiement.", es:"Necesito un recibo de este pago."},
  {cat:'wages', en:"What is the hourly rate?", my:"တစ်နာရီ ဘယ်လောက်ကျသလဲ။", zh:"每小时的工资是多少？", th:"ค่าจ้างต่อชั่วโมงเท่าไหร่ครับ/ค่ะ", fr:"Quel est le taux horaire ?", es:"¿Cuál es la tarifa por hora?"},

  // ✈️ Immigration/Legal
  {cat:'immigration', en:"I need to renew my visa/work permit.", my:"ငါ့ visa/အလုပ်လုပ်ခွင့်ကို သက်တမ်းတိုးဖို့ လိုအပ်ပါတယ်။", zh:"我需要续签我的签证/工作许可证。", th:"ฉันต้องต่ออายุวีซ่า/ใบอนุญาตทำงานครับ/ค่ะ", fr:"Je dois renouveler mon visa/permis de travail.", es:"Necesito renovar mi visa/permiso de trabajo."},
  {cat:'immigration', en:"Where is the immigration office?", my:"လူဝင်မှုကြီးကြပ်ရေးရုံး ဘယ်မှာလဲ။", zh:"移民局在哪里？", th:"สำนักงานตรวจคนเข้าเมืองอยู่ที่ไหนครับ/ค่ะ", fr:"Où se trouve le bureau de l'immigration ?", es:"¿Dónde está la oficina de inmigración?"},
  {cat:'immigration', en:"I need a translator.", my:"ငါစကားပြန်တစ်ယောက် လိုအပ်ပါတယ်။", zh:"我需要一名翻译。", th:"ฉันต้องการล่ามครับ/ค่ะ", fr:"J'ai besoin d'un interprète.", es:"Necesito un intérprete."},
  {cat:'immigration', en:"I need legal help.", my:"ငါ့မှာ ဥပဒေရေးရာ အကူအညီ လိုအပ်ပါတယ်။", zh:"我需要法律援助。", th:"ฉันต้องการความช่วยเหลือทางกฎหมายครับ/ค่ะ", fr:"J'ai besoin d'une aide juridique.", es:"Necesito ayuda legal."},
  {cat:'immigration', en:"Here is my documentation.", my:"ဒါကငါ့ စာရွက်စာတမ်းများ ဖြစ်ပါတယ်။", zh:"这是我的证件。", th:"นี่คือเอกสารของฉันครับ/ค่ะ", fr:"Voici mes documents.", es:"Aquí están mis documentos."},
];
// Fold the phrasebook into the main offline dictionary too — these are
// hand-verified, high-value phrases, so they get guaranteed-accurate
// offline translation, not just a fast quick-insert shortcut.
const PHRASES = [
  ...PHRASEBOOK.map(({cat, ...rest}) => rest),
  {en:"Hello.", my:"မင်္ဂလာပါ။", zh:"您好。", th:"สวัสดีครับ/ค่ะ", fr:"Bonjour.", es:"Hola."},
  {en:"Thank you very much.", my:"ကျေးဇူးအများကြီးတင်ပါတယ်။", zh:"非常感谢您。", th:"ขอบคุณมากครับ/ค่ะ", fr:"Merci beaucoup.", es:"Muchas gracias."},
  {en:"Yes, that's correct.", my:"ဟုတ်ကဲ့၊ မှန်ပါတယ်။", zh:"是的，没错。", th:"ใช่ครับ/ค่ะ ถูกต้องแล้ว", fr:"Oui, c'est exact.", es:"Sí, es correcto."},
  {en:"No, that's not right.", my:"မဟုတ်ပါဘူး၊ မှန်မှုမရှိပါဘူး။", zh:"不，不对。", th:"ไม่ใช่ครับ/ค่ะ ไม่ถูกต้อง", fr:"Non, ce n'est pas correct.", es:"No, eso no es correcto."},
  {en:"Please help me.", my:"ကျေးဇူးပြု၍ ကူညီပေးပါ။", zh:"请帮帮我。", th:"กรุณาช่วยฉันด้วยครับ/ค่ะ", fr:"Aidez-moi, s'il vous plaît.", es:"Por favor, ayúdame."},
  {en:"Please wait a moment.", my:"ခဏလေးစောင့်ပေးပါ။", zh:"请稍等一下。", th:"กรุณารอสักครู่ครับ/ค่ะ", fr:"Veuillez patienter un instant.", es:"Espere un momento, por favor."},
  {en:"The work is done.", my:"အလုပ်ပြီးပါပြီ။", zh:"工作已经完成了。", th:"งานเสร็จเรียบร้อยแล้วครับ/ค่ะ", fr:"Le travail est terminé.", es:"El trabajo está terminado."},
  {en:"The shipment has arrived.", my:"ပစ္စည်းများရောက်ရှိပါပြီ။", zh:"货物已经送到了。", th:"สินค้ามาถึงแล้วครับ/ค่ะ", fr:"La livraison est arrivée.", es:"El envío ha llegado."},
  {en:"How much does it cost?", my:"ဒါဘယ်လောက်ကျသလဲ။", zh:"这个多少钱？", th:"อันนี้ราคาเท่าไหร่ครับ/ค่ะ", fr:"Combien ça coûte ?", es:"¿Cuánto cuesta esto?"},
  {en:"I don't understand.", my:"နားမလည်ပါဘူး။", zh:"我不太明白。", th:"ไม่เข้าใจครับ/ค่ะ", fr:"Je ne comprends pas.", es:"No entiendo."},
  {en:"Could you repeat that please?", my:"ကျေးဇူးပြု၍ ထပ်ပြောပေးပါ။", zh:"麻烦您再说一遍。", th:"ช่วยพูดอีกครั้งได้ไหมครับ/ค่ะ", fr:"Pourriez-vous répéter, s'il vous plaît ?", es:"¿Podría repetirlo, por favor?"},
  {en:"Be careful, it's dangerous.", my:"သတိထားပါ၊ အန္တရာယ်ရှိပါတယ်။", zh:"小心，这很危险。", th:"ระวังนะครับ/ค่ะ อันตราย", fr:"Faites attention, c'est dangereux.", es:"Ten cuidado, es peligroso."},
  {en:"Please slow down.", my:"ကျေးဇူးပြု၍ ဖြည်းဖြည်းလုပ်ပေးပါ။", zh:"请慢一点。", th:"กรุณาช้าลงหน่อยครับ/ค่ะ", fr:"Veuillez ralentir.", es:"Por favor, más despacio."},
  {en:"Good morning.", my:"မင်္ဂလာနံနက်ခင်းပါ။", zh:"早上好。", th:"อรุณสวัสดิ์ครับ/ค่ะ", fr:"Bonjour.", es:"Buenos días."},
  {en:"Good evening.", my:"မင်္ဂလာညနေခင်းပါ။", zh:"晚上好。", th:"สวัสดีตอนเย็นครับ/ค่ะ", fr:"Bonsoir.", es:"Buenas tardes."},
  {en:"See you tomorrow.", my:"မနက်ဖြန်တွေ့မယ်နော်။", zh:"明天见。", th:"แล้วเจอกันพรุ่งนี้ครับ/ค่ะ", fr:"À demain.", es:"Hasta mañana."},
  {en:"I'm sorry.", my:"တောင်းပန်ပါတယ်။", zh:"对不起。", th:"ขอโทษครับ/ค่ะ", fr:"Je suis désolé.", es:"Lo siento."},
  {en:"It's okay, no problem.", my:"ရပါတယ်၊ ပြဿနာမရှိပါဘူး။", zh:"没关系，没问题。", th:"ไม่เป็นไรครับ/ค่ะ", fr:"C'est bon, pas de problème.", es:"Está bien, no hay problema."},
  {en:"Where is the bathroom?", my:"အိမ်သာဘယ်မှာလဲ။", zh:"洗手间在哪里？", th:"ห้องน้ำอยู่ที่ไหนครับ/ค่ะ", fr:"Où sont les toilettes ?", es:"¿Dónde está el baño?"},
  {en:"I need to rest.", my:"ငါခဏနားချင်ပါတယ်။", zh:"我需要休息一下。", th:"ฉันต้องพักสักครู่ครับ/ค่ะ", fr:"J'ai besoin de me reposer.", es:"Necesito descansar."},
  {en:"Let's start work now.", my:"အခုအလုပ်စလုပ်ကြရအောင်။", zh:"我们现在开始工作吧。", th:"เริ่มทำงานกันเลยครับ/ค่ะ", fr:"Commençons le travail maintenant.", es:"Empecemos a trabajar ahora."},
  {en:"Please check this.", my:"ဒါကိုစစ်ဆေးပေးပါ။", zh:"请检查一下这个。", th:"กรุณาตรวจสอบอันนี้ครับ/ค่ะ", fr:"Veuillez vérifier ceci.", es:"Por favor, revisa esto."},
  {en:"This is broken.", my:"ဒါပျက်နေပါတယ်။", zh:"这个坏了。", th:"อันนี้เสียครับ/ค่ะ", fr:"C'est cassé.", es:"Esto está roto."},
  {en:"I will call you.", my:"ငါဖုန်းဆက်မယ်နော်။", zh:"我会给你打电话。", th:"ฉันจะโทรหาคุณครับ/ค่ะ", fr:"Je vous appellerai.", es:"Te llamaré."},
  {en:"What time is it now?", my:"အခုဘယ်နှစ်နာရီရှိပြီလဲ။", zh:"现在几点了？", th:"ตอนนี้กี่โมงแล้วครับ/ค่ะ", fr:"Quelle heure est-il ?", es:"¿Qué hora es?"},
  {en:"I am on my way.", my:"ငါလာနေပါပြီ။", zh:"我在路上了。", th:"ฉันกำลังไปครับ/ค่ะ", fr:"Je suis en route.", es:"Voy en camino."},
  {en:"Please sign here.", my:"ဒီနေရာမှာလက်မှတ်ထိုးပေးပါ။", zh:"请在这里签名。", th:"กรุณาเซ็นชื่อตรงนี้ครับ/ค่ะ", fr:"Veuillez signer ici.", es:"Firme aquí, por favor."},
  {en:"Congratulations!", my:"ဂုဏ်ယူပါတယ်။", zh:"恭喜你！", th:"ยินดีด้วยครับ/ค่ะ", fr:"Félicitations !", es:"¡Felicidades!"},
  {en:"Take care of yourself.", my:"ကိုယ်ကိုယ်ကိုသေချာထိန်းသိမ်းပါ။", zh:"请照顾好自己。", th:"ดูแลตัวเองด้วยนะครับ/ค่ะ", fr:"Prends soin de toi.", es:"Cuídate."},
  {en:"Let's go.", my:"သွားကြရအောင်။", zh:"我们走吧。", th:"ไปกันเถอะครับ/ค่ะ", fr:"Allons-y.", es:"Vamos."},
  {en:"How are you?", my:"နေကောင်းလား။", zh:"你好吗？", th:"สบายดีไหมครับ/ค่ะ", fr:"Comment allez-vous ?", es:"¿Cómo estás?"},
  {en:"I am fine.", my:"နေကောင်းပါတယ်။", zh:"我很好。", th:"สบายดีครับ/ค่ะ", fr:"Je vais bien.", es:"Estoy bien."},
  {en:"I am tired.", my:"ငါပင်ပန်းနေတယ်။", zh:"我累了。", th:"ฉันเหนื่อยครับ/ค่ะ", fr:"Je suis fatigué.", es:"Estoy cansado."},
  {en:"What is your name?", my:"နာမည်ဘယ်လိုခေါ်လဲ။", zh:"你叫什么名字？", th:"คุณชื่ออะไรครับ/ค่ะ", fr:"Comment vous appelez-vous ?", es:"¿Cómo te llamas?"},
  {en:"Nice to meet you.", my:"တွေ့ရတာ ဝမ်းသာပါတယ်။", zh:"很高兴认识你。", th:"ยินดีที่ได้รู้จักครับ/ค่ะ", fr:"Enchanté de vous rencontrer.", es:"Mucho gusto."},
  {en:"Where are you going?", my:"ဘယ်သွားမလို့လဲ။", zh:"你要去哪里？", th:"คุณจะไปไหนครับ/ค่ะ", fr:"Où allez-vous ?", es:"¿A dónde vas?"},
  {en:"What did you eat today?", my:"ဒီနေ့ ဘာစားခဲ့လဲ။", zh:"你今天吃了什么？", th:"วันนี้คุณกินอะไรครับ/ค่ะ", fr:"Qu'avez-vous mangé aujourd'hui ?", es:"¿Qué comiste hoy?"},
  {en:"What should we eat today?", my:"ဒီနေ့ ဘာစားရင်ကောင်းမလဲ။", zh:"我们今天吃什么好呢？", th:"วันนี้กินอะไรดีครับ/ค่ะ", fr:"Que devrions-nous manger aujourd'hui ?", es:"¿Qué deberíamos comer hoy?"},
  {en:"I have a headache.", my:"ငါခေါင်းကိုက်နေတယ်။", zh:"我头疼。", th:"ฉันปวดหัวครับ/ค่ะ", fr:"J'ai mal à la tête.", es:"Me duele la cabeza."},
  {en:"I feel sick.", my:"ငါနေမကောင်းဘူး။", zh:"我不舒服。", th:"ฉันรู้สึกไม่สบายครับ/ค่ะ", fr:"Je ne me sens pas bien.", es:"Me siento mal."},
  {en:"Please call a doctor.", my:"ဆရာဝန်ကိုခေါ်ပေးပါ။", zh:"请叫医生。", th:"กรุณาเรียกหมอครับ/ค่ะ", fr:"Veuillez appeler un médecin.", es:"Por favor, llame a un médico."},
  {en:"I don't have money.", my:"ငါ့မှာပိုက်ဆံမရှိဘူး။", zh:"我没有钱。", th:"ฉันไม่มีเงินครับ/ค่ะ", fr:"Je n'ai pas d'argent.", es:"No tengo dinero."},
  {en:"How many people?", my:"ဘယ်နှစ်ယောက်ရှိလဲ။", zh:"有几个人？", th:"มีกี่คนครับ/ค่ะ", fr:"Combien de personnes ?", es:"¿Cuántas personas?"},
  {en:"What time should I come?", my:"ဘယ်အချိန်လာရမလဲ။", zh:"我应该几点来？", th:"ควรมาตอนกี่โมงครับ/ค่ะ", fr:"À quelle heure dois-je venir ?", es:"¿A qué hora debo venir?"},
  {en:"I will be late.", my:"ငါနောက်ကျမယ်။", zh:"我会迟到。", th:"ฉันจะไปสายครับ/ค่ะ", fr:"Je serai en retard.", es:"Llegaré tarde."},
  {en:"I am on the way to work.", my:"အလုပ်ကို သွားနေပါတယ်။", zh:"我正在去上班的路上。", th:"ฉันกำลังไปทำงานครับ/ค่ะ", fr:"Je suis en route pour le travail.", es:"Voy camino al trabajo."},
  {en:"Please explain how to do it.", my:"ဘယ်လိုလုပ်ရမလဲ ပြောပြပါဦး။", zh:"请解释一下怎么做。", th:"กรุณาอธิบายวิธีทำครับ/ค่ะ", fr:"Veuillez expliquer comment le faire.", es:"Por favor, explica cómo hacerlo."},
  {en:"I don't know what to say.", my:"ဘာပြောရမှန်းတောင်မသိဘူး။", zh:"我不知道该说什么。", th:"ฉันไม่รู้จะพูดอะไรครับ/ค่ะ", fr:"Je ne sais pas quoi dire.", es:"No sé qué decir."},
  {en:"Turn left.", my:"ဘယ်ဘက်ကွေ့ပါ။", zh:"向左转。", th:"เลี้ยวซ้ายครับ/ค่ะ", fr:"Tournez à gauche.", es:"Gire a la izquierda."},
  {en:"Turn right.", my:"ညာဘက်ကွေ့ပါ။", zh:"向右转。", th:"เลี้ยวขวาครับ/ค่ะ", fr:"Tournez à droite.", es:"Gire a la derecha."},
  {en:"Go straight.", my:"တည့်တည့်သွားပါ။", zh:"直走。", th:"ตรงไปครับ/ค่ะ", fr:"Allez tout droit.", es:"Siga derecho."},
  {en:"Stop here.", my:"ဒီမှာရပ်ပါ။", zh:"停在这里。", th:"หยุดตรงนี้ครับ/ค่ะ", fr:"Arrêtez-vous ici.", es:"Deténgase aquí."},
  {en:"I like it.", my:"ငါကြိုက်တယ်။", zh:"我喜欢。", th:"ฉันชอบครับ/ค่ะ", fr:"J'aime ça.", es:"Me gusta."},
  {en:"I don't like it.", my:"ငါမကြိုက်ဘူး။", zh:"我不喜欢。", th:"ฉันไม่ชอบครับ/ค่ะ", fr:"Je n'aime pas ça.", es:"No me gusta."},
  {en:"Is this okay?", my:"ဒါဖြစ်လား။", zh:"这样可以吗？", th:"แบบนี้ได้ไหมครับ/ค่ะ", fr:"Est-ce que ça va ?", es:"¿Está bien esto?"},
  {en:"Everything is fine.", my:"အားလုံးအဆင်ပြေပါတယ်။", zh:"一切都好。", th:"ทุกอย่างเรียบร้อยดีครับ/ค่ะ", fr:"Tout va bien.", es:"Todo está bien."},
  {en:"I need more time.", my:"ငါ့မှာအချိန်ပိုလိုအပ်တယ်။", zh:"我需要更多时间。", th:"ฉันต้องการเวลาเพิ่มครับ/ค่ะ", fr:"J'ai besoin de plus de temps.", es:"Necesito más tiempo."},
  {en:"Let me think about it.", my:"စဉ်းစားကြည့်ရအောင်။", zh:"让我想一想。", th:"ขอคิดดูก่อนครับ/ค่ะ", fr:"Laissez-moi y réfléchir.", es:"Déjame pensarlo."},
  {en:"I already finished it.", my:"ငါပြီးသွားပြီ။", zh:"我已经完成了。", th:"ฉันทำเสร็จแล้วครับ/ค่ะ", fr:"Je l'ai déjà terminé.", es:"Ya lo terminé."},
  {en:"I need to see a doctor.", my:"ငါဆရာဝန်ပြချင်ပါတယ်။", zh:"我需要看医生。", th:"ฉันต้องไปหาหมอครับ/ค่ะ", fr:"J'ai besoin de voir un médecin.", es:"Necesito ver a un médico."},
  {en:"Where is the nearest hospital?", my:"အနီးဆုံးဆေးရုံ ဘယ်မှာလဲ။", zh:"最近的医院在哪里？", th:"โรงพยาบาลที่ใกล้ที่สุดอยู่ที่ไหนครับ/ค่ะ", fr:"Où est l'hôpital le plus proche ?", es:"¿Dónde está el hospital más cercano?"},
  {en:"I have an allergy to this medicine.", my:"ဒီဆေးကို ငါမတည့်ဘူး။", zh:"我对这个药过敏。", th:"ฉันแพ้ยานี้ครับ/ค่ะ", fr:"Je suis allergique à ce médicament.", es:"Soy alérgico a este medicamento."},
  {en:"I got injured at work.", my:"အလုပ်မှာ ဒဏ်ရာရသွားတယ်။", zh:"我在工作时受伤了。", th:"ฉันได้รับบาดเจ็บจากการทำงานครับ/ค่ะ", fr:"Je me suis blessé au travail.", es:"Me lesioné en el trabajo."},
  {en:"Please call an ambulance.", my:"လူနာတင်ကားခေါ်ပေးပါ။", zh:"请叫救护车。", th:"กรุณาเรียกรถพยาบาลครับ/ค่ะ", fr:"Veuillez appeler une ambulance.", es:"Por favor, llame a una ambulancia."},
  {en:"I haven't been paid this month.", my:"ဒီလ လစာမရသေးပါဘူး။", zh:"我这个月还没领到工资。", th:"ฉันยังไม่ได้รับเงินเดือนของเดือนนี้ครับ/ค่ะ", fr:"Je n'ai pas encore été payé ce mois-ci.", es:"No me han pagado este mes."},
  {en:"This is less than what we agreed.", my:"ဒါက သဘောတူထားတာထက် နည်းနေတယ်။", zh:"这比我们约定的要少。", th:"นี่น้อยกว่าที่เราตกลงกันไว้ครับ/ค่ะ", fr:"C'est moins que ce que nous avions convenu.", es:"Esto es menos de lo que acordamos."},
  {en:"Can I see the work contract?", my:"အလုပ်စာချုပ်ကို ကြည့်လို့ရလား။", zh:"我可以看看工作合同吗？", th:"ฉันขอดูสัญญาจ้างงานได้ไหมครับ/ค่ะ", fr:"Puis-je voir le contrat de travail ?", es:"¿Puedo ver el contrato de trabajo?"},
  {en:"How many hours of overtime is this?", my:"ဒါ အချိန်ပို ဘယ်နှစ်နာရီလဲ။", zh:"这是多少小时的加班？", th:"นี่คือการทำงานล่วงเวลากี่ชั่วโมงครับ/ค่ะ", fr:"Combien d'heures supplémentaires cela représente-t-il ?", es:"¿Cuántas horas extras son estas?"},
  {en:"I lost my passport.", my:"ငါ့နိုင်ငံကူးလက်မှတ် ပျောက်သွားတယ်။", zh:"我的护照丢了。", th:"หนังสือเดินทางของฉันหายครับ/ค่ะ", fr:"J'ai perdu mon passeport.", es:"Perdí mi pasaporte."},
  {en:"Where is the immigration office?", my:"လူဝင်မှုကြီးကြပ်ရေး ရုံးဘယ်မှာလဲ။", zh:"移民局在哪里？", th:"สำนักงานตรวจคนเข้าเมืองอยู่ที่ไหนครับ/ค่ะ", fr:"Où se trouve le bureau de l'immigration ?", es:"¿Dónde está la oficina de inmigración?"},
  {en:"My visa is about to expire.", my:"ငါ့ဗီဇာသက်တမ်း နီးလာပြီ။", zh:"我的签证快要过期了。", th:"วีซ่าของฉันใกล้จะหมดอายุแล้วครับ/ค่ะ", fr:"Mon visa est sur le point d'expirer.", es:"Mi visa está por vencer."},
  {en:"I need a copy of this document.", my:"ဒီစာရွက်ရဲ့ မိတ္တူတစ်စောင် လိုချင်ပါတယ်။", zh:"我需要这份文件的副本。", th:"ฉันต้องการสำเนาเอกสารนี้ครับ/ค่ะ", fr:"J'ai besoin d'une copie de ce document.", es:"Necesito una copia de este documento."},
  {en:"Is this place safe to work in?", my:"ဒီနေရာက အလုပ်လုပ်ဖို့ ဘေးကင်းလား။", zh:"这个地方工作安全吗？", th:"ที่นี่ทำงานปลอดภัยไหมครับ/ค่ะ", fr:"Est-ce que cet endroit est sûr pour travailler ?", es:"¿Es seguro trabajar en este lugar?"},
  {en:"The landlord raised the rent.", my:"အိမ်ရှင်က အိမ်ခ တိုးလိုက်တယ်။", zh:"房东涨房租了。", th:"เจ้าของบ้านขึ้นค่าเช่าครับ/ค่ะ", fr:"Le propriétaire a augmenté le loyer.", es:"El propietario subió el alquiler."},
  {en:"The electricity is not working.", my:"မီးမလာဘူး။", zh:"停电了。", th:"ไฟฟ้าไม่ทำงานครับ/ค่ะ", fr:"L'électricité ne fonctionne pas.", es:"No hay electricidad."},
  {en:"Please give me a receipt.", my:"ငွေရရှိကြောင်း ပြေစာပေးပါ။", zh:"请给我一张收据。", th:"กรุณาให้ใบเสร็จด้วยครับ/ค่ะ", fr:"Veuillez me donner un reçu.", es:"Por favor, deme un recibo."},
  {en:"I want to report a problem.", my:"ပြဿနာတစ်ခု တိုင်ကြားချင်ပါတယ်။", zh:"我想举报一个问题。", th:"ฉันต้องการแจ้งปัญหาครับ/ค่ะ", fr:"Je veux signaler un problème.", es:"Quiero reportar un problema."},
  {en:"Please don't worry.", my:"စိတ်မပူပါနဲ့။", zh:"请不要担心。", th:"ไม่ต้องกังวลครับ/ค่ะ", fr:"Ne vous inquiétez pas.", es:"No se preocupe."},
];

const WORDS = [
  {en:"I", my:"ငါ", zh:"我", th:"ฉัน", fr:"je", es:"yo"},
  {en:"you", my:"နင်", zh:"你", th:"คุณ", fr:"tu", es:"tú"},
  {en:"we", my:"ငါတို့", zh:"我们", th:"เรา", fr:"nous", es:"nosotros"},
  {en:"he", my:"သူ", zh:"他", th:"เขา", fr:"il", es:"él"},
  {en:"today", my:"ဒီနေ့", zh:"今天", th:"วันนี้", fr:"aujourd'hui", es:"hoy"},
  {en:"tomorrow", my:"မနက်ဖြန်", zh:"明天", th:"พรุ่งนี้", fr:"demain", es:"mañana"},
  {en:"yesterday", my:"မနေ့က", zh:"昨天", th:"เมื่อวาน", fr:"hier", es:"ayer"},
  {en:"now", my:"အခု", zh:"现在", th:"ตอนนี้", fr:"maintenant", es:"ahora"},
  {en:"later", my:"နောက်မှ", zh:"稍后", th:"ทีหลัง", fr:"plus tard", es:"más tarde"},
  {en:"good", my:"ကောင်းတယ်", zh:"好", th:"ดี", fr:"bon", es:"bueno"},
  {en:"bad", my:"မကောင်းဘူး", zh:"不好", th:"ไม่ดี", fr:"mauvais", es:"malo"},
  {en:"big", my:"ကြီးတယ်", zh:"大", th:"ใหญ่", fr:"grand", es:"grande"},
  {en:"small", my:"သေးတယ်", zh:"小", th:"เล็ก", fr:"petit", es:"pequeño"},
  {en:"hot", my:"ပူတယ်", zh:"热", th:"ร้อน", fr:"chaud", es:"caliente"},
  {en:"cold", my:"အေးတယ်", zh:"冷", th:"หนาว", fr:"froid", es:"frío"},
  {en:"water", my:"ရေ", zh:"水", th:"น้ำ", fr:"eau", es:"agua"},
  {en:"food", my:"အစားအစာ", zh:"食物", th:"อาหาร", fr:"nourriture", es:"comida"},
  {en:"money", my:"ငွေ", zh:"钱", th:"เงิน", fr:"argent", es:"dinero"},
  {en:"work", my:"အလုပ်", zh:"工作", th:"งาน", fr:"travail", es:"trabajo"},
  {en:"home", my:"အိမ်", zh:"家", th:"บ้าน", fr:"maison", es:"casa"},
  {en:"go", my:"သွားတယ်", zh:"去", th:"ไป", fr:"aller", es:"ir"},
  {en:"come", my:"လာတယ်", zh:"来", th:"มา", fr:"venir", es:"venir"},
  {en:"eat", my:"စားတယ်", zh:"吃", th:"กิน", fr:"manger", es:"comer"},
  {en:"drink", my:"သောက်တယ်", zh:"喝", th:"ดื่ม", fr:"boire", es:"beber"},
  {en:"sleep", my:"အိပ်တယ်", zh:"睡觉", th:"นอน", fr:"dormir", es:"dormir"},
  {en:"buy", my:"ဝယ်တယ်", zh:"买", th:"ซื้อ", fr:"acheter", es:"comprar"},
  {en:"sell", my:"ရောင်းတယ်", zh:"卖", th:"ขาย", fr:"vendre", es:"vender"},
  {en:"open", my:"ဖွင့်တယ်", zh:"开", th:"เปิด", fr:"ouvrir", es:"abrir"},
  {en:"close", my:"ပိတ်တယ်", zh:"关", th:"ปิด", fr:"fermer", es:"cerrar"},
  {en:"fast", my:"မြန်တယ်", zh:"快", th:"เร็ว", fr:"rapide", es:"rápido"},
  {en:"slow", my:"နှေးတယ်", zh:"慢", th:"ช้า", fr:"lent", es:"lento"},
  {en:"one", my:"တစ်", zh:"一", th:"หนึ่ง", fr:"un", es:"uno"},
  {en:"two", my:"နှစ်", zh:"二", th:"สอง", fr:"deux", es:"dos"},
  {en:"three", my:"သုံး", zh:"三", th:"สาม", fr:"trois", es:"tres"},
  {en:"many", my:"များများ", zh:"很多", th:"เยอะ", fr:"beaucoup", es:"muchos"},
  {en:"here", my:"ဒီမှာ", zh:"这里", th:"ที่นี่", fr:"ici", es:"aquí"},
  {en:"there", my:"အဲ့မှာ", zh:"那里", th:"ที่นั่น", fr:"là-bas", es:"allí"},
  {en:"what", my:"ဘာ", zh:"什么", th:"อะไร", fr:"quoi", es:"qué"},
  {en:"who", my:"ဘယ်သူ", zh:"谁", th:"ใคร", fr:"qui", es:"quién"},
  {en:"why", my:"ဘာကြောင့်", zh:"为什么", th:"ทำไม", fr:"pourquoi", es:"por qué"},
  {en:"how", my:"ဘယ်လို", zh:"怎么", th:"อย่างไร", fr:"comment", es:"cómo"},
  {en:"please", my:"ကျေးဇူးပြု၍", zh:"请", th:"กรุณา", fr:"s'il vous plaît", es:"por favor"},
  {en:"thanks", my:"ကျေးဇူးတင်ပါတယ်", zh:"谢谢", th:"ขอบคุณ", fr:"merci", es:"gracias"},
  {en:"sorry", my:"တောင်းပန်ပါတယ်", zh:"对不起", th:"ขอโทษ", fr:"désolé", es:"lo siento"},
  {en:"yes", my:"ဟုတ်ကဲ့", zh:"是", th:"ใช่", fr:"oui", es:"sí"},
  {en:"no", my:"မဟုတ်ဘူး", zh:"不", th:"ไม่", fr:"non", es:"no"},
  {en:"want", my:"လိုချင်တယ်", zh:"想要", th:"ต้องการ", fr:"vouloir", es:"querer"},
  {en:"need", my:"လိုအပ်တယ်", zh:"需要", th:"จำเป็น", fr:"avoir besoin", es:"necesitar"},
  {en:"tired", my:"ပင်ပန်းတယ်", zh:"累", th:"เหนื่อย", fr:"fatigué", es:"cansado"},
  {en:"happy", my:"ပျော်တယ်", zh:"开心", th:"มีความสุข", fr:"heureux", es:"feliz"},
  {en:"sad", my:"ဝမ်းနည်းတယ်", zh:"难过", th:"เศร้า", fr:"triste", es:"triste"},
  {en:"angry", my:"စိတ်ဆိုးတယ်", zh:"生气", th:"โกรธ", fr:"en colère", es:"enojado"},
  {en:"sick", my:"နေမကောင်းဘူး", zh:"生病", th:"ป่วย", fr:"malade", es:"enfermo"},
  {en:"friend", my:"သူငယ်ချင်း", zh:"朋友", th:"เพื่อน", fr:"ami", es:"amigo"},
  {en:"family", my:"မိသားစု", zh:"家人", th:"ครอบครัว", fr:"famille", es:"familia"},
  {en:"time", my:"အချိန်", zh:"时间", th:"เวลา", fr:"temps", es:"tiempo"},
  {en:"day", my:"နေ့", zh:"天", th:"วัน", fr:"jour", es:"día"},
  {en:"morning", my:"မနက်", zh:"早上", th:"เช้า", fr:"matin", es:"mañana"},
  {en:"evening", my:"ညနေ", zh:"晚上", th:"เย็น", fr:"soir", es:"tarde"},
  {en:"night", my:"ညဘက်", zh:"夜晚", th:"กลางคืน", fr:"nuit", es:"noche"},
  {en:"finish", my:"ပြီးတယ်", zh:"完成", th:"เสร็จ", fr:"finir", es:"terminar"},
  {en:"start", my:"စတယ်", zh:"开始", th:"เริ่ม", fr:"commencer", es:"empezar"},
  {en:"wait", my:"စောင့်တယ်", zh:"等", th:"รอ", fr:"attendre", es:"esperar"},
  {en:"help", my:"ကူညီတယ်", zh:"帮助", th:"ช่วยเหลือ", fr:"aider", es:"ayudar"},
  {en:"problem", my:"ပြဿနာ", zh:"问题", th:"ปัญหา", fr:"problème", es:"problema"},
  {en:"correct", my:"မှန်တယ်", zh:"正确", th:"ถูกต้อง", fr:"correct", es:"correcto"},
  {en:"wrong", my:"မှားတယ်", zh:"错误", th:"ผิด", fr:"faux", es:"incorrecto"},
  {en:"four", my:"လေး", zh:"四", th:"สี่", fr:"quatre", es:"cuatro"},
  {en:"five", my:"ငါး", zh:"五", th:"ห้า", fr:"cinq", es:"cinco"},
  {en:"six", my:"ခြောက်", zh:"六", th:"หก", fr:"six", es:"seis"},
  {en:"seven", my:"ခုနှစ်", zh:"七", th:"เจ็ด", fr:"sept", es:"siete"},
  {en:"eight", my:"ရှစ်", zh:"八", th:"แปด", fr:"huit", es:"ocho"},
  {en:"nine", my:"ကိုး", zh:"九", th:"เก้า", fr:"neuf", es:"nueve"},
  {en:"ten", my:"ဆယ်", zh:"十", th:"สิบ", fr:"dix", es:"diez"},
  {en:"hundred", my:"ရာ", zh:"百", th:"ร้อย", fr:"cent", es:"cien"},
  {en:"thousand", my:"ထောင်", zh:"千", th:"พัน", fr:"mille", es:"mil"},
  {en:"Monday", my:"တနင်္လာနေ့", zh:"星期一", th:"วันจันทร์", fr:"lundi", es:"lunes"},
  {en:"Tuesday", my:"အင်္ဂါနေ့", zh:"星期二", th:"วันอังคาร", fr:"mardi", es:"martes"},
  {en:"Wednesday", my:"ဗုဒ္ဓဟူးနေ့", zh:"星期三", th:"วันพุธ", fr:"mercredi", es:"miércoles"},
  {en:"Thursday", my:"ကြာသပတေးနေ့", zh:"星期四", th:"วันพฤหัสบดี", fr:"jeudi", es:"jueves"},
  {en:"Friday", my:"သောကြာနေ့", zh:"星期五", th:"วันศุกร์", fr:"vendredi", es:"viernes"},
  {en:"Saturday", my:"စနေနေ့", zh:"星期六", th:"วันเสาร์", fr:"samedi", es:"sábado"},
  {en:"Sunday", my:"တနင်္ဂနွေနေ့", zh:"星期天", th:"วันอาทิตย์", fr:"dimanche", es:"domingo"},
  {en:"salary", my:"လစာ", zh:"工资", th:"เงินเดือน", fr:"salaire", es:"salario"},
  {en:"overtime", my:"အချိန်ပို", zh:"加班", th:"ทำงานล่วงเวลา", fr:"heures supplémentaires", es:"horas extras"},
  {en:"boss", my:"အထက်လူကြီး", zh:"老板", th:"เจ้านาย", fr:"patron", es:"jefe"},
  {en:"contract", my:"စာချုပ်", zh:"合同", th:"สัญญา", fr:"contrat", es:"contrato"},
  {en:"passport", my:"နိုင်ငံကူးလက်မှတ်", zh:"护照", th:"หนังสือเดินทาง", fr:"passeport", es:"pasaporte"},
  {en:"police", my:"ရဲ", zh:"警察", th:"ตำรวจ", fr:"police", es:"policía"},
  {en:"hospital", my:"ဆေးရုံ", zh:"医院", th:"โรงพยาบาล", fr:"hôpital", es:"hospital"},
  {en:"doctor", my:"ဆရာဝန်", zh:"医生", th:"หมอ", fr:"médecin", es:"médico"},
  {en:"medicine", my:"ဆေးဝါး", zh:"药", th:"ยา", fr:"médicament", es:"medicina"},
  {en:"pain", my:"နာကျင်မှု", zh:"疼痛", th:"อาการปวด", fr:"douleur", es:"dolor"},
  {en:"injury", my:"ဒဏ်ရာ", zh:"受伤", th:"บาดเจ็บ", fr:"blessure", es:"lesión"},
  {en:"blood", my:"သွေး", zh:"血", th:"เลือด", fr:"sang", es:"sangre"},
  {en:"fever", my:"အဖျား", zh:"发烧", th:"ไข้", fr:"fièvre", es:"fiebre"},
  {en:"emergency", my:"အရေးပေါ်", zh:"紧急情况", th:"เหตุฉุกเฉิน", fr:"urgence", es:"emergencia"},
  {en:"ambulance", my:"လူနာတင်ကား", zh:"救护车", th:"รถพยาบาล", fr:"ambulance", es:"ambulancia"},
  {en:"rent", my:"အိမ်ငှားခ", zh:"房租", th:"ค่าเช่า", fr:"loyer", es:"alquiler"},
  {en:"landlord", my:"အိမ်ရှင်", zh:"房东", th:"เจ้าของบ้าน", fr:"propriétaire", es:"propietario"},
  {en:"electricity", my:"မီးလျှပ်စစ်", zh:"电", th:"ไฟฟ้า", fr:"électricité", es:"electricidad"},
  {en:"danger", my:"အန္တရာယ်", zh:"危险", th:"อันตราย", fr:"danger", es:"peligro"},
  {en:"safe", my:"ဘေးကင်းတယ်", zh:"安全", th:"ปลอดภัย", fr:"sûr", es:"seguro"},
  {en:"machine", my:"စက်ပစ္စည်း", zh:"机器", th:"เครื่องจักร", fr:"machine", es:"máquina"},
  {en:"document", my:"စာရွက်စာတမ်း", zh:"文件", th:"เอกสาร", fr:"document", es:"documento"},
  {en:"signature", my:"လက်မှတ်", zh:"签名", th:"ลายเซ็น", fr:"signature", es:"firma"},
];

/**
 * Advanced offline translator.
 * 1) Exact phrase match  2) Substring phrase match
 * 3) Compositional word-by-word greedy match (works without network,
 *    even for sentences never seen before, as long as the vocabulary
 *    inside it is known).
 * Returns {text, approx} or null if nothing could be matched at all.
 */
/**
 * Translation Memory: every time the AI successfully translates something
 * online, we remember the exact pair. Later, if the same (or near-identical)
 * text comes up again while fully offline, we reuse that real translation
 * instead of guessing word-by-word — this is what makes offline mode
 * actually reliable for sentences you've used before, long or short.
 */
let translationMemory = {};
try{
  const raw = localStorage.getItem('wt_translationMemory');
  if(raw) translationMemory = JSON.parse(raw);
}catch(e){ translationMemory = {}; }

