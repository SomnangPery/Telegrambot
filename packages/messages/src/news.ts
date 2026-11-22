// Partner news & announcements (NGOs, donors, authorities). Always labelled with the sender so
// farmers can tell them apart from official weather alerts (SRS: "sponsored content is labelled").

const OPT_OUT = {
  km: 'ℹ️ បិទព័ត៌មានពីដៃគូ៖ /settings',
  en: 'ℹ️ Turn off partner news: /settings',
};

export function newsMessage(
  lang: string,
  sender: { orgName: string; orgNameKm?: string | null },
  title: string,
  body: string,
) {
  const en = lang === 'en';
  const from = en ? sender.orgName : (sender.orgNameKm || sender.orgName);
  return [
    en ? `📰 Announcement from ${from}` : `📰 សេចក្តីជូនដំណឹងពី ${from}`,
    '',
    title ? `【${title.trim()}】` : '',
    body.trim(),
    '',
    en ? OPT_OUT.en : OPT_OUT.km,
  ]
    .filter((l, i, a) => !(l === '' && (a[i - 1] === '' || i === a.length - 1)))
    .join('\n');
}
