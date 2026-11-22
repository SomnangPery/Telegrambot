// News & announcements screen for partner organisations (NGOs, donors) and admins:
// choose areas → write title + message → see who it reaches → send → reach report.
import { useEffect, useMemo, useState } from 'react';
import { api, type Area, type NewsAreas, type NewsRow, type Officer } from './api';

type Place = { code: string; nameKm: string; nameEn: string };

const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const LEVEL: Record<string, string> = { province: 'Province', district: 'District', commune: 'Commune', village: 'Village' };

/** Prefix relation: area "02" covers "0203"; "0203" is inside "02". */
const related = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

export function NewsPanel({ me }: { me: Officer }) {
  const [info, setInfo] = useState<NewsAreas | null>(null);
  const [history, setHistory] = useState<NewsRow[]>([]);
  const [selected, setSelected] = useState<Area[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [reach, setReach] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const reload = () => {
    api.newsAreas().then(setInfo).catch((e) => setError(e.message));
    api.news().then(setHistory).catch(() => {});
  };
  useEffect(reload, []);

  // Live audience count whenever the chosen areas change.
  const key = selected.map((a) => a.code).join();
  useEffect(() => {
    if (!selected.length) return setReach(null);
    api
      .newsPreview(selected.map((a) => a.code))
      .then((r) => setReach(r.recipients))
      .catch((e) => setError(e.message));
  }, [key]); // eslint-disable-line

  const add = (a: Area) => {
    // Adding a bigger area replaces the smaller ones inside it, and vice versa is ignored.
    if (selected.some((s) => a.code.startsWith(s.code))) return;
    setSelected([...selected.filter((s) => !s.code.startsWith(a.code)), a]);
  };

  const remaining = info?.weeklyLimit != null ? info.weeklyLimit - info.sentThisWeek : null;
  const sender = me.orgNameKm || me.orgName || me.name;

  async function send() {
    if (!confirm(`Send this announcement to ${reach ?? 0} farmer(s)?`)) return;
    setBusy(true);
    setResult('');
    setError('');
    try {
      const r = await api.newsSend(selected.map((a) => a.code), title, text);
      setResult(
        `✅ Sent to ${r.sent} of ${r.recipients} farmers${r.failed ? `, ${r.failed} failed` : ''}${r.blocked ? `, ${r.blocked} had blocked the bot` : ''}.`,
      );
      setTitle('');
      setText('');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- Composer ---------------- */}
      <section className="space-y-4 rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <div>
          <h2 className="text-lg font-semibold">📰 New announcement</h2>
          <p className="km text-sm text-slate-500">
            Farmers will see it from <b>{sender}</b>. Farmers can turn partner news off in the bot.
          </p>
          {remaining != null && (
            <p className={`mt-1 text-xs ${remaining > 0 ? 'text-slate-500' : 'text-red-600'}`}>
              {remaining} of {info?.weeklyLimit} announcements left this week
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">1. Who should receive it?</label>
          {info?.everywhere && (
            <div className="mt-2">
              <button
                onClick={async () => setSelected((await api.provinces()).map((p) => ({ ...p, level: 'province' })))}
                className="km rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
              >
                + ទូទាំងប្រទេសកម្ពុជា · All of Cambodia (25 provinces)
              </button>
            </div>
          )}
          {info && !info.everywhere && (
            <div className="mt-2 flex flex-wrap gap-2">
              {info.areas.map((a) => (
                <button
                  key={a.code}
                  onClick={() => add(a)}
                  className="km rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                >
                  + All of {a.nameKm} · {a.nameEn}
                </button>
              ))}
            </div>
          )}
          {info && <AreaChooser info={info} onAdd={add} />}
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.map((a) => (
              <span key={a.code} className="km inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                {LEVEL[a.level] ?? ''} {a.nameKm} · {a.nameEn}
                <button onClick={() => setSelected(selected.filter((s) => s.code !== a.code))} className="text-slate-400 hover:text-red-600">
                  ✕
                </button>
              </span>
            ))}
            {!selected.length && <span className="text-sm text-slate-400">No area chosen yet.</span>}
          </div>
          {reach != null && (
            <p className="mt-2 text-sm">
              👥 Will reach <b>{reach}</b> registered farmer(s)
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">2. Title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="ឧ. វគ្គបណ្តុះបណ្តាលដោយឥតគិតថ្លៃ"
            className="km mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-medium">3. Message (Khmer)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder="សរសេរសេចក្តីជូនដំណឹងជាភាសាខ្មែរ…"
            className="km mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
          />
          <div className="text-right text-xs text-slate-400">{text.length}/2000</div>
        </div>

        {text.trim() && (
          <div className="km rounded-lg bg-sky-50 p-3 text-sm whitespace-pre-wrap ring-1 ring-sky-100">
            <div className="mb-1 text-xs text-sky-700">Preview on Telegram</div>
            📰 សេចក្តីជូនដំណឹងពី {sender}
            {'\n\n'}
            {title.trim() && `【${title.trim()}】\n`}
            {text.trim()}
            {'\n\n'}ℹ️ បិទព័ត៌មានពីដៃគូ៖ /settings
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <p className="text-sm">{result}</p>}

        <button
          onClick={send}
          disabled={busy || !text.trim() || !selected.length || remaining === 0}
          className="w-full rounded-lg bg-emerald-700 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? 'Sending…' : `Send to ${reach ?? 0} farmer(s)`}
        </button>
      </section>

      {/* ---------------- History / reach report ---------------- */}
      <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold">Sent announcements</h2>
        <p className="text-sm text-slate-500">Reach per announcement, for your reports.</p>
        <ul className="mt-3 space-y-3">
          {history.map((n) => (
            <li key={n.id} className="rounded-lg p-3 ring-1 ring-slate-200">
              <div className="flex items-baseline justify-between gap-2">
                <div className="km font-medium">{n.title || n.text.slice(0, 60)}</div>
                <div className="shrink-0 text-xs text-slate-400">{fmtTime(n.createdAt)}</div>
              </div>
              {n.title && <p className="km mt-1 line-clamp-3 text-sm text-slate-600 whitespace-pre-wrap">{n.text}</p>}
              <div className="km mt-2 text-xs text-slate-500">
                📍 {n.areas.map((a) => a.nameKm).join(', ')}
                {me.role === 'admin' && n.sender && ` · ${n.sender}`}
              </div>
              <div className="mt-1 text-xs">
                ✅ {n.sent} delivered{n.failed + n.blocked > 0 && <span className="text-red-600"> · ❌ {n.failed + n.blocked} not delivered</span>}
              </div>
            </li>
          ))}
          {!history.length && <li className="text-sm text-slate-400">Nothing sent yet.</li>}
        </ul>
      </section>
    </main>
  );
}

/** Narrow down to a district or commune inside the allowed areas. */
function AreaChooser({ info, onAdd }: { info: NewsAreas; onAdd: (a: Area) => void }) {
  const [provinces, setProvinces] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<Place[]>([]);
  const [communes, setCommunes] = useState<Place[]>([]);
  const [p, setP] = useState('');
  const [d, setD] = useState('');
  const [c, setC] = useState('');
  const ok = useMemo(
    () => (code: string) => info.everywhere || info.areas.some((a) => related(code, a.code)),
    [info],
  );

  useEffect(() => {
    api.provinces().then((rows) => setProvinces(rows.filter((r) => ok(r.code))));
  }, [ok]);
  useEffect(() => {
    setD('');
    setC('');
    setCommunes([]);
    if (p) api.districts(p).then((rows) => setDistricts(rows.filter((r) => ok(r.code))));
    else setDistricts([]);
  }, [p, ok]);
  useEffect(() => {
    setC('');
    if (d) api.communes(d).then((rows) => setCommunes(rows.filter((r) => ok(r.code))));
    else setCommunes([]);
  }, [d, ok]);

  const pick = (): Area | null => {
    const find = (list: Place[], code: string, level: string) => {
      const x = list.find((r) => r.code === code);
      return x ? { ...x, level } : null;
    };
    return (c && find(communes, c, 'commune')) || (d && find(districts, d, 'district')) || (p && find(provinces, p, 'province')) || null;
  };
  const chosen = pick();
  // Can only add areas fully inside the account's allowed areas (the server checks this too).
  const inside = (code: string) => info.everywhere || info.areas.some((a) => code.startsWith(a.code));
  const sel = 'km min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      <div className="mb-2 text-xs text-slate-500">Or choose a specific area:</div>
      <div className="flex flex-wrap gap-2">
        <select className={sel} value={p} onChange={(e) => setP(e.target.value)}>
          <option value="">Province…</option>
          {provinces.map((r) => (
            <option key={r.code} value={r.code}>{r.nameKm} · {r.nameEn}</option>
          ))}
        </select>
        <select className={sel} value={d} disabled={!p} onChange={(e) => setD(e.target.value)}>
          <option value="">All districts</option>
          {districts.map((r) => (
            <option key={r.code} value={r.code}>{r.nameKm} · {r.nameEn}</option>
          ))}
        </select>
        <select className={sel} value={c} disabled={!d} onChange={(e) => setC(e.target.value)}>
          <option value="">All communes</option>
          {communes.map((r) => (
            <option key={r.code} value={r.code}>{r.nameKm} · {r.nameEn}</option>
          ))}
        </select>
        <button
          disabled={!chosen || !inside(chosen.code)}
          onClick={() => chosen && onAdd(chosen)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
