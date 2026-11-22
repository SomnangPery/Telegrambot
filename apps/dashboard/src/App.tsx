import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { NewsPanel } from './News';
import {
  api,
  hasToken,
  logout,
  type AlertRow,
  type Officer,
  type RiskLevel,
  type RiskReason,
  type VillageForecast,
  type VillageRow,
} from './api';

const COLOUR: Record<RiskLevel, string> = { urgent: '#dc2626', watch: '#eab308', normal: '#16a34a' };
const LEVEL_LABEL: Record<RiskLevel, string> = { urgent: 'Urgent', watch: 'Watch', normal: 'Normal' };
const REASON: Record<RiskReason, string> = {
  heavy_rain: 'Heavy rain ≥ 50 mm',
  storm: 'Storm / thunder',
  heat: 'Heat ≥ 38 °C',
  rain: 'Rain 20–50 mm',
  warm: 'Hot 35–38 °C',
};
const CONDITION: Record<string, string> = {
  clear: '☀️ Clear',
  cloudy: '⛅ Cloudy',
  light_rain: '🌦 Light rain',
  rain: '🌧 Rain',
  heavy_rain: '🌧 Heavy rain',
  thunderstorm: '⛈ Thunderstorm',
  storm: '🌀 Storm',
};

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [checking, setChecking] = useState(hasToken());

  useEffect(() => {
    if (!hasToken()) return;
    api
      .me()
      .then(setOfficer)
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="grid h-full place-items-center text-slate-500">Loading…</div>;
  if (!officer) return <Login onLogin={setOfficer} />;
  return officer.role === 'partner' ? <PartnerHome officer={officer} /> : <Dashboard officer={officer} />;
}

// ---------------------------------------------------------------- Login
/** Demo mode: pick a role, no password. Otherwise (or via the link) the normal email/password form. */
function Login({ onLogin }: { onLogin: (o: Officer) => void }) {
  const [demo, setDemo] = useState<boolean | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'officer' | 'partner'>('');

  useEffect(() => {
    api.demoEnabled().then(setDemo);
  }, []);

  if (demo === null) return <div className="grid h-full place-items-center text-slate-500">Loading…</div>;
  if (!demo || usePassword) return <PasswordLogin onLogin={onLogin} onBack={demo ? () => setUsePassword(false) : undefined} />;

  const enter = async (role: 'officer' | 'partner') => {
    setBusy(role);
    setError('');
    try {
      onLogin(await api.demoLogin(role));
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  const card =
    'flex w-full items-start gap-4 rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-2 hover:ring-emerald-600 disabled:opacity-60';
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Sour DataEF</h1>
          <p className="km text-sm text-slate-500">ជ្រើសរើសផ្ទាំងគ្រប់គ្រង · Choose a dashboard</p>
        </div>
        <button className={card} disabled={!!busy} onClick={() => enter('officer')}>
          <span className="text-3xl">🌾</span>
          <span>
            <span className="block font-semibold">Commune officer</span>
            <span className="km block text-sm text-slate-600">មន្ត្រីកសិកម្មឃុំ</span>
            <span className="mt-1 block text-xs text-slate-500">
              Village risk map, AI-drafted weather alerts to farmers, delivery history
            </span>
            {busy === 'officer' && <span className="mt-1 block text-xs text-emerald-700">Opening…</span>}
          </span>
        </button>
        <button className={card} disabled={!!busy} onClick={() => enter('partner')}>
          <span className="text-3xl">🤝</span>
          <span>
            <span className="block font-semibold">NGO partner</span>
            <span className="km block text-sm text-slate-600">អង្គការដៃគូ</span>
            <span className="mt-1 block text-xs text-slate-500">
              News &amp; announcements to farmers in any area, with reach reports
            </span>
            {busy === 'partner' && <span className="mt-1 block text-xs text-emerald-700">Opening…</span>}
          </span>
        </button>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        <p className="text-center text-xs text-slate-400">
          Demo mode – no password needed.{' '}
          <button className="underline hover:text-slate-600" onClick={() => setUsePassword(true)}>
            Sign in with password
          </button>
        </p>
      </div>
    </div>
  );
}

function PasswordLogin({ onLogin, onBack }: { onLogin: (o: Officer) => void; onBack?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api.login(email, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-xl font-semibold">Sour DataEF</h1>
          <p className="km text-sm text-slate-500">ផ្ទាំងគ្រប់គ្រងមន្ត្រីកសិកម្មឃុំ · Commune officer dashboard</p>
        </div>
        <label className="block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-emerald-700 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {onBack && (
          <button type="button" onClick={onBack} className="w-full text-center text-xs text-slate-400 underline hover:text-slate-600">
            ← Back to choose a dashboard
          </button>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Dashboard
function Dashboard({ officer }: { officer: Officer }) {
  const [tab, setTab] = useState<'map' | 'history'>('map');
  const [villages, setVillages] = useState<VillageRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [me, setMe] = useState(officer);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!me.communeCode) return;
    setLoading(true);
    api
      .villages()
      .then((v) => {
        setVillages(v);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [me.communeCode]);

  const changeArea = async (communeCode: string) => {
    setMe(await api.setArea(communeCode));
    setSelected(new Set());
    setFocus(null);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = (code: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const counts = useMemo(() => {
    const c = { urgent: 0, watch: 0, normal: 0, farmers: 0 };
    for (const v of villages) {
      c[v.risk?.level ?? 'normal']++;
      c.farmers += v.subscribers;
    }
    return c;
  }, [villages]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="font-semibold">Sour DataEF</div>
          <div className="text-xs text-slate-500">{me.name}</div>
        </div>
        <AreaPicker officer={me} onChange={changeArea} />
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(['map', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 ${tab === t ? 'bg-white shadow-sm' : 'text-slate-600'}`}
            >
              {t === 'map' ? 'Risk map' : 'History'}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Stat colour={COLOUR.urgent} label="Urgent" n={counts.urgent} />
          <Stat colour={COLOUR.watch} label="Watch" n={counts.watch} />
          <Stat colour={COLOUR.normal} label="Normal" n={counts.normal} />
          <span className="text-slate-500">👥 {counts.farmers} farmers</span>
          <DemoMenu onDone={load} />
          <button
            onClick={() => {
              logout();
              location.reload();
            }}
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>
      {error && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading && <div className="bg-sky-50 px-4 py-1 text-xs text-sky-700">Loading forecasts…</div>}

      {tab === 'map' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_420px]">
          <div className="relative min-h-[360px]">
            <RiskMap villages={villages} selected={selected} onPick={(c) => setFocus(c)} />
          </div>
          <aside className="min-h-0 space-y-4 overflow-y-auto border-l border-slate-200 bg-white p-4">
            <VillageList villages={villages} selected={selected} toggle={toggle} focus={focus} setFocus={setFocus} />
            {focus && <VillagePanel code={focus} villages={villages} />}
            <SendAlert
              villages={villages.filter((v) => selected.has(v.code))}
              onSent={() => {
                setSelected(new Set());
                load();
              }}
            />
          </aside>
        </main>
      ) : (
        <History />
      )}
    </div>
  );
}

/** Partner organisations (NGOs, donors) only see the news & announcements screen. */
function PartnerHome({ officer }: { officer: Officer }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="font-semibold">Sour DataEF · Partner portal</div>
          <div className="km text-xs text-slate-500">
            {officer.orgNameKm || officer.orgName} · {officer.name}
          </div>
        </div>
        <button
          onClick={() => {
            logout();
            location.reload();
          }}
          className="ml-auto rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>
      <NewsPanel me={officer} />
    </div>
  );
}

/** Province → district → commune picker: the officer's area can be any commune in Cambodia. */
function AreaPicker({ officer, onChange }: { officer: Officer; onChange: (commune: string) => void }) {
  type Place = { code: string; nameKm: string; nameEn: string };
  const [open, setOpen] = useState(!officer.communeCode);
  const [provinces, setProvinces] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<Place[]>([]);
  const [communes, setCommunes] = useState<Place[]>([]);
  const [province, setProvince] = useState(officer.area?.province.code ?? '');
  const [district, setDistrict] = useState(officer.area?.district.code ?? '');

  useEffect(() => {
    if (open && !provinces.length) api.provinces().then(setProvinces);
  }, [open, provinces.length]);
  useEffect(() => {
    if (open && province) api.districts(province).then(setDistricts);
  }, [open, province]);
  useEffect(() => {
    if (open && district) api.communes(district).then(setCommunes);
  }, [open, district]);

  const label = (p: Place) => `${p.nameKm} · ${p.nameEn}`;
  const sel = 'km max-w-44 rounded-md border border-slate-300 px-2 py-1 text-sm';

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="km rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100">
        📍 {officer.area ? `${officer.area.commune.nameKm}, ${officer.area.district.nameKm}, ${officer.area.province.nameKm}` : 'Choose area'}
        <span className="ml-1 text-xs text-slate-400">change</span>
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select className={sel} value={province} onChange={(e) => (setProvince(e.target.value), setDistrict(''), setCommunes([]))}>
        <option value="">Province…</option>
        {provinces.map((p) => (
          <option key={p.code} value={p.code}>{label(p)}</option>
        ))}
      </select>
      <select className={sel} value={district} disabled={!province} onChange={(e) => setDistrict(e.target.value)}>
        <option value="">District…</option>
        {districts.map((p) => (
          <option key={p.code} value={p.code}>{label(p)}</option>
        ))}
      </select>
      <select
        className={sel}
        value=""
        disabled={!district}
        onChange={(e) => {
          if (!e.target.value) return;
          onChange(e.target.value);
          setOpen(false);
        }}
      >
        <option value="">Commune…</option>
        {communes.map((p) => (
          <option key={p.code} value={p.code}>{label(p)}</option>
        ))}
      </select>
      {officer.communeCode && (
        <button onClick={() => setOpen(false)} className="px-1 text-slate-400">✕</button>
      )}
    </div>
  );
}

function Stat({ colour, label, n }: { colour: string; label: string; n: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
      {label} {n}
    </span>
  );
}

function DemoMenu({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState('');
  const run = async (job: string) => {
    setBusy(job);
    try {
      const r = await api.runJob(job);
      alert(`${job}: ${JSON.stringify(r)}`);
      onDone();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <select
      value=""
      disabled={!!busy}
      onChange={(e) => e.target.value && run(e.target.value)}
      className="rounded-md border border-slate-300 px-2 py-1 text-slate-600"
      title="Run a scheduled job now (demo)"
    >
      <option value="">{busy ? `Running ${busy}…` : 'Run job…'}</option>
      <option value="refresh">Refresh DataEF cache</option>
      <option value="brief">Send 6 AM brief now</option>
      <option value="weather">Run hourly weather check</option>
      <option value="rate">Run rate check</option>
      <option value="csx">Run CSX check</option>
    </select>
  );
}

// ---------------------------------------------------------------- Map
function FitBounds({ villages }: { villages: VillageRow[] }) {
  const map = useMap();
  const key = villages.map((v) => v.code).join();
  useEffect(() => {
    const pts = villages.filter((v) => v.lat != null && v.lng != null).map((v) => [v.lat!, v.lng!] as [number, number]);
    if (pts.length) map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 });
  }, [key, map]);
  return null;
}

function RiskMap({
  villages,
  selected,
  onPick,
}: {
  villages: VillageRow[];
  selected: Set<string>;
  onPick: (code: string) => void;
}) {
  return (
    <MapContainer center={[13.1, 103.2]} zoom={12} className="absolute inset-0">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds villages={villages} />
      {villages
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const level = v.risk?.level ?? 'normal';
          return (
            <CircleMarker
              key={v.code}
              center={[v.lat!, v.lng!]}
              radius={10 + Math.min(12, v.subscribers * 2)}
              pathOptions={{
                color: selected.has(v.code) ? '#0f172a' : '#fff',
                weight: selected.has(v.code) ? 3 : 2,
                fillColor: COLOUR[level],
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onPick(v.code) }}
            >
              <Tooltip>
                <span className="km">{v.nameKm}</span> ({v.nameEn}) · {LEVEL_LABEL[level]} · 👥 {v.subscribers}
              </Tooltip>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}

// ---------------------------------------------------------------- Village list + panel
function VillageList({
  villages,
  selected,
  toggle,
  focus,
  setFocus,
}: {
  villages: VillageRow[];
  selected: Set<string>;
  toggle: (c: string) => void;
  focus: string | null;
  setFocus: (c: string) => void;
}) {
  const order = { urgent: 0, watch: 1, normal: 2 };
  const sorted = [...villages].sort((a, b) => order[a.risk?.level ?? 'normal'] - order[b.risk?.level ?? 'normal']);
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Villages · next 3 days</h2>
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {sorted.map((v) => {
          const level = v.risk?.level ?? 'normal';
          return (
            <li
              key={v.code}
              className={`flex items-center gap-2 px-3 py-2 text-sm ${focus === v.code ? 'bg-slate-50' : ''}`}
            >
              <input type="checkbox" checked={selected.has(v.code)} onChange={() => toggle(v.code)} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOUR[level] }} />
              <button className="flex-1 truncate text-left" onClick={() => setFocus(v.code)}>
                <span className="km">{v.nameKm}</span> <span className="text-slate-400">{v.nameEn}</span>
              </button>
              <span className="text-xs text-slate-500">👥 {v.subscribers}</span>
            </li>
          );
        })}
        {!villages.length && <li className="px-3 py-4 text-sm text-slate-500">No villages yet.</li>}
      </ul>
    </section>
  );
}

function VillagePanel({ code, villages }: { code: string; villages: VillageRow[] }) {
  const [data, setData] = useState<VillageForecast | null>(null);
  const [error, setError] = useState('');
  const row = villages.find((v) => v.code === code);
  useEffect(() => {
    setData(null);
    api.forecast(code).then(setData).catch((e) => setError(e.message));
  }, [code]);

  return (
    <section className="rounded-lg p-3 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">
          <span className="km">{row?.nameKm}</span> <span className="text-sm font-normal text-slate-500">{row?.nameEn}</span>
        </h3>
        <span className="text-xs text-slate-500">👥 {row?.subscribers ?? 0} subscribers</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading forecast…</p>}
      {data && (
        <>
          {data.risk.reasons.length > 0 && (
            <p className="mt-1 text-sm" style={{ color: COLOUR[data.risk.level] }}>
              {LEVEL_LABEL[data.risk.level]}: {data.risk.reasons.map((r) => REASON[r]).join(', ')}
            </p>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2">
            {data.forecast.map((f, i) => {
              const lvl = data.risk.perDay[i]?.level ?? 'normal';
              return (
                <div key={f.date} className="rounded-md p-2 text-xs ring-1 ring-slate-200" style={{ borderTop: `3px solid ${COLOUR[lvl]}` }}>
                  <div className="font-medium">{fmtDate(f.date)}</div>
                  <div>{CONDITION[f.condition] ?? f.condition}</div>
                  <div>🌡 {Math.round(f.tempMaxC)}°C</div>
                  <div>💧 {Math.round(f.rainMm)} mm</div>
                </div>
              );
            })}
          </div>
          {data.now && (
            <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              <b>Now in {data.now.province}</b> (DataEF, observed {fmtTime(data.now.observedAt)}):{' '}
              {CONDITION[data.now.condition] ?? data.now.conditionText} · {Math.round(data.now.tempC)}°C
              {data.now.humidity != null && ` · 💧 ${data.now.humidity}% humidity`}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            3-day forecast: Open-Meteo, {data.stale ? 'last updated' : 'updated'} {fmtTime(data.fetchedAt)}
            {row?.approximateLocation && ' · map point is the commune centre'}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Send alert
function SendAlert({ villages, onSent }: { villages: VillageRow[]; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'send'>('');
  const [reach, setReach] = useState<number | null>(null);
  const [result, setResult] = useState('');
  const codes = villages.map((v) => v.code);
  const key = codes.join();

  useEffect(() => {
    setResult('');
    setReach(codes.length ? villages.reduce((a, v) => a + v.subscribers, 0) : null);
  }, [key]);

  async function draft() {
    setBusy('draft');
    try {
      setText((await api.draft(codes)).text);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function send() {
    const { recipients } = await api.preview(codes, text);
    if (!confirm(`Send this message to ${recipients} farmer(s) in ${codes.length} village(s)?`)) return;
    setBusy('send');
    try {
      const r = await api.send(codes, text);
      setResult(`✅ Sent to ${r.sent} of ${r.recipients} farmers${r.failed ? `, ${r.failed} failed` : ''}${r.blocked ? `, ${r.blocked} blocked the bot` : ''}.`);
      setText('');
      onSent();
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="rounded-lg p-3 ring-1 ring-slate-200">
      <h3 className="font-semibold">Send alert to farmers</h3>
      {!codes.length ? (
        <p className="mt-1 text-sm text-slate-500">Tick one or more villages above to send them a message.</p>
      ) : (
        <>
          <p className="km mt-1 text-sm text-slate-600">
            {villages.map((v) => v.nameKm).join(', ')} · will reach <b>{reach}</b> farmer(s)
          </p>
          <button
            onClick={draft}
            disabled={!!busy}
            className="mt-2 rounded-md bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200 disabled:opacity-60"
          >
            {busy === 'draft' ? 'Drafting…' : '✨ Draft with AI'}
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="សរសេរសារជាភាសាខ្មែរ… (write the message in Khmer)"
            className="km mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
          {text && (
            <div className="km mt-2 rounded-lg bg-sky-50 p-3 text-sm whitespace-pre-wrap ring-1 ring-sky-100">
              <div className="mb-1 text-xs text-sky-700">Preview on Telegram</div>
              📢 សារពីមន្ត្រីកសិកម្មឃុំ{'\n'}
              {text}
            </div>
          )}
          <button
            onClick={send}
            disabled={!text.trim() || !!busy}
            className="mt-2 w-full rounded-lg bg-emerald-700 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy === 'send' ? 'Sending…' : `Send to ${reach ?? 0} farmer(s)`}
          </button>
        </>
      )}
      {result && <p className="mt-2 text-sm">{result}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- History
function History() {
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  useEffect(() => {
    api.alerts().then(setRows).catch(() => setRows([]));
  }, []);
  const TYPE: Record<string, string> = {
    brief: '☀️ Brief',
    weather_urgent: '🚨 Weather',
    fx: '💱 Rate',
    csx: '📈 CSX',
    officer: '📢 Officer',
  };
  return (
    <main className="flex-1 overflow-y-auto p-4">
      <table className="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-slate-200">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="p-2">When</th>
            <th className="p-2">Type</th>
            <th className="p-2">Message</th>
            <th className="p-2 text-right">Sent</th>
            <th className="p-2 text-right">Failed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows?.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="p-2 whitespace-nowrap text-slate-500">{fmtTime(r.createdAt)}</td>
              <td className="p-2 whitespace-nowrap">{TYPE[r.type] ?? r.type}</td>
              <td className="km max-w-xl p-2 whitespace-pre-wrap">{r.textKm}</td>
              <td className="p-2 text-right">{r.sent}</td>
              <td className="p-2 text-right">{r.failed + r.blocked}</td>
            </tr>
          ))}
          {rows && !rows.length && (
            <tr>
              <td colSpan={5} className="p-4 text-center text-slate-500">
                No alerts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
