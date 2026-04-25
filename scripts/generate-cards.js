// Card image generator — Blink Premium
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUT  = path.join(__dirname, '../public/carousel');
const LOGO = path.join(__dirname, '../public/site/assets/logo-blinkpremium.png');
const LOGO_B64 = 'data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64');

const CARDS = [
  { n:'01', bg:'#1a237e', cat_color:'#FFC107', icon:'📦',
    fr:{ cat:'LOGISTIQUE',       title:'Migration\nlogiciel',       tag:'Passage sans friction\nvers Blink — zéro perte\nde données' },
    ar:{ cat:'لوجستيك',          title:'ترحيل\nالمنظومة',           tag:'انتقال تلقائي — العملاء\nوالموردون محفوظون' },
    es:{ cat:'LOGÍSTICA',        title:'Migración\nsoftware',       tag:'Transición sin fricciones\na Blink — cero pérdida\nde datos' },
    ru:{ cat:'ЛОГИСТИКА',        title:'Миграция\nсистемы',         tag:'Переход на Blink\nбез потери данных' },
  },
  { n:'02', bg:'#003d4d', cat_color:'#26C6DA', icon:'💻',
    fr:{ cat:'ONBOARDING',       title:'Prise en\nmain',            tag:'Démarrez en quelques\nheures,\naccompagné par notre équipe' },
    ar:{ cat:'انطلاق',           title:'سهولة\nالاستخدام',          tag:'جاهز للعمل من اليوم الأول\nبمرافقة فريقنا' },
    es:{ cat:'ONBOARDING',       title:'Prise en\nmain',            tag:'Listo en pocas horas,\nacompañado por\nnuestro equipo' },
    ru:{ cat:'ОНБОРДИНГ',        title:'Лёгкое\nосвоение',          tag:'Готовы к работе с первого\nдня с поддержкой команды' },
  },
  { n:'03', bg:'#0d1f3c', cat_color:'#4FC3F7', icon:'📊',
    fr:{ cat:'GESTION',          title:'Contrôle\ndes\nstocks',     tag:'Zéro surplus —\nvisibilité temps réel' },
    ar:{ cat:'إدارة',            title:'مراقبة\nالمخزون',           tag:'صفر تجاوزات —\nرؤية في الوقت الفعلي' },
    es:{ cat:'GESTIÓN',          title:'Control de\nstock',         tag:'Cero excedentes —\nvisibilidad en tiempo real' },
    ru:{ cat:'УПРАВЛЕНИЕ',       title:'Контроль\nзапасов',         tag:'Ноль излишков —\nвидимость в реальном времени' },
  },
  { n:'04', bg:'#1a2540', cat_color:'#7986CB', icon:'📱',
    fr:{ cat:'MOBILITÉ',         title:'Inventaire\nmobile',        tag:'Comptez depuis votre\nrayon,\nsans retour au bureau' },
    ar:{ cat:'تنقل',             title:'الجرد عبر\nالجوال',         tag:'احسب من رفوفك\nدون العودة للمكتب' },
    es:{ cat:'MOVILIDAD',        title:'Inventario\nmóvil',         tag:'Cuenta desde tu lineal,\nsin volver al mostrador' },
    ru:{ cat:'МОБИЛЬНОСТЬ',      title:'Мобильная\nинвентаризация', tag:'Считайте с полки\nбез возврата на место' },
  },
  { n:'05', bg:'#2d0a0a', cat_color:'#EF9A9A', icon:'🤖',
    fr:{ cat:'INTELLIGENCE',     title:'Scan IA\nlivraisons',       tag:'Réception automatique\net intelligente des\ncommandes' },
    ar:{ cat:'ذكاء اصطناعي',    title:'مسح IA\nللتسليمات',        tag:'استقبال تلقائي\nوذكي للطلبات' },
    es:{ cat:'INTELIGENCIA',     title:'Escaneo IA\nentregas',      tag:'Recepción automática\ne inteligente de pedidos' },
    ru:{ cat:'ИИ',               title:'ИИ-скан\nпоставок',        tag:'Автоматический и умный\nприём заказов' },
  },
  { n:'06', bg:'#0a2016', cat_color:'#26C6DA', icon:'🤝',
    fr:{ cat:'RÉSEAU',           title:'Achats\ngroupés',           tag:'Plus forts ensemble —\nnégociez avec le\ngroupement' },
    ar:{ cat:'شبكة',             title:'المشتريات\nالجماعية',       tag:'معاً أقوى —\nتفاوضوا مع المجموعة' },
    es:{ cat:'RED',              title:'Compras\ngrupales',         tag:'Más fuertes juntos —\nnegociad con el grupo' },
    ru:{ cat:'СЕТЬ',             title:'Групповые\nзакупки',        tag:'Вместе сильнее —\nпереговоры с группой' },
  },
  { n:'07', bg:'#0a1628', cat_color:'#4FC3F7', icon:'📲',
    fr:{ cat:'APPLICATION',      title:'App\nmobile\ngratuite',     tag:'dans votre poche, partout' },
    ar:{ cat:'تطبيق',            title:'تطبيق\nمجاني',             tag:'في جيبك، في كل مكان' },
    es:{ cat:'APLICACIÓN',       title:'App\nmóvil\ngratuita',      tag:'en tu bolsillo, en cualquier lugar' },
    ru:{ cat:'ПРИЛОЖЕНИЕ',       title:'Бесплатное\nприложение',    tag:'в вашем кармане, везде' },
  },
  { n:'08', bg:'#1a0f00', cat_color:'#FFA726', icon:'🔄',
    fr:{ cat:'ÉVOLUTION',        title:'Blink\névolue ?',           tag:'Toujours une longueur\nd\'avance sur vos besoins' },
    ar:{ cat:'تطور',             title:'بلينك\nيتطور؟',            tag:'دائماً خطوة للأمام\nعلى احتياجاتك' },
    es:{ cat:'EVOLUCIÓN',        title:'¿Blink\nevoluciona?',       tag:'Siempre un paso por\ndelante de tus necesidades' },
    ru:{ cat:'ЭВОЛЮЦИЯ',         title:'Blink\nразвивается?',       tag:'Всегда на шаг впереди\nваших потребностей' },
  },
];

const LANGS = ['ar', 'es', 'ru'];

function cardHtml(card, lang) {
  const d = card[lang];
  const isRtl = lang === 'ar';
  const titleLines = d.title.split('\n');
  const tagLines   = d.tag.split('\n');
  const titleSize  = titleLines.length > 2 ? '86px' : '104px';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@900&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1512px; height:800px; overflow:hidden; background:#000; }
.card {
  width:1512px; height:800px;
  background:${card.bg};
  position:relative;
  font-family:'DM Sans', system-ui, sans-serif;
  overflow:hidden;
  direction:${isRtl ? 'rtl' : 'ltr'};
}
.grid {
  position:absolute; inset:0;
  background-image:
    linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size:56px 56px;
}
.glow {
  position:absolute;
  right:-60px; top:-60px;
  width:460px; height:460px;
  background:radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%);
  border-radius:50%;
}
.left {
  position:absolute;
  ${isRtl ? 'right' : 'left'}:80px;
  top:72px; bottom:72px; width:580px;
  display:flex; flex-direction:column;
  z-index:2;
}
.cat {
  font-size:22px; font-weight:700;
  letter-spacing:${isRtl ? '0.02em' : '0.12em'};
  text-transform:${isRtl ? 'none' : 'uppercase'};
  color:${card.cat_color};
  margin-bottom:22px;
}
.icon { font-size:68px; margin-bottom:24px; line-height:1; }
.title {
  font-family:'Nunito', sans-serif;
  font-size:${titleSize};
  font-weight:900;
  color:white;
  line-height:1.05;
  margin-bottom:28px;
  letter-spacing:-0.01em;
}
.tag {
  font-size:26px;
  line-height:1.6;
  color:rgba(255,255,255,0.52);
  max-width:520px;
}
.right-panel {
  position:absolute;
  ${isRtl ? 'left' : 'right'}:72px;
  top:50%; transform:translateY(-50%);
  width:660px; height:500px;
  background:white;
  border-radius:18px;
  display:flex; align-items:center; justify-content:center;
  overflow:hidden;
  z-index:2;
  box-shadow: 0 24px 80px rgba(0,0,0,0.55);
}
.right-panel img {
  max-width:80%; max-height:80%;
  object-fit:contain;
}
.counter {
  position:absolute;
  ${isRtl ? 'left' : 'right'}:52px; top:36px;
  font-size:20px; font-weight:600;
  letter-spacing:0.05em;
  color:rgba(255,255,255,0.32);
  z-index:3; line-height:1.5;
  text-align:${isRtl ? 'left' : 'right'};
}
.footer {
  position:absolute;
  ${isRtl ? 'left' : 'right'}:52px; bottom:36px;
  display:flex; align-items:center; gap:9px;
  font-size:16px; font-weight:700;
  letter-spacing:0.1em;
  color:rgba(255,255,255,0.25);
  z-index:3;
  flex-direction:${isRtl ? 'row-reverse' : 'row'};
}
.dot { width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,0.25); }
</style>
</head>
<body>
<div class="card">
  <div class="grid"></div>
  <div class="glow"></div>
  <div class="left">
    <div class="cat">${d.cat}</div>
    <div class="icon">${card.icon}</div>
    <div class="title">${titleLines.join('<br>')}</div>
    <div class="tag">${tagLines.join('<br>')}</div>
  </div>
  <div class="right-panel">
    <img src="${LOGO_B64}" alt="Blink Premium">
  </div>
  <div class="counter">${card.n} /<br>10</div>
  <div class="footer"><span class="dot"></span><span>BLINK<br>PHARMACIE</span></div>
</div>
</body>
</html>`;
}

async function run() {
  console.log('Launching Chrome…');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  for (const lang of LANGS) {
    for (const card of CARDS) {
      const html = cardHtml(card, lang);
      const page = await browser.newPage();
      await page.setViewport({ width: 1512, height: 800, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 1200));

      const fname   = `blink-carte-${card.n}-${lang}.jpg`;
      const outPath = path.join(OUT, fname);
      await page.screenshot({ path: outPath, type: 'jpeg', quality: 85 });
      await page.close();
      console.log(`✓ ${fname}`);
    }
  }

  await browser.close();
  console.log('\nAll 24 cards generated.');
}

run().catch(err => { console.error(err); process.exit(1); });
