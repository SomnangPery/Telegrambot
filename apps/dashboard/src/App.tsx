import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

// ---------------------------------------------------------------- labels
const COLOUR: Record<RiskLevel, string> = { urgent: '#dc2626', watch: '#eab308', normal: '#16a34a' };
const LEVEL: Record<RiskLevel, { km: string; en: string; dot: string; soft: string; text: string }> = {
  urgent: { km: 'បន្ទាន់', en: 'Urgent', dot: 'bg-red-600', soft: 'bg-red-50 ring-red-200', text: 'text-red-700' },
  watch: { km: 'តាមដាន', en: 'Watch', dot: 'bg-yellow-400', soft: 'bg-yellow-50 ring-yellow-200', text: 'text-yellow-800' },
  normal: { km: 'ធម្មតា', en: 'Normal', dot: 'bg-green-600', soft: 'bg-green-50 ring-green-200', text: 'text-green-700' },
};
const REASON: Record<RiskReason, { km: string; en: string }> = {
  heavy_rain: { km: 'ភ្លៀងខ្លាំង', en: 'Heavy rain ≥ 50 mm' },
  storm: { km: 'ព្យុះ/ផ្គររន្ទះ', en: 'Storm / thunder' },
  heat: { km: 'កំដៅខ្លាំង', en: 'Heat ≥ 38 °C' },
  rain: { km: 'ភ្លៀង', en: 'Rain 20–50 mm' },
  warm: { km: 'ក្តៅ', en: 'Hot 35–38 °C' },
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
const levelOf = (v: VillageRow): RiskLevel => v.risk?.level ?? 'normal';

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtClock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- toasts (instead of browser pop-ups)
type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string };
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const view = (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[2000] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${
            t.kind === 'error' ? 'bg-red-50 text-red-800 ring-red-200' : t.kind === 'info' ? 'bg-white text-slate-700 ring-slate-200' : 'bg-emerald-50 text-emerald-900 ring-emerald-200'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
  return { notify, view };
}

// ---------------------------------------------------------------- app
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

  if (checking) return <Centered>Loading…</Centered>;
  if (!officer) return <Login onLogin={setOfficer} />;
  return officer.role === 'partner' ? <PartnerHome officer={officer} /> : <Dashboard officer={officer} />;
}

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="grid h-full place-items-center text-slate-500">{children}</div>
);

const signOut = () => {
  logout();
  location.reload();
};

// ---------------------------------------------------------------- login
/** Demo mode: pick a role, no password. Otherwise (or via the link) the normal email/password form. */
function Login({ onLogin }: { onLogin: (o: Officer) => void }) {
  const [demo, setDemo] = useState<boolean | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'officer' | 'partner'>('');

  useEffect(() => {
    api.demoEnabled().then(setDemo);
  }, []);

  if (demo === null) return <Centered>Loading…</Centered>;
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
    'group flex w-full items-start gap-4 rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-emerald-600 disabled:opacity-60';
  return (
    <div className="grid h-full place-items-center bg-gradient-to-b from-emerald-50 to-slate-50 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="text-4xl">🌾</div>
          <h1 className="mt-1 text-2xl font-semibold">Sour DataEF</h1>
          <p className="km text-sm text-slate-500">ជ្រើសរើសផ្ទាំងគ្រប់គ្រង · Choose a dashboard</p>
        </div>
        <button className={card} disabled={!!busy} onClick={() => enter('officer')}>
          <span className="text-3xl">🧑‍🌾</span>
          <span className="flex-1">
            <span className="block font-semibold">Commune officer</span>
            <span className="km block text-sm text-slate-600">មន្ត្រីកសិកម្មឃុំ</span>
            <span className="mt-1 block text-xs text-slate-500">See which villages are at risk and warn all farmers in one tap</span>
          </span>
          <span className="self-center text-slate-300 group-hover:text-emerald-600">{busy === 'officer' ? '…' : '→'}</span>
        </button>
        <button className={card} disabled={!!busy} onClick={() => enter('partner')}>
          <span className="text-3xl">🤝</span>
          <span className="flex-1">
            <span className="block font-semibold">NGO partner</span>
            <span className="km block text-sm text-slate-600">អង្គការដៃគូ</span>
            <span className="mt-1 block text-xs text-slate-500">Send news &amp; announcements to farmers, with reach reports</span>
          </span>
          <span className="self-center text-slate-300 group-hover:text-emerald-600">{busy === 'partner' ? '…' : '→'}</span>
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
    <div className="grid h-full place-items-center bg-gradient-to-b from-emerald-50 to-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-xl font-semibold">🌾 Sour DataEF</h1>
          <p className="km text-sm text-slate-500">ចូលប្រើប្រាស់ · Sign in</p>
        </div>
        <label className="block text-sm">
          Email
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="block text-sm">
          Password
          <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="btn-primary w-full">
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

// ---------------------------------------------------------------- shared top bar
function TopBar({ subtitle, children }: { subtitle: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-lg">🌾</span>
        <div className="leading-tight">
          <div className="font-semibold">Sour DataEF</div>
          <div className="km text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        {children}
        <button onClick={signOut} className="btn-ghost text-sm">
          ↩ Sign out
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- officer dashboard
function Dashboard({ officer }: { officer: Officer }) {
  const [tab, setTab] = useState<'map' | 'history'>('map');
  const [me, setMe] = useState(officer);
  const [villages, setVillages] = useState<VillageRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<RiskLevel | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [areaOpen, setAreaOpen] = useState(!officer.communeCode);
  const [composeOpen, setComposeOpen] = useState(false);
  const { notify, view: toasts } = useToasts();

  const load = useCallback(() => {
    if (!me.communeCode) return;
    setLoading(true);
    api
      .villages()
      .then((v) => {
        setVillages(v);
        setUpdated(new Date());
      })
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [me.communeCode, notify]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const changeArea = async (communeCode: string) => {
    const o = await api.setArea(communeCode);
    setMe(o);
    setSelected(new Set());
    setFocus(null);
    setFilter('all');
    setAreaOpen(false);
    notify(`📍 Now showing ${o.area?.commune.nameEn ?? 'new area'}`, 'info');
  };

  const counts = useMemo(() => {
    const c = { urgent: 0, watch: 0, normal: 0, farmers: 0 };
    for (const v of villages) {
      c[levelOf(v)]++;
      c.farmers += v.subscribers;
    }
    return c;
  }, [villages]);

  const chosen = villages.filter((v) => selected.has(v.code));
  const reach = chosen.reduce((a, v) => a + v.subscribers, 0);
  const area = me.area;

  return (
    <div className="flex h-full flex-col">
      <TopBar subtitle="មន្ត្រីកសិកម្មឃុំ · Commune officer">
        <button onClick={() => setAreaOpen(true)} className="btn-outline km max-w-full truncate text-sm" title="Change area">
          📍 {area ? `${area.commune.nameKm} · ${area.district.nameKm} · ${area.province.nameKm}` : 'Choose your commune'} ▾
        </button>
        <nav className="flex rounded-xl bg-slate-100 p-1 text-sm">
          {(['map', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? 'bg-white font-medium shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t === 'map' ? '🗺 Villages & alerts' : '🕘 History'}
            </button>
          ))}
        </nav>
        <DemoMenu onDone={load} notify={notify} />
      </TopBar>

      {tab === 'history' ? (
        <History />
      ) : !me.communeCode ? (
        <Centered>
          <button className="btn-primary" onClick={() => setAreaOpen(true)}>
            📍 Choose your commune to start
          </button>
        </Centered>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {/* Summary cards: tap to filter the village list */}
          <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
            {(['urgent', 'watch', 'normal'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setFilter(filter === l ? 'all' : l)}
                className={`rounded-xl px-4 py-3 text-left ring-1 transition ${LEVEL[l].soft} ${filter === l ? 'ring-2 ring-slate-800' : 'hover:ring-2'}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className={`h-3 w-3 rounded-full ${LEVEL[l].dot}`} />
                  <span className={`font-medium ${LEVEL[l].text}`}>{LEVEL[l].en}</span>
                  <span className="km text-xs text-slate-500">{LEVEL[l].km}</span>
                </div>
                <div className="mt-1 text-2xl font-semibold">
                  {counts[l]} <span className="text-sm font-normal text-slate-500">villages</span>
                </div>
              </button>
            ))}
            <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">👥 Farmers</span>
                <button onClick={load} disabled={loading} className="text-xs text-slate-500 hover:text-slate-900" title="Refresh">
                  {loading ? 'Updating…' : `↻ ${updated ? fmtClock(updated) : ''}`}
                </button>
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {counts.farmers} <span className="text-sm font-normal text-slate-500">registered</span>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px]">
            <div className="relative min-h-[320px]">
              <RiskMap villages={villages} selected={selected} focus={focus} onPick={(c) => setFocus(c)} />
              <Legend />
            </div>
            <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white">
              <VillagePicker
                villages={villages}
                selected={selected}
                setSelected={setSelected}
                focus={focus}
                setFocus={setFocus}
                filter={filter}
                setFilter={setFilter}
                loading={loading}
              />
              {/* Sticky action bar: always shows who an alert would reach */}
              <div className="border-t border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>
                    <b>{chosen.length}</b> village(s) selected
                  </span>
                  <span className="text-slate-600">
                    👥 reaches <b>{reach}</b> farmer(s)
                  </span>
                </div>
                <button className="btn-primary w-full" disabled={!chosen.length} onClick={() => setComposeOpen(true)}>
                  {chosen.length ? '📢 Write alert to these farmers →' : 'Select villages above to send an alert'}
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}

      {areaOpen && (
        <AreaDialog officer={me} onChange={changeArea} onClose={me.communeCode ? () => setAreaOpen(false) : undefined} />
      )}
      {composeOpen && (
        <ComposeDrawer
          villages={chosen}
          onClose={() => setComposeOpen(false)}
          onSent={(msg) => {
            notify(msg);
            setComposeOpen(false);
            setSelected(new Set());
            load();
          }}
          notify={notify}
        />
      )}
      {toasts}
    </div>
  );
}

// ---------------------------------------------------------------- partner portal
/** Partner organisations (NGOs, donors) only see the news & announcements screen. */
function PartnerHome({ officer }: { officer: Officer }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar subtitle={`អង្គការដៃគូ · NGO partner — ${officer.orgNameKm || officer.orgName || officer.name}`} />
      <NewsPanel me={officer} />
    </div>
  );
}

// ---------------------------------------------------------------- area picker (modal)
function AreaDialog({
  officer,
  onChange,
  onClose,
}: {
  officer: Officer;
  onChange: (commune: string) => void;
  onClose?: () => void;
}) {
  type Place = { code: string; nameKm: string; nameEn: string };
  const [provinces, setProvinces] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<Place[]>([]);
  const [communes, setCommunes] = useState<Place[]>([]);
  const [province, setProvince] = useState(officer.area?.province.code ?? '');
  const [district, setDistrict] = useState(officer.area?.district.code ?? '');
  const [commune, setCommune] = useState(officer.area?.commune.code ?? '');

  useEffect(() => {
    api.provinces().then(setProvinces);
  }, []);
  useEffect(() => {
    if (province) api.districts(province).then(setDistricts);
  }, [province]);
  useEffect(() => {
    if (district) api.communes(district).then(setCommunes);
  }, [district]);

  const label = (p: Place) => `${p.nameKm} · ${p.nameEn}`;
  return (
    <Modal title="📍 Your area · តំបន់របស់អ្នក" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">Choose the commune you are responsible for. Any commune in Cambodia.</p>
      <div className="space-y-3">
        <Field label="1. Province · ខេត្ត">
          <select className="input km" value={province} onChange={(e) => (setProvince(e.target.value), setDistrict(''), setCommune(''), setCommunes([]))}>
            <option value="">Choose…</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>{label(p)}</option>
            ))}
          </select>
        </Field>
        <Field label="2. District · ស្រុក/ក្រុង">
          <select className="input km" value={district} disabled={!province} onChange={(e) => (setDistrict(e.target.value), setCommune(''))}>
            <option value="">Choose…</option>
            {districts.map((p) => (
              <option key={p.code} value={p.code}>{label(p)}</option>
            ))}
          </select>
        </Field>
        <Field label="3. Commune · ឃុំ/សង្កាត់">
          <select className="input km" value={commune} disabled={!district} onChange={(e) => setCommune(e.target.value)}>
            <option value="">Choose…</option>
            {communes.map((p) => (
              <option key={p.code} value={p.code}>{label(p)}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        {onClose && (
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className="btn-primary" disabled={!commune} onClick={() => onChange(commune)}>
          Show this commune
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="km mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[1500] grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between">
          <h2 className="km text-lg font-semibold">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- demo tools
function DemoMenu({ onDone, notify }: { onDone: () => void; notify: (t: string, k?: Toast['kind']) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const jobs = [
    { id: 'brief', icon: '☀️', label: 'Send 6 AM brief now', km: 'ផ្ញើព័ត៌មានព្រឹកឥឡូវ' },
    { id: 'weather', icon: '🚨', label: 'Run urgent weather check', km: 'ពិនិត្យអាកាសធាតុបន្ទាន់' },
    { id: 'rate', icon: '💱', label: 'Send exchange-rate update', km: 'ផ្ញើអត្រាប្តូរប្រាក់' },
    { id: 'csx', icon: '📈', label: 'Send CSX update', km: 'ផ្ញើព័ត៌មានផ្សារហ៊ុន' },
    { id: 'refresh', icon: '↻', label: 'Refresh all DataEF data', km: 'ទាញទិន្នន័យថ្មី' },
  ];
  const run = async (job: (typeof jobs)[number]) => {
    setBusy(job.id);
    setOpen(false);
    notify(`${job.icon} ${job.label}…`, 'info');
    try {
      const r = (await api.runJob(job.id)) as Record<string, unknown>;
      const sent = typeof r?.sent === 'number' ? ` – sent to ${r.sent} farmer(s)` : '';
      notify(`✅ ${job.label} done${sent}`);
      onDone();
    } catch (e) {
      notify(`❌ ${(e as Error).message}`, 'error');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="relative">
      <button className="btn-outline text-sm" onClick={() => setOpen(!open)} disabled={!!busy}>
        {busy ? '⏳ Running…' : '🧪 Demo tools ▾'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1100]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1200] mt-2 w-72 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Run a scheduled job now (for the demo)</div>
            {jobs.map((j) => (
              <button key={j.id} onClick={() => run(j)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                <span>{j.icon}</span>
                <span>
                  <span className="block">{j.label}</span>
                  <span className="km block text-xs text-slate-500">{j.km}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- map
function FitBounds({ villages }: { villages: VillageRow[] }) {
  const map = useMap();
  const key = villages.map((v) => v.code).join();
  useEffect(() => {
    const pts = villages.filter((v) => v.lat != null && v.lng != null).map((v) => [v.lat!, v.lng!] as [number, number]);
    if (pts.length) map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 });
  }, [key, map]); // eslint-disable-line
  return null;
}

function FlyTo({ village }: { village?: VillageRow }) {
  const map = useMap();
  useEffect(() => {
    if (village?.lat != null && village.lng != null) map.flyTo([village.lat, village.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [village?.code]); // eslint-disable-line
  return null;
}

function RiskMap({
  villages,
  selected,
  focus,
  onPick,
}: {
  villages: VillageRow[];
  selected: Set<string>;
  focus: string | null;
  onPick: (code: string) => void;
}) {
  return (
    <MapContainer center={[12.6, 104.9]} zoom={8} className="absolute inset-0">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds villages={villages} />
      <FlyTo village={villages.find((v) => v.code === focus)} />
      {villages
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const level = levelOf(v);
          const isSel = selected.has(v.code);
          const isFocus = focus === v.code;
          return (
            <CircleMarker
              key={v.code}
              center={[v.lat!, v.lng!]}
              radius={(isFocus ? 14 : 10) + Math.min(10, v.subscribers * 2)}
              pathOptions={{
                color: isSel || isFocus ? '#0f172a' : '#fff',
                weight: isSel || isFocus ? 3 : 2,
                fillColor: COLOUR[level],
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onPick(v.code) }}
            >
              <Tooltip>
                <span className="km">{v.nameKm}</span> ({v.nameEn}) · {LEVEL[level].en} · 👥 {v.subscribers}
              </Tooltip>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 z-[500] rounded-xl bg-white/95 px-3 py-2 text-xs shadow ring-1 ring-slate-200">
      <div className="mb-1 font-medium">Risk · next 3 days</div>
      {(['urgent', 'watch', 'normal'] as const).map((l) => (
        <div key={l} className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${LEVEL[l].dot}`} /> {LEVEL[l].en} <span className="km text-slate-500">{LEVEL[l].km}</span>
        </div>
      ))}
      <div className="mt-1 text-slate-500">Bigger dot = more farmers</div>
    </div>
  );
}

// ---------------------------------------------------------------- village list (step 1)
function VillagePicker({
  villages,
  selected,
  setSelected,
  focus,
  setFocus,
  filter,
  setFilter,
  loading,
}: {
  villages: VillageRow[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  focus: string | null;
  setFocus: (c: string | null) => void;
  filter: RiskLevel | 'all';
  setFilter: (f: RiskLevel | 'all') => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const order = { urgent: 0, watch: 1, normal: 2 };
  const q = query.trim().toLowerCase();
  const shown = villages
    .filter((v) => filter === 'all' || levelOf(v) === filter)
    .filter((v) => !q || v.nameKm.includes(query.trim()) || v.nameEn.toLowerCase().includes(q))
    .sort((a, b) => order[levelOf(a)] - order[levelOf(b)] || b.subscribers - a.subscribers);

  const toggle = (code: string) => {
    const n = new Set(selected);
    if (n.has(code)) n.delete(code);
    else n.add(code);
    setSelected(n);
  };
  const atRisk = villages.filter((v) => levelOf(v) !== 'normal');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-slate-100 p-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">
            <span className="mr-1 inline-grid h-5 w-5 place-items-center rounded-full bg-emerald-700 text-xs text-white">1</span>
            Choose villages
          </h2>
          <span className="km text-xs text-slate-500">ជ្រើសរើសភូមិ</span>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Search village · ស្វែងរកភូមិ" className="input km" />
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(['all', 'urgent', 'watch', 'normal'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 ring-1 ${filter === f ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
            >
              {f === 'all' ? `All (${villages.length})` : `${LEVEL[f].en} (${villages.filter((v) => levelOf(v) === f).length})`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            className="btn-chip"
            disabled={!atRisk.length}
            onClick={() => setSelected(new Set([...selected, ...atRisk.map((v) => v.code)]))}
            title="Select every village with Urgent or Watch risk"
          >
            ⚠️ Select all at-risk ({atRisk.length})
          </button>
          <button className="btn-chip" onClick={() => setSelected(new Set([...selected, ...shown.map((v) => v.code)]))}>
            ☑ Select shown
          </button>
          {selected.size > 0 && (
            <button className="btn-chip" onClick={() => setSelected(new Set())}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {loading && !villages.length && <li className="p-4 text-sm text-slate-500">Loading villages and forecasts…</li>}
        {!loading && !shown.length && <li className="p-4 text-sm text-slate-500">No villages match.</li>}
        {shown.map((v) => {
          const level = levelOf(v);
          const isSel = selected.has(v.code);
          const open = focus === v.code;
          return (
            <li key={v.code} className={`border-b border-slate-100 ${open ? 'bg-slate-50' : ''}`}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(v.code)}
                  className="h-5 w-5 shrink-0 accent-emerald-700"
                  aria-label={`Select ${v.nameEn}`}
                />
                <button className="min-w-0 flex-1 text-left" onClick={() => setFocus(open ? null : v.code)}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL[level].dot}`} />
                    <span className="km truncate font-medium">{v.nameKm}</span>
                    <span className="truncate text-sm text-slate-400">{v.nameEn}</span>
                  </div>
                  {v.risk && v.risk.reasons.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.risk.reasons.map((r) => (
                        <span key={r} className={`km rounded-full px-2 py-0.5 text-xs ring-1 ${LEVEL[level].soft} ${LEVEL[level].text}`}>
                          {REASON[r].km}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                <span className="shrink-0 text-right text-xs text-slate-500">
                  👥 {v.subscribers}
                  <span className="ml-1 text-slate-300">{open ? '▴' : '▾'}</span>
                </span>
              </div>
              {open && <VillageDetails code={v.code} row={v} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VillageDetails({ code, row }: { code: string; row: VillageRow }) {
  const [data, setData] = useState<VillageForecast | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    api.forecast(code).then(setData).catch((e) => setError(e.message));
  }, [code]);

  if (error) return <p className="px-3 pb-3 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="px-3 pb-3 text-sm text-slate-500">Loading forecast…</p>;
  return (
    <div className="space-y-2 px-3 pb-3">
      {data.risk.reasons.length > 0 && (
        <p className={`text-sm font-medium ${LEVEL[data.risk.level].text}`}>
          {LEVEL[data.risk.level].en}: {data.risk.reasons.map((r) => REASON[r].en).join(', ')}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {data.forecast.map((f, i) => {
          const lvl = data.risk.perDay[i]?.level ?? 'normal';
          return (
            <div key={f.date} className="rounded-lg bg-white p-2 text-xs ring-1 ring-slate-200" style={{ borderTop: `3px solid ${COLOUR[lvl]}` }}>
              <div className="font-medium">{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(f.date)}</div>
              <div className="mt-0.5">{CONDITION[f.condition] ?? f.condition}</div>
              <div>🌡 {Math.round(f.tempMinC ?? f.tempMaxC)}–{Math.round(f.tempMaxC)}°C</div>
              <div>💧 {f.rainMm >= 0.5 ? `${f.rainMm.toFixed(f.rainMm < 10 ? 1 : 0)} mm` : 'no rain'}</div>
            </div>
          );
        })}
      </div>
      {data.now && (
        <p className="rounded-lg bg-white p-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <b>Now in {data.now.province}</b> · {CONDITION[data.now.condition] ?? data.now.conditionText} · {Math.round(data.now.tempC)}°C
          {data.now.humidity != null && ` · 💧 ${data.now.humidity}%`}
          <span className="text-slate-400"> (DataEF, {fmtTime(data.now.observedAt)})</span>
        </p>
      )}
      <p className="text-xs text-slate-400">
        Forecast: Open-Meteo, {data.stale ? 'last updated' : 'updated'} {fmtTime(data.fetchedAt)}
        {row.approximateLocation && ' · map point = commune centre'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- compose alert (steps 2 + 3)
function ComposeDrawer({
  villages,
  onClose,
  onSent,
  notify,
}: {
  villages: VillageRow[];
  onClose: () => void;
  onSent: (msg: string) => void;
  notify: (t: string, k?: Toast['kind']) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'send'>('');
  const [confirming, setConfirming] = useState<number | null>(null);
  const codes = villages.map((v) => v.code);
  const reach = villages.reduce((a, v) => a + v.subscribers, 0);

  async function draft() {
    setBusy('draft');
    try {
      setText((await api.draft(codes)).text);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function askConfirm() {
    try {
      setConfirming((await api.preview(codes, text)).recipients);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  async function send() {
    setBusy('send');
    try {
      const r = await api.send(codes, text);
      const extra = [r.failed && `${r.failed} failed`, r.blocked && `${r.blocked} blocked the bot`].filter(Boolean).join(', ');
      onSent(`✅ Alert sent to ${r.sent} of ${r.recipients} farmer(s)${extra ? ` (${extra})` : ''}`);
    } catch (e) {
      notify(`❌ ${(e as Error).message}`, 'error');
      setBusy('');
      setConfirming(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h2 className="text-lg font-semibold">📢 Alert to farmers</h2>
            <p className="km text-sm text-slate-500">ផ្ញើការជូនដំណឹងទៅកសិករ</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section>
            <div className="mb-1 text-sm font-medium text-slate-700">Sending to</div>
            <div className="flex flex-wrap gap-1.5">
              {villages.map((v) => (
                <span key={v.code} className={`km rounded-full px-2.5 py-1 text-xs ring-1 ${LEVEL[levelOf(v)].soft}`}>
                  {v.nameKm} · 👥 {v.subscribers}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm">
              👥 Will reach <b>{reach}</b> registered farmer(s)
              {reach === 0 && <span className="text-amber-700"> – nobody has registered in these villages yet</span>}
            </p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">
                <span className="mr-1 inline-grid h-5 w-5 place-items-center rounded-full bg-emerald-700 text-xs text-white">2</span>
                Write the message
              </span>
              <button onClick={draft} disabled={!!busy} className="btn-chip">
                {busy === 'draft' ? '✨ Drafting…' : '✨ Let AI draft it'}
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder="សរសេរសារជាភាសាខ្មែរ… or tap “Let AI draft it” to start from the forecast"
              className="input km"
            />
            <p className="mt-1 text-xs text-slate-500">The AI draft uses only the forecast and the approved advice list. Check and edit it before sending.</p>
          </section>

          <section>
            <div className="mb-2 font-medium">
              <span className="mr-1 inline-grid h-5 w-5 place-items-center rounded-full bg-emerald-700 text-xs text-white">3</span>
              Preview on Telegram
            </div>
            <div className="rounded-2xl bg-[#e6ebee] p-3">
              <div className="km max-w-[90%] rounded-2xl rounded-tl-sm bg-white p-3 text-sm whitespace-pre-wrap shadow-sm">
                {text.trim() ? (
                  <>
                    📢 សារពីមន្ត្រីកសិកម្មឃុំ{'\n'}
                    {text.trim()}
                  </>
                ) : (
                  <span className="text-slate-400">Your message will appear here.</span>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="border-t border-slate-200 p-4">
          {confirming === null ? (
            <button className="btn-primary w-full" disabled={!text.trim() || !!busy} onClick={askConfirm}>
              Send to {reach} farmer(s) →
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                Send this alert to <b>{confirming}</b> farmer(s) in {villages.length} village(s)? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => setConfirming(null)} disabled={busy === 'send'}>
                  Back
                </button>
                <button className="btn-primary flex-1" onClick={send} disabled={busy === 'send'}>
                  {busy === 'send' ? 'Sending…' : '✅ Yes, send now'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- history
const TYPE: Record<string, { icon: string; label: string }> = {
  brief: { icon: '☀️', label: 'Morning brief' },
  weather_urgent: { icon: '🚨', label: 'Urgent weather' },
  fx: { icon: '💱', label: 'Exchange rate' },
  csx: { icon: '📈', label: 'Stock market' },
  officer: { icon: '📢', label: 'Officer alert' },
  news: { icon: '📰', label: 'Partner news' },
};

function History() {
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [type, setType] = useState<string>('all');
  useEffect(() => {
    api.alerts().then(setRows).catch(() => setRows([]));
  }, []);
  const types = [...new Set((rows ?? []).map((r) => r.type))];
  const shown = (rows ?? []).filter((r) => type === 'all' || r.type === type);
  const totals = shown.reduce((a, r) => ({ sent: a.sent + r.sent, failed: a.failed + r.failed + r.blocked }), { sent: 0, failed: 0 });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">🕘 Messages sent</h2>
            <p className="text-sm text-slate-500">
              {shown.length} message(s) · ✅ {totals.sent} delivered{totals.failed > 0 && ` · ❌ ${totals.failed} not delivered`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {['all', ...types].map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-full px-3 py-1 ring-1 ${type === t ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
              >
                {t === 'all' ? 'All' : `${TYPE[t]?.icon ?? ''} ${TYPE[t]?.label ?? t}`}
              </button>
            ))}
          </div>
        </div>
        {!rows && <p className="text-sm text-slate-500">Loading…</p>}
        {rows && !shown.length && (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Nothing sent yet. Alerts, briefs and announcements will appear here.
          </div>
        )}
        {shown.map((r) => (
          <article key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium">
                {TYPE[r.type]?.icon} {TYPE[r.type]?.label ?? r.type}
              </span>
              <span className="text-xs text-slate-500">{fmtTime(r.createdAt)}</span>
            </div>
            <p className="km mt-2 line-clamp-6 text-sm whitespace-pre-wrap">{r.textKm}</p>
            <div className="mt-2 flex gap-4 text-xs">
              <span className="text-emerald-700">✅ {r.sent} delivered</span>
              {r.failed + r.blocked > 0 && <span className="text-red-600">❌ {r.failed + r.blocked} not delivered</span>}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
