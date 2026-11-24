-- 0158 — the media buyer's brain (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-buyer-brain.md decisions 4 and 5).
-- (1) The research brief on a competitor: ai-content `competitor_brief` writes mkt_competitors.brief ({ text, sources: [{ url, title }] })
--     and brief_at with the server's key; a member reads them with the row (select of 0109) and never writes them — the members'
--     insert / update grants of 0109 name their columns, these two are not among them.
-- (2) The media buyer's skills, written in our own words (summaries of well-known practice — Ben Heath / Heath Media, Meta's own
--     guidance, the creative-testing schools; not copied text): rows of ai_agent_kb (0120) for the buyer, added once — a skill with the
--     same title is left as the admin has it, and the admin edits or deletes them from «الإعدادات › الذكاء الاصطناعي» like any other.
-- Re-runnable.

alter table public.mkt_competitors add column if not exists brief jsonb
  check (brief is null or (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 16000));
alter table public.mkt_competitors add column if not exists brief_at timestamptz;

do $$
declare
  v_items jsonb := $j$[
    ["هيكلة الحملات", "حساب بسيط مجمّع", "ميتا بتتعلّم أحسن لما الحساب بسيط: حملات قليلة (حملة مبيعات أساسية + حملة لاختبار الكريتيف)، واستهداف واسع أو Advantage+ بدل تقسيم الجمهور لحتت صغيرة، وميزانية متجمّعة كفاية إن كل مجموعة توصل لعدد كافي من الأوردرات في الأسبوع. التقسيم الكتير بيفرّق الداتا وبيطوّل التعلّم. (طريقة Ben Heath / Heath Media وإرشادات ميتا)"],
    ["هيكلة الحملات", "التعلّم والتعديلات", "المجموعة الإعلانية بتخرج من مرحلة التعلّم لما تجيب حوالي 50 نتيجة في 7 أيام (الرقم ده بتاع ميتا وممكن يتغيّر). أي تعديل كبير — الاستهداف، حدث التحسين، كريتيف جديد، أو ميزانية بفرق كبير — بيرجّعها للتعلّم. متحكمش على حملة في أول 3 لـ 5 أيام ومتعدّلهاش كل يوم. لو مش هتوصل للعدد ده، جمّع المجموعات أو كبّر الميزانية."],
    ["التكبير والإيقاف", "إمتى أكبّر وإمتى أوقف", "زوّد الميزانية على مراحل (حوالي 20% كل يومين أو تلاتة) للحملة اللي عائدها الحقيقي فوق الهدف بثبات، أو كرّر الفايز في حملة جديدة بميزانية أكبر. اللي صرف ضعفين لتلات أضعاف تكلفة الأوردر المستهدفة من غير بيع يتوقف أو يتغيّر كريتيفه. القرار بالأرقام الحقيقية مش بالإحساس، والإيقاف أو التكبير بموافقة الأدمن."],
    ["الكريتيف", "اختبار الكريتيف", "الكريتيف هو أكبر رافعة في الأداء دلوقتي. اختبر أفكار مختلفة فعلًا (زاوية تانية، شكل تاني: فيديو / صورة / كاروسيل، هوك تاني) مش ألوان مختلفة لنفس الفكرة. طريقة 3:2:2 المشهورة (Charley Tichenor): 3 كريتيفز × 2 نص أساسي × 2 عنوان في Dynamic Creative. وبعد تحديث Andromeda عند ميتا (2025) الاتجاه بقى تنويع مفاهيم أكتر في نفس الوقت عشان ميتا تلاقي لكل شريحة الإعلان اللي يناسبها."],
    ["الكريتيف", "الكريتيف اللي بيبيع", "أول 3 ثواني هي كل حاجة: هوك واضح (مشكلة، نتيجة، فضول). اعرض المنتج في استخدامه الحقيقي، وكلام العميل (UGC) كتير بيكسب الإعلان المصقول. الفيديو الرأسي 9:16 للريلز والستوري و4:5 للفيد. الرسالة الأساسية مكتوبة على الفيديو لأن ناس كتير بتتفرج من غير صوت. في الهاند ميد: الإيد وهي بتشتغل، التفاصيل، والقطعة في البيت."],
    ["قراءة الأرقام", "العائد الحقيقي قبل أرقام ميتا", "احكم بالعائد الحقيقي (مبيعات الموقع ÷ الصرف) وتكلفة الأوردر الحقيقية، ومشتريات ميتا رقم تاني جنبهم مش بدلهم — ميتا غالبًا بتعد أكتر. علامات الزهق: التكرار فوق 4 أو الـ CTR بينزل والـ CPM بيطلع — الحل نسخ جديدة مش تكبير. CTR واطي مع CPC عالي = مشكلة في الكريتيف غالبًا مش الاستهداف."],
    ["قراءة الأرقام", "التتبع", "حط utm_campaign={{campaign.id}} وutm_content={{ad.id}} على كل الإعلانات عشان السيستم يربط كل أوردر بالحملة والإعلان اللي جابه ويرتّب الكريتيفز بأوردرات الموقع نفسها. اتأكد إن البيكسل والـ Conversions API شغّالين (فحص البيكسل تحت الشات)."],
    ["المنافسين", "أقوى إعلانات المنافس", "أقوى إعلان عند المنافس غالبًا اللي شغّال بقاله أطول مدة وعامل منه نسخ كتير، لأن اللي بيخسر بيتقفل بسرعة. افتح مكتبة إعلانات ميتا للمنافس، شوف الإعلانات اللي بقالها أكتر من شهر، واكتبها في ملاحظة المنافس عشان الميديا باير يقراها. خد الزاوية والعرض، مش التصميم نفسه."]
  ]$j$;
  v_it jsonb; v_i int := 0;
begin
  if to_regclass('public.ai_agent_kb') is null then return; end if;
  for v_it in select * from jsonb_array_elements(v_items) loop
    v_i := v_i + 1;
    if not exists (select 1 from public.ai_agent_kb where kind = 'skills' and title = v_it->>1) then
      insert into public.ai_agent_kb (kind, section, title, body, agents, sort)
      values ('skills', v_it->>0, v_it->>1, v_it->>2, array['buyer'], 500 + v_i);
    end if;
  end loop;
end $$;
