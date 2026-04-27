// Blink Premium — i18n translations
(function () {
  const params = new URLSearchParams(window.location.search);
  const supported = ['fr', 'ar', 'es', 'ru'];
  const stored = localStorage.getItem('blink_lang');
  let lang = params.get('lang') || stored || 'fr';
  if (!supported.includes(lang)) lang = 'fr';
  localStorage.setItem('blink_lang', lang);
  window.BLANG = lang;

  const BASE = 'https://whatsapp-pharma-bot-production.up.railway.app/site/';

  // ─── FEATURES per language ───────────────────────────────────────────────
  const FEATURES_FR = [
    { title:"Migration simplifiée",  claim:"Passage sans friction vers Blink — zéro perte de données.",           category:"LOGISTIQUE",  color:"#3F51B5", bg:"#1a237e", icon:"📦", anchor:"migration",        badge:"Données importées",        badgeIcon:"📦" },
    { title:"Prise en main rapide",  claim:"Interface intuitive — votre équipe opérationnelle dès J+1.",           category:"INTERFACE",   color:"#26C6DA", bg:"#004d5e", icon:"⚡", anchor:"prise-en-main",    badge:"Formation terminée",       badgeIcon:"⚡" },
    { title:"Contrôle des stocks",   claim:"Stocks en temps réel, écarts identifiés automatiquement.",             category:"STOCK",       color:"#9C27B0", bg:"#2a003f", icon:"📊", anchor:"stocks",            badge:"Stock mis à jour",          badgeIcon:"📊" },
    { title:"Inventaire mobile",     claim:"Inventaires depuis smartphone — scan rapide, zéro erreur.",            category:"MOBILE",      color:"#4CAF50", bg:"#1b3a1b", icon:"📱", anchor:"inventaire-mobile", badge:"Inventaire synchronisé",    badgeIcon:"📱" },
    { title:"Scan intelligent",      claim:"Saisie des livraisons par reconnaissance assistée.",                   category:"SAISIE IA",   color:"#26C6DA", bg:"#00363f", icon:"🔍", anchor:"scan-ia",           badge:"Livraison scannée",         badgeIcon:"🔍" },
    { title:"Achats groupés",        claim:"Regroupez commandes, optimisez achats et réduisez coûts.",             category:"ACHATS",      color:"#FFC107", bg:"#3d2900", icon:"🛒", anchor:"achats-groupes",    badge:"Commande groupée",          badgeIcon:"🛒" },
    { title:"Application mobile",    claim:"Ventes, activité et indicateurs — partout, en temps réel.",            category:"MOBILITÉ",    color:"#FF7043", bg:"#3e0f00", icon:"📲", anchor:"app-mobile",        badge:"Ventes en temps réel",      badgeIcon:"📲" },
    { title:"Innovation continue",   claim:"Nouvelles fonctionnalités déployées régulièrement, incluses.",         category:"MISE À JOUR", color:"#4CAF50", bg:"#0a2e0a", icon:"🚀", anchor:"innovation",        badge:"Nouvelle fonctionnalité",   badgeIcon:"🚀" },
  ];

  const FEATURES_AR = [
    { title:"ترحيل مُبسَّط",       claim:"انتقال سلس إلى بلينك — بدون أي فقدان للبيانات.",                      category:"لوجستيك",    color:"#3F51B5", bg:"#1a237e", icon:"📦", anchor:"migration",        badge:"تم استيراد البيانات",       badgeIcon:"📦" },
    { title:"سهولة الاستخدام",      claim:"واجهة بديهية — فريقك جاهز للعمل من اليوم الأول.",                   category:"الواجهة",    color:"#26C6DA", bg:"#004d5e", icon:"⚡", anchor:"prise-en-main",    badge:"اكتمل التدريب",             badgeIcon:"⚡" },
    { title:"مراقبة المخزون",       claim:"مخزون في الوقت الفعلي، مع رصد تلقائي للانحرافات.",                  category:"المخزون",    color:"#9C27B0", bg:"#2a003f", icon:"📊", anchor:"stocks",            badge:"تم تحديث المخزون",          badgeIcon:"📊" },
    { title:"الجرد عبر الجوال",     claim:"جرد المخزون من هاتفك — مسح سريع بدون أخطاء.",                       category:"الجوال",     color:"#4CAF50", bg:"#1b3a1b", icon:"📱", anchor:"inventaire-mobile", badge:"تمت مزامنة الجرد",          badgeIcon:"📱" },
    { title:"المسح الذكي",          claim:"إدخال التسليمات بالذكاء الاصطناعي — دقة عالية.",                    category:"الذكاء الاصطناعي", color:"#26C6DA", bg:"#00363f", icon:"🔍", anchor:"scan-ia",      badge:"تم مسح التسليم",            badgeIcon:"🔍" },
    { title:"المشتريات الجماعية",   claim:"اجمع الطلبات، حسّن المشتريات وخفّض التكاليف.",                     category:"المشتريات",  color:"#FFC107", bg:"#3d2900", icon:"🛒", anchor:"achats-groupes",    badge:"طلب جماعي منجز",            badgeIcon:"🛒" },
    { title:"التطبيق المحمول",      claim:"المبيعات والنشاط والمؤشرات — في كل مكان وفي الوقت الفعلي.",         category:"التنقل",     color:"#FF7043", bg:"#3e0f00", icon:"📲", anchor:"app-mobile",        badge:"مبيعات في الوقت الفعلي",    badgeIcon:"📲" },
    { title:"الابتكار المستمر",     claim:"ميزات جديدة تُنشر بانتظام، مضمّنة في الاشتراك.",                    category:"التحديثات",  color:"#4CAF50", bg:"#0a2e0a", icon:"🚀", anchor:"innovation",        badge:"ميزة جديدة",                 badgeIcon:"🚀" },
  ];

  const FEATURES_ES = [
    { title:"Migración simplificada", claim:"Transición sin fricciones a Blink — cero pérdida de datos.",         category:"LOGÍSTICA",   color:"#3F51B5", bg:"#1a237e", icon:"📦", anchor:"migration",        badge:"Datos importados",          badgeIcon:"📦" },
    { title:"Uso intuitivo",          claim:"Interfaz intuitiva — tu equipo operativo desde el día 1.",            category:"INTERFAZ",    color:"#26C6DA", bg:"#004d5e", icon:"⚡", anchor:"prise-en-main",    badge:"Formación completada",      badgeIcon:"⚡" },
    { title:"Control de inventario",  claim:"Stock en tiempo real, desviaciones identificadas automáticamente.",   category:"STOCK",       color:"#9C27B0", bg:"#2a003f", icon:"📊", anchor:"stocks",            badge:"Stock actualizado",         badgeIcon:"📊" },
    { title:"Inventario móvil",       claim:"Inventarios desde smartphone — escaneo rápido, cero errores.",        category:"MÓVIL",       color:"#4CAF50", bg:"#1b3a1b", icon:"📱", anchor:"inventaire-mobile", badge:"Inventario sincronizado",   badgeIcon:"📱" },
    { title:"Escaneo inteligente",    claim:"Entrada de entregas por reconocimiento asistido por IA.",             category:"IA",          color:"#26C6DA", bg:"#00363f", icon:"🔍", anchor:"scan-ia",           badge:"Entrega escaneada",         badgeIcon:"🔍" },
    { title:"Compras grupales",       claim:"Agrupa pedidos, optimiza compras y reduce costes fácilmente.",        category:"COMPRAS",     color:"#FFC107", bg:"#3d2900", icon:"🛒", anchor:"achats-groupes",    badge:"Pedido grupal",             badgeIcon:"🛒" },
    { title:"Aplicación móvil",       claim:"Ventas, actividad e indicadores — en cualquier lugar, tiempo real.",  category:"MOVILIDAD",   color:"#FF7043", bg:"#3e0f00", icon:"📲", anchor:"app-mobile",        badge:"Ventas en tiempo real",     badgeIcon:"📲" },
    { title:"Innovación continua",    claim:"Nuevas funcionalidades desplegadas regularmente, incluidas.",          category:"ACTUALIZ.",   color:"#4CAF50", bg:"#0a2e0a", icon:"🚀", anchor:"innovation",        badge:"Nueva funcionalidad",       badgeIcon:"🚀" },
  ];

  const FEATURES_RU = [
    { title:"Упрощённая миграция",   claim:"Переход на Blink без потери данных — быстро и надёжно.",              category:"ЛОГИСТИКА",   color:"#3F51B5", bg:"#1a237e", icon:"📦", anchor:"migration",        badge:"Данные импортированы",      badgeIcon:"📦" },
    { title:"Лёгкое освоение",       claim:"Интуитивный интерфейс — ваша команда готова с первого дня.",          category:"ИНТЕРФЕЙС",   color:"#26C6DA", bg:"#004d5e", icon:"⚡", anchor:"prise-en-main",    badge:"Обучение завершено",        badgeIcon:"⚡" },
    { title:"Контроль запасов",      claim:"Склад в реальном времени, отклонения выявляются автоматически.",      category:"СКЛАД",       color:"#9C27B0", bg:"#2a003f", icon:"📊", anchor:"stocks",            badge:"Склад обновлён",            badgeIcon:"📊" },
    { title:"Мобильная инвентаризация", claim:"Инвентаризация со смартфона — быстро, без ошибок.",               category:"МОБИЛЬНО",    color:"#4CAF50", bg:"#1b3a1b", icon:"📱", anchor:"inventaire-mobile", badge:"Инвентарь синхронизирован", badgeIcon:"📱" },
    { title:"Умное сканирование",    claim:"Ввод поставок с помощью ИИ-распознавания — минимум ошибок.",         category:"ИИ",          color:"#26C6DA", bg:"#00363f", icon:"🔍", anchor:"scan-ia",           badge:"Поставка отсканирована",    badgeIcon:"🔍" },
    { title:"Групповые закупки",     claim:"Объедините заказы, оптимизируйте закупки и снизьте затраты.",        category:"ЗАКУПКИ",     color:"#FFC107", bg:"#3d2900", icon:"🛒", anchor:"achats-groupes",    badge:"Групповой заказ",           badgeIcon:"🛒" },
    { title:"Мобильное приложение",  claim:"Продажи, активность и показатели — везде в реальном времени.",       category:"МОБИЛЬНОСТЬ", color:"#FF7043", bg:"#3e0f00", icon:"📲", anchor:"app-mobile",        badge:"Продажи в реальном времени",badgeIcon:"📲" },
    { title:"Непрерывные инновации", claim:"Новые функции выпускаются регулярно, включены в тариф.",             category:"ОБНОВЛЕНИЯ",  color:"#4CAF50", bg:"#0a2e0a", icon:"🚀", anchor:"innovation",        badge:"Новая функция",             badgeIcon:"🚀" },
  ];

  // ─── MODULES per language ────────────────────────────────────────────────
  const MOD = {
    fr: ["Accueil","Mes ventes","Commandes remisées","Bons de commande","Mes produits","Mes avoirs","Mon stock","Mes confrères","Mes clients","Ma caisse","Mes fournisseurs","Mes rapports","Réglages"],
    ar: ["الرئيسية","مبيعاتي","الطلبات المخصومة","أوامر الشراء","منتجاتي","أرصدتي","مخزوني","زملائي","عملائي","صندوقي","مورّدوني","تقاريري","الإعدادات"],
    es: ["Inicio","Mis ventas","Pedidos con descuento","Órdenes de compra","Mis productos","Mis abonos","Mi stock","Mis colegas","Mis clientes","Mi caja","Mis proveedores","Mis informes","Ajustes"],
    ru: ["Главная","Мои продажи","Заказы со скидкой","Заявки на закупку","Мои товары","Мои возвраты","Мой склад","Мои коллеги","Мои клиенты","Моя касса","Мои поставщики","Мои отчёты","Настройки"],
  };

  const MOD_COLORS = ["#3F51B5","#26C6DA","#9C27B0","#FF7043","#26C6DA","#EF5350","#9C27B0","#FFC107","#3F51B5","#4CAF50","#FFC107","#3F51B5","#94A3B8"];
  const MOD_ICONS  = ["🏠","💊","🏷️","📋","🧪","↩️","📦","🤝","👤","💰","🚚","📈","⚙️"];

  // ─── UI STRINGS ──────────────────────────────────────────────────────────
  const UI = {
    fr: {
      nav_home:"Accueil", nav_features:"Fonctionnalités", nav_contact:"Contact", nav_cta:"Demander une démo",
      hero_badge:"Nouveau · Blink Premium 2025",
      hero_h1a:"La gestion de votre pharmacie,", hero_h1b:"réinventée.",
      hero_sub:"Blink Premium modernise chaque aspect de votre quotidien, de la vente au stock, en passant par vos fournisseurs.",
      hero_cta1:"Demander une démo", hero_cta2:"Voir les fonctionnalités",
      stat1:"Modules intégrés", stat2:"Cloud & mobile", stat3v:"Maroc", stat3:"Conçu localement",
      badge_time:"Il y a 2 minutes",
      feat_label:"Fonctionnalités", feat_h2:"Tout ce dont votre pharmacie a besoin",
      feat_p:"Huit modules clés pour piloter votre activité avec précision et simplicité.",
      feat_link:"Découvrir →",
      mod_label:"Modules de l'application", mod_h2:"Une solution complète, module par module",
      mod_p:"Naviguez entre les espaces de gestion depuis une interface claire et cohérente.",
      cta_label:"Rejoignez Blink Premium", cta_h2:"Prêt à moderniser votre pharmacie ?",
      cta_p:"Rejoignez les pharmaciens qui font confiance à Blink Premium.", cta_btn:"Demander une démo gratuite",
      // premium page
      prem_label:"8 fonctionnalités clés", prem_h1:"Tout ce que Blink Premium vous offre",
      prem_sub:"De la migration initiale à l'innovation continue — découvrez comment Blink transforme votre quotidien.",
      prem_cta_label:"Passez à l'action", prem_cta_h2:"Prêt à moderniser votre pharmacie ?",
      prem_cta_p:"Rejoignez les pharmaciens qui font confiance à Blink Premium.",
      feat_btn1:"Demander une démo", feat_btn2:"En savoir plus →",
      // contact page
      cont_label:"Démo gratuite", cont_h1:"Parlons de votre pharmacie",
      cont_p:"Remplissez le formulaire ci-dessous. Un conseiller Blink vous contacte sous 24h pour organiser une démonstration personnalisée.",
      form_h2:"Demander une démo", form_sub:"Gratuit, sans engagement. Durée estimée : 30 minutes.",
      f_nom:"Nom complet", f_pharmacie:"Nom de la pharmacie", f_tel:"Téléphone (WhatsApp)", f_ville:"Ville",
      f_logiciel:"Logiciel actuel", f_log_ph:"Sélectionner un logiciel", f_autre:"Autre",
      f_message:"Message (optionnel)", f_msg_ph:"Décrivez vos besoins ou posez vos questions…",
      f_submit:"Envoyer ma demande de démo",
      f_submit_loading:"Envoi en cours...",
      f_disclaimer:"🔒 Vos données sont confidentielles et ne seront jamais partagées avec des tiers.",
      f_ok_h3:"Demande envoyée !", f_ok_p:"Merci ! Un conseiller Blink vous contactera dans les 24 heures pour organiser votre démo personnalisée.",
      f_ok_link:"Découvrir les fonctionnalités →",
      f_err_required:"Merci de remplir les champs obligatoires.",
      f_err_phone:"Merci de saisir un numero WhatsApp valide.",
      f_err_generic:"L'envoi a echoue. Merci de reessayer dans quelques instants.",
      f_err_unavailable:"Le formulaire est temporairement indisponible. Merci de nous ecrire a contact@blinkpharma.ma.",
      f_err_rate:"Trop de tentatives. Merci de patienter une minute avant de recommencer.",
      ri1s:"Réponse rapide", ri1p:"Sous 24h ouvrées", ri2s:"Sur mesure", ri2p:"Démo personnalisée",
      ri3s:"Local", ri3p:"Équipe au Maroc", ri4s:"Gratuit", ri4p:"Sans engagement",
      info_h3:"Contactez-nous directement", wa_btn:"Écrire sur WhatsApp",
      demo_h3:"Inclus dans votre démo",
      demo_items:["Présentation complète des modules","Analyse de vos besoins spécifiques","Simulation de migration depuis votre logiciel","Devis personnalisé sans engagement"],
      // footer
      footer_desc:"La solution SaaS de gestion de pharmacie pensée pour les pharmaciens marocains. Moderne, intuitive et fiable.",
      footer_nav:"Navigation", footer_feat:"Fonctionnalités", footer_contact:"Contact",
      footer_rights:"© 2026 Blink Pharma · Tous droits réservés",
      footer_privacy:"Politique de confidentialité", footer_cgu:"CGU",
      dir:"ltr",
    },
    ar: {
      nav_home:"الرئيسية", nav_features:"الميزات", nav_contact:"اتصل بنا", nav_cta:"طلب عرض توضيحي",
      hero_badge:"جديد · بلينك بريميوم 2025",
      hero_h1a:"إدارة صيدليتك،", hero_h1b:"بشكل مُعاد ابتكاره.",
      hero_sub:"بلينك بريميوم يُحدّث كل جانب من جوانب يومك، من المبيعات إلى المخزون ومورديك.",
      hero_cta1:"طلب عرض توضيحي", hero_cta2:"اكتشف الميزات",
      stat1:"وحدات مدمجة", stat2:"سحابي وجوال", stat3v:"المغرب", stat3:"مصمم محلياً",
      badge_time:"منذ دقيقتين",
      feat_label:"الميزات", feat_h2:"كل ما تحتاجه صيدليتك",
      feat_p:"ثمانية وحدات رئيسية لإدارة نشاطك بدقة وسهولة.",
      feat_link:"اكتشف →",
      mod_label:"وحدات التطبيق", mod_h2:"حل متكامل، وحدة بوحدة",
      mod_p:"تنقّل بين مساحات الإدارة من خلال واجهة واضحة ومتناسقة.",
      cta_label:"انضم إلى بلينك بريميوم", cta_h2:"هل أنت مستعد لتحديث صيدليتك؟",
      cta_p:"انضم إلى الصيادلة الذين يثقون في بلينك بريميوم.", cta_btn:"طلب عرض توضيحي مجاني",
      prem_label:"8 ميزات رئيسية", prem_h1:"كل ما يقدمه بلينك بريميوم",
      prem_sub:"من الترحيل الأولي إلى الابتكار المستمر — اكتشف كيف يُحوّل بلينك يومك.",
      prem_cta_label:"ابدأ الآن", prem_cta_h2:"هل أنت مستعد لتحديث صيدليتك؟",
      prem_cta_p:"انضم إلى الصيادلة الذين يثقون في بلينك بريميوم.",
      feat_btn1:"طلب عرض توضيحي", feat_btn2:"معرفة المزيد →",
      cont_label:"عرض توضيحي مجاني", cont_h1:"لنتحدث عن صيدليتك",
      cont_p:"املأ النموذج أدناه. سيتواصل معك مستشار بلينك خلال 24 ساعة لترتيب عرض توضيحي مخصص.",
      form_h2:"طلب عرض توضيحي", form_sub:"مجاني، بدون التزام. المدة المقدرة: 30 دقيقة.",
      f_nom:"الاسم الكامل", f_pharmacie:"اسم الصيدلية", f_tel:"الهاتف (واتساب)", f_ville:"المدينة",
      f_logiciel:"البرنامج الحالي", f_log_ph:"اختر برنامجاً", f_autre:"أخرى",
      f_message:"رسالة (اختياري)", f_msg_ph:"صف احتياجاتك أو اطرح أسئلتك…",
      f_submit:"إرسال طلب العرض التوضيحي",
      f_submit_loading:"جارٍ إرسال الطلب...",
      f_disclaimer:"🔒 بياناتك سرية ولن تُشارك مع أي طرف ثالث.",
      f_ok_h3:"تم إرسال الطلب!", f_ok_p:"شكراً! سيتواصل معك مستشار بلينك خلال 24 ساعة.",
      f_ok_link:"اكتشف الميزات →",
      f_err_required:"يرجى ملء الحقول الإلزامية.",
      f_err_phone:"يرجى إدخال رقم واتساب صحيح.",
      f_err_generic:"تعذر إرسال الطلب حالياً. يرجى المحاولة مرة أخرى بعد قليل.",
      f_err_unavailable:"النموذج غير متاح مؤقتاً. يرجى مراسلتنا على contact@blinkpharma.ma.",
      f_err_rate:"تم إرسال عدد كبير من الطلبات. يرجى الانتظار دقيقة ثم المحاولة مجدداً.",
      ri1s:"رد سريع", ri1p:"خلال 24 ساعة", ri2s:"مخصص", ri2p:"عرض شخصي",
      ri3s:"محلي", ri3p:"فريق بالمغرب", ri4s:"مجاني", ri4p:"بدون التزام",
      info_h3:"تواصل معنا مباشرة", wa_btn:"الكتابة عبر واتساب",
      demo_h3:"ما يتضمنه عرضك التوضيحي",
      demo_items:["عرض كامل للوحدات","تحليل احتياجاتك الخاصة","محاكاة الترحيل من برنامجك الحالي","عرض سعر مخصص بدون التزام"],
      footer_desc:"حل SaaS لإدارة الصيدليات مصمم للصيادلة المغاربة. حديث وبديهي وموثوق.",
      footer_nav:"التنقل", footer_feat:"الميزات", footer_contact:"اتصل بنا",
      footer_rights:"© 2026 بلينك فارما · جميع الحقوق محفوظة",
      footer_privacy:"سياسة الخصوصية", footer_cgu:"شروط الاستخدام",
      dir:"rtl",
    },
    es: {
      nav_home:"Inicio", nav_features:"Funcionalidades", nav_contact:"Contacto", nav_cta:"Solicitar una demo",
      hero_badge:"Nuevo · Blink Premium 2025",
      hero_h1a:"La gestión de tu farmacia,", hero_h1b:"reinventada.",
      hero_sub:"Blink Premium moderniza cada aspecto de tu día a día, desde las ventas hasta el stock y tus proveedores.",
      hero_cta1:"Solicitar una demo", hero_cta2:"Ver funcionalidades",
      stat1:"Módulos integrados", stat2:"Cloud & móvil", stat3v:"Marruecos", stat3:"Diseñado localmente",
      badge_time:"Hace 2 minutos",
      feat_label:"Funcionalidades", feat_h2:"Todo lo que tu farmacia necesita",
      feat_p:"Ocho módulos clave para gestionar tu actividad con precisión y simplicidad.",
      feat_link:"Descubrir →",
      mod_label:"Módulos de la aplicación", mod_h2:"Una solución completa, módulo a módulo",
      mod_p:"Navega entre los espacios de gestión desde una interfaz clara y coherente.",
      cta_label:"Únete a Blink Premium", cta_h2:"¿Listo para modernizar tu farmacia?",
      cta_p:"Únete a los farmacéuticos que confían en Blink Premium.", cta_btn:"Solicitar una demo gratuita",
      prem_label:"8 funcionalidades clave", prem_h1:"Todo lo que Blink Premium te ofrece",
      prem_sub:"Desde la migración inicial hasta la innovación continua — descubre cómo Blink transforma tu día a día.",
      prem_cta_label:"Pasa a la acción", prem_cta_h2:"¿Listo para modernizar tu farmacia?",
      prem_cta_p:"Únete a los farmacéuticos que confían en Blink Premium.",
      feat_btn1:"Solicitar una demo", feat_btn2:"Saber más →",
      cont_label:"Demo gratuita", cont_h1:"Hablemos de tu farmacia",
      cont_p:"Rellena el formulario. Un asesor de Blink te contactará en 24h para organizar una demostración personalizada.",
      form_h2:"Solicitar una demo", form_sub:"Gratuito, sin compromiso. Duración estimada: 30 minutos.",
      f_nom:"Nombre completo", f_pharmacie:"Nombre de la farmacia", f_tel:"Teléfono (WhatsApp)", f_ville:"Ciudad",
      f_logiciel:"Software actual", f_log_ph:"Seleccionar un software", f_autre:"Otro",
      f_message:"Mensaje (opcional)", f_msg_ph:"Describe tus necesidades o haz tus preguntas…",
      f_submit:"Enviar mi solicitud de demo",
      f_submit_loading:"Enviando solicitud...",
      f_disclaimer:"🔒 Tus datos son confidenciales y nunca serán compartidos con terceros.",
      f_ok_h3:"¡Solicitud enviada!", f_ok_p:"¡Gracias! Un asesor de Blink te contactará en las próximas 24 horas.",
      f_ok_link:"Descubrir funcionalidades →",
      f_err_required:"Por favor, completa los campos obligatorios.",
      f_err_phone:"Por favor, introduce un numero de WhatsApp valido.",
      f_err_generic:"No se pudo enviar la solicitud. Intentalo de nuevo en unos instantes.",
      f_err_unavailable:"El formulario no esta disponible temporalmente. Escribenos a contact@blinkpharma.ma.",
      f_err_rate:"Has enviado demasiadas solicitudes. Espera un minuto antes de volver a intentarlo.",
      ri1s:"Respuesta rápida", ri1p:"En 24h laborables", ri2s:"A medida", ri2p:"Demo personalizada",
      ri3s:"Local", ri3p:"Equipo en Marruecos", ri4s:"Gratuito", ri4p:"Sin compromiso",
      info_h3:"Contáctanos directamente", wa_btn:"Escribir por WhatsApp",
      demo_h3:"Incluido en tu demo",
      demo_items:["Presentación completa de los módulos","Análisis de tus necesidades específicas","Simulación de migración desde tu software","Presupuesto personalizado sin compromiso"],
      footer_desc:"La solución SaaS de gestión de farmacias pensada para farmacéuticos marroquíes. Moderna, intuitiva y fiable.",
      footer_nav:"Navegación", footer_feat:"Funcionalidades", footer_contact:"Contacto",
      footer_rights:"© 2026 Blink Pharma · Todos los derechos reservados",
      footer_privacy:"Política de privacidad", footer_cgu:"CGU",
      dir:"ltr",
    },
    ru: {
      nav_home:"Главная", nav_features:"Функции", nav_contact:"Контакты", nav_cta:"Запросить демо",
      hero_badge:"Новинка · Blink Premium 2025",
      hero_h1a:"Управление вашей аптекой,", hero_h1b:"переосмысленное.",
      hero_sub:"Blink Premium модернизирует каждый аспект вашего рабочего дня: от продаж до склада и поставщиков.",
      hero_cta1:"Запросить демо", hero_cta2:"Посмотреть функции",
      stat1:"Встроенных модулей", stat2:"Облако и мобайл", stat3v:"Марокко", stat3:"Разработано локально",
      badge_time:"2 минуты назад",
      feat_label:"Функции", feat_h2:"Всё, что нужно вашей аптеке",
      feat_p:"Восемь ключевых модулей для управления бизнесом с точностью и простотой.",
      feat_link:"Подробнее →",
      mod_label:"Модули приложения", mod_h2:"Комплексное решение, модуль за модулем",
      mod_p:"Переключайтесь между рабочими пространствами через чёткий и последовательный интерфейс.",
      cta_label:"Присоединяйтесь к Blink Premium", cta_h2:"Готовы модернизировать вашу аптеку?",
      cta_p:"Присоединяйтесь к фармацевтам, доверяющим Blink Premium.", cta_btn:"Запросить бесплатное демо",
      prem_label:"8 ключевых функций", prem_h1:"Всё, что предлагает Blink Premium",
      prem_sub:"От первичной миграции до непрерывных инноваций — узнайте, как Blink меняет ваш рабочий день.",
      prem_cta_label:"Начать", prem_cta_h2:"Готовы модернизировать вашу аптеку?",
      prem_cta_p:"Присоединяйтесь к фармацевтам, доверяющим Blink Premium.",
      feat_btn1:"Запросить демо", feat_btn2:"Узнать больше →",
      cont_label:"Бесплатное демо", cont_h1:"Поговорим о вашей аптеке",
      cont_p:"Заполните форму ниже. Консультант Blink свяжется с вами в течение 24 часов.",
      form_h2:"Запросить демо", form_sub:"Бесплатно, без обязательств. Примерная продолжительность: 30 минут.",
      f_nom:"Полное имя", f_pharmacie:"Название аптеки", f_tel:"Телефон (WhatsApp)", f_ville:"Город",
      f_logiciel:"Текущее ПО", f_log_ph:"Выберите ПО", f_autre:"Другое",
      f_message:"Сообщение (необязательно)", f_msg_ph:"Опишите ваши потребности или задайте вопросы…",
      f_submit:"Отправить запрос на демо",
      f_submit_loading:"Отправка запроса...",
      f_disclaimer:"🔒 Ваши данные конфиденциальны и никогда не будут переданы третьим лицам.",
      f_ok_h3:"Запрос отправлен!", f_ok_p:"Спасибо! Консультант Blink свяжется с вами в течение 24 часов.",
      f_ok_link:"Посмотреть функции →",
      f_err_required:"Пожалуйста, заполните обязательные поля.",
      f_err_phone:"Пожалуйста, введите корректный номер WhatsApp.",
      f_err_generic:"Не удалось отправить заявку. Попробуйте еще раз чуть позже.",
      f_err_unavailable:"Форма временно недоступна. Напишите нам на contact@blinkpharma.ma.",
      f_err_rate:"Слишком много попыток. Подождите одну минуту и попробуйте снова.",
      ri1s:"Быстрый ответ", ri1p:"В течение 24 часов", ri2s:"Индивидуально", ri2p:"Персональное демо",
      ri3s:"Локально", ri3p:"Команда в Марокко", ri4s:"Бесплатно", ri4p:"Без обязательств",
      info_h3:"Свяжитесь с нами напрямую", wa_btn:"Написать в WhatsApp",
      demo_h3:"Включено в ваше демо",
      demo_items:["Полная презентация модулей","Анализ ваших конкретных потребностей","Симуляция миграции из вашего ПО","Персональное предложение без обязательств"],
      footer_desc:"SaaS-решение для управления аптеками, разработанное для марокканских фармацевтов. Современное, интуитивное и надёжное.",
      footer_nav:"Навигация", footer_feat:"Функции", footer_contact:"Контакты",
      footer_rights:"© 2026 Blink Pharma · Все права защищены",
      footer_privacy:"Политика конфиденциальности", footer_cgu:"Условия использования",
      dir:"ltr",
    },
  };

  const featMap = { fr: FEATURES_FR, ar: FEATURES_AR, es: FEATURES_ES, ru: FEATURES_RU };

  window.BI18N = {
    lang,
    t: UI[lang],
    features: featMap[lang],
    modules: MOD[lang].map((name, i) => ({ name, color: MOD_COLORS[i], icon: MOD_ICONS[i] })),
    langUrl(targetLang, keepHash) {
      const u = new URL(window.location.href);
      u.searchParams.set('lang', targetLang);
      return u.toString();
    },
  };

  // Apply RTL
  if (UI[lang].dir === 'rtl') {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', lang);
  } else {
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }
})();
