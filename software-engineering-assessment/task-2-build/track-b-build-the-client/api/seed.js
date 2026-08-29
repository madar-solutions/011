/** Deterministic seed data. A fixed LCG keeps every restart identical. */
let state = 42;
const rnd = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(rnd() * list.length)];

export const agents = [
  { id: 'ag_dana',  name: 'دانة العتيبي',  email: 'dana@helm.example',  username: 'dana',  password: 'ticket-desk-1' },
  { id: 'ag_omar',  name: 'عمر حدّاد',     email: 'omar@helm.example',  username: 'omar',  password: 'ticket-desk-2' },
  { id: 'ag_rana',  name: 'رنا تكريتي',    email: 'rana@helm.example',  username: 'rana',  password: 'ticket-desk-3' },
  { id: 'ag_faris', name: 'فارس المنصوري', email: 'faris@helm.example', username: 'faris', password: 'ticket-desk-4' },
  { id: 'ag_nour',  name: 'نور شاهين',     email: 'nour@helm.example',  username: 'nour',  password: 'ticket-desk-5' }
];

const SUBJECTS = [
  'تعذّر تصدير الفواتير إلى CSV', 'رموز التحقق بخطوتين تصل متأخرة', 'المبلغ المُسترد لا يظهر في كشف الحساب',
  'إعادة إرسال الـ webhook تُنتج نسخًا مكرّرة', 'الحساب الفرعي لا يرى التقارير', 'رسالة إعادة تعيين كلمة المرور لا تصل',
  'الواجهة البرمجية تُرجع خطأ 500 عند الرفع الجماعي', 'المنطقة الزمنية خاطئة في التقارير المجدولة', 'رُفضت البطاقة ومع ذلك أُنشئ الطلب',
  'لا أستطيع إزالة عضو من الفريق', 'الرسم البياني للاستهلاك فارغ منذ الثلاثاء', 'بطء في الاستجابة على تطبيق الجوال',
  'خُصم مقعد واحد مرّتين', 'النطاق المخصّص لا يجتاز التحقق', 'توقّفت الإشعارات منذ الليلة الماضية'
];
const CUSTOMERS = [
  'شركة الهلال للتجارة', 'مؤسسة أبناء الخطيب', 'تعاونية مياه النور', 'مجموعة مارشيتي', 'استوديو نديم',
  'آلتو للشحن', 'مخابز قنطرة', 'سندة للخدمات اللوجستية', 'بصريات فرّان', 'مطابع إيواساكي'
];
const BODIES = [
  'بدأت المشكلة يوم الثلاثاء ولم تعمل منذ ذلك الحين. جرّبنا متصفحًا آخر ولم يتغيّر شيء.',
  'كانت تعمل جيدًا الشهر الماضي، ولم يتغيّر شيء من طرفنا على حدّ علمي.',
  'قسم المالية لدينا يحتاج هذا قبل نهاية الربع. هل من تحديث؟',
  'أرفقتُ لقطة شاشة. تظهر الرسالة بعد نحو عشر ثوانٍ من الضغط على الزر.',
  'ثلاثة من زملائي يرون الأمر نفسه، وواحد لا يراه، مع أن إصدار المتصفح واحد.'
];

const STATUSES = ['open', 'pending', 'solved'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export function buildTickets(count = 5200) {
  const tickets = [];
  const start = Date.UTC(2026, 4, 1);
  for (let i = 1; i <= count; i++) {
    const created = new Date(start + i * 1_780_000 + Math.floor(rnd() * 900_000));
    const assignee = rnd() < 0.72 ? (rnd() < 0.62 ? 'ag_dana' : pick(agents).id) : null;
    tickets.push({
      id: `t_${String(i).padStart(5, '0')}`,
      subject: pick(SUBJECTS),
      customer: pick(CUSTOMERS),
      status: rnd() < 0.55 ? 'open' : pick(STATUSES),
      priority: pick(PRIORITIES),
      assigneeId: assignee,
      version: 1,
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      replies: [
        { id: `r_${i}_1`, authorId: null, authorName: pick(CUSTOMERS), body: pick(BODIES), createdAt: created.toISOString() }
      ]
    });
  }
  // Omar has just joined the desk: nothing is assigned to him yet.
  for (const ticket of tickets) {
    if (ticket.assigneeId === 'ag_omar') ticket.assigneeId = 'ag_rana';
  }
  return tickets;
}
