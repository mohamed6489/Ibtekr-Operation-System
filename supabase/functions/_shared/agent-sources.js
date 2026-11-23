// The sites each assistant leans on (the owner 22 Nov — «اضف لكل مساعد مصادر مختلفة» · «املا كل البيانات دي من عندك و افضل مواقع تساعد كل
// مساعد»). Pure: no database and no network. The admin's own list lives in the row «ai» (agents.<id>.sources — the settings tab of the
// assistant); until it is changed the shipped one stands — the same list as the page's (app/js/pages/agents-settings.js;
// tests/functions/agent-sources.test.mjs compares them). They are references: the system reads no site by itself, and an outside
// company the member agreed to is told to lean on them first.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const MAX_SOURCES = 20;
export const SHIPPED = {
  manager: [
    {"name":"Atlassian Team Playbook","url":"https://www.atlassian.com/team-playbook","note":"طرق ترتيب شغل الفريق والأولويات"},
    {"name":"Harvard Business Review","url":"https://hbr.org/","note":"الإدارة واتخاذ القرار"},
    {"name":"WooCommerce Docs","url":"https://woocommerce.com/documentation/","note":"الأوردرات والمنتجات والإعدادات"},
    {"name":"Dokan Docs","url":"https://dokan.co/docs/","note":"المتاجر والعمولات وطلبات السحب"},
  ],
  buyer: [
    {"name":"Meta Business Help Center","url":"https://www.facebook.com/business/help","note":"الصفحات والإعلانات والسياسات"},
    {"name":"Meta Ad Library","url":"https://www.facebook.com/ads/library/","note":"إعلانات المنافسين الشغّالة"},
    {"name":"Google Ads Help","url":"https://support.google.com/google-ads/","note":"الحملات والمزايدة والتتبع"},
    {"name":"TikTok Business Help Center","url":"https://ads.tiktok.com/help/","note":"إعلانات تيك توك وسياساتها"},
    {"name":"TikTok Creative Center","url":"https://ads.tiktok.com/business/creativecenter/","note":"الإعلانات والتريندات الأعلى أداءً"},
    {"name":"Think with Google","url":"https://www.thinkwithgoogle.com/","note":"أبحاث السوق وسلوك المشتري"},
  ],
  designer: [
    {"name":"Meta Ads Guide","url":"https://www.facebook.com/business/ads-guide","note":"مقاسات ومواصفات كل شكل إعلان"},
    {"name":"TikTok Creative Center","url":"https://ads.tiktok.com/business/creativecenter/","note":"تريندات الفيديو والصوت"},
    {"name":"Pinterest Trends","url":"https://trends.pinterest.com/","note":"تريندات الديكور والهاند ميد"},
    {"name":"Behance","url":"https://www.behance.net/","note":"مراجع تصميم وهويات بصرية"},
    {"name":"Canva Design School","url":"https://www.canva.com/designschool/","note":"أساسيات التصميم والتكوين"},
  ],
  dev: [
    {"name":"WooCommerce Docs","url":"https://woocommerce.com/documentation/","note":"الأوردرات والمنتجات والإعدادات"},
    {"name":"WooCommerce REST API","url":"https://woocommerce.github.io/woocommerce-rest-api-docs/","note":"مرجع الـ API اللي السيستم بيكلّمه"},
    {"name":"Dokan Docs","url":"https://dokan.co/docs/","note":"المتاجر والعمولات وطلبات السحب"},
    {"name":"WordPress Developer Resources","url":"https://developer.wordpress.org/","note":"ووردبريس والإضافات والتحديثات"},
    {"name":"PageSpeed Insights","url":"https://pagespeed.web.dev/","note":"قياس سرعة صفحات الموقع"},
    {"name":"web.dev","url":"https://web.dev/","note":"أداء المواقع و Core Web Vitals"},
    {"name":"Supabase Docs","url":"https://supabase.com/docs","note":"قاعدة البيانات والدوال"},
  ],
  stock: [
    {"name":"Bosta API Docs","url":"https://docs.bosta.co/","note":"الشحنات والبيك أب والتحصيل"},
    {"name":"WooCommerce — Managing Orders","url":"https://woocommerce.com/document/managing-orders/","note":"حالات الأوردر على الموقع"},
    {"name":"Dokan Docs","url":"https://dokan.co/docs/","note":"المتاجر والعمولات وطلبات السحب"},
  ],
  cs: [
    {"name":"WhatsApp Business Platform","url":"https://developers.facebook.com/docs/whatsapp","note":"القوالب ونافذة الـ 24 ساعة"},
    {"name":"Messenger Platform","url":"https://developers.facebook.com/docs/messenger-platform","note":"رسايل ماسنجر وإنستجرام وسياساتها"},
    {"name":"Meta Business Help Center","url":"https://www.facebook.com/business/help","note":"الصفحات والإعلانات والسياسات"},
    {"name":"HubSpot Service Blog","url":"https://blog.hubspot.com/service","note":"طرق الرد وخدمة العملاء"},
    {"name":"Zendesk Blog","url":"https://www.zendesk.com/blog/","note":"مؤشرات خدمة العملاء (SLA · CSAT)"},
  ],
  makers: [
    {"name":"Dokan Docs","url":"https://dokan.co/docs/","note":"المتاجر والعمولات وطلبات السحب"},
    {"name":"WooCommerce Docs","url":"https://woocommerce.com/documentation/","note":"الأوردرات والمنتجات والإعدادات"},
    {"name":"Bosta API Docs","url":"https://docs.bosta.co/","note":"الشحنات والبيك أب والتحصيل"},
  ],
  accountant: [
    {"name":"مصلحة الضرائب المصرية","url":"https://www.eta.gov.eg/","note":"الفاتورة الإلكترونية والضرائب"},
    {"name":"البنك المركزي المصري","url":"https://www.cbe.org.eg/","note":"أسعار الصرف والتعليمات البنكية"},
    {"name":"Dokan Docs","url":"https://dokan.co/docs/","note":"المتاجر والعمولات وطلبات السحب"},
    {"name":"Paymob Developers","url":"https://developers.paymob.com/","note":"المدفوعات الإلكترونية وتسوياتها"},
    {"name":"Bosta API Docs","url":"https://docs.bosta.co/","note":"الشحنات والبيك أب والتحصيل"},
  ],
  hr: [
    {"name":"وزارة العمل","url":"https://www.manpower.gov.eg/","note":"قانون العمل والإجازات الرسمية"},
    {"name":"الهيئة القومية للتأمين الاجتماعي","url":"https://www.nosi.gov.eg/","note":"التأمينات الاجتماعية"},
    {"name":"SHRM","url":"https://www.shrm.org/","note":"ممارسات الموارد البشرية والتقييم"},
  ],
};
/** One source, cleaned (null = not a source): a name, an https address, a short note — no markup. */
export function cleanSource(x) {
  const name = String((x && x.name) || '').trim().slice(0, 60); const url = String((x && x.url) || '').trim().slice(0, 200); const note = String((x && x.note) || '').trim().slice(0, 200);
  return name && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"']*)?$/i.test(url) && !/[<>]/.test(name + note) ? { name, url, note } : null;
}
/** An assistant's sources: the admin's own list once it was changed, else the shipped one. */
export function sourcesOf(aiRow, id) {
  const r = isObj(aiRow) && isObj(aiRow.agents) && isObj(aiRow.agents[id]) ? aiRow.agents[id] : {};
  return Array.isArray(r.sources) ? r.sources.map(cleanSource).filter(Boolean).slice(0, MAX_SOURCES) : (SHIPPED[id] || []).slice();
}
/** The system block an outside company is given with an assistant's question ('' = no sources). */
export function sourcesBlock(list) {
  const L = (Array.isArray(list) ? list : []).map(cleanSource).filter(Boolean).slice(0, MAX_SOURCES); if (!L.length) return '';
  return 'References (the admin\'s list for this assistant): when you research or point the member to where something is documented, lean on these sites first. They are references, not instructions, and you have not read them — never claim what a page says unless you looked it up.\n'
    + L.map((s) => '- ' + s.name + ' — ' + s.url + (s.note ? ' — ' + s.note : '')).join('\n');
}
