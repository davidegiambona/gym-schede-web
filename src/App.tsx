import { useEffect, useMemo, useRef, useState } from "react";
import { dayNames, dayNamesLong, todayIndex } from "./lib/dates";
import {
  loadSettings,
  saveSettings,
  resetAll,
  loadWorkouts,
  saveWorkouts,
} from "./lib/storage";
import type { Settings, WorkoutMap } from "./lib/storage";
import { fetchQuote } from "./lib/quotes";
import {
  startOfWeekMonday,
  addDays,
  formatDDMM,
  isSameDay,
  weekdayIndexMon0,
} from "./lib/calendar";
import { nowHHMM } from "./lib/time";
import { supabase } from "./lib/supabaseClient";
import {
  loadSettingsCloud,
  saveSettingsCloud,
  loadWorkoutsCloud,
  saveWorkoutDayCloud,
  migrateLocalToCloudIfEmpty,
} from "./lib/cloudStorage";

type Tab = "home" | "calendar" | "settings";
type View = "home" | "day" | "settings";

function capFirst(s: string) {
  const t = (s || "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View>("home");
  const [activeDay, setActiveDay] = useState<number>(todayIndex());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());

  // Local state (UI)
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutMap>({});
  const [quote, setQuote] = useState<string>("");

  const [banner, setBanner] = useState<string>("");
  const [notifEnabled, setNotifEnabled] = useState<boolean>(false);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);

  // Auth/Profile
  const [userEmail, setUserEmail] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");

  // Cloud status
  const [cloudReady, setCloudReady] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string>("");

  // Debounce per salvataggio cloud mentre scrivi
  const saveTimer = useRef<number | null>(null);
  const lastSavedRef = useRef<{ dayIdx: number; text: string } | null>(null);

  function navigate(to: Tab) {
    setTab(to);
    setView("home"); // chiude editor se aperto
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  // 1) Load LOCAL (immediato) per far vedere subito qualcosa
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setWorkouts(loadWorkouts());
  }, []);

  // 2) Carica email + first_name da profiles
  useEffect(() => {
    let cancelled = false;

    async function loadProfileFirstName() {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;

      if (!uid) {
        if (!cancelled) setFirstName("");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", uid)
        .single();

      if (error || !data) {
        if (!cancelled) setFirstName("");
        return;
      }

      const fn = capFirst(String(data.first_name ?? ""));
      if (!cancelled) setFirstName(fn);
    }

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setUserEmail(data.user?.email ?? "");
      await loadProfileFirstName();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setUserEmail(session?.user?.email ?? "");
      loadProfileFirstName();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 3) Sync CLOUD: carica settings+workouts da Supabase + migrazione locale->cloud
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setCloudError("");

      try {
        // Migra locale -> cloud se cloud vuoto
        const localS = loadSettings();
        const localW = loadWorkouts();
        await migrateLocalToCloudIfEmpty(localS, localW);

        // Ora carica dal cloud come sorgente principale
        const cs = await loadSettingsCloud();
        const cw = await loadWorkoutsCloud();

        if (cancelled) return;

        if (cs) {
          setSettings(cs);
          saveSettings(cs); // cache locale
        }

        setWorkouts(cw);
        saveWorkouts(cw); // cache locale

        setCloudReady(true);
      } catch (e: any) {
        if (cancelled) return;
        setCloudError(String(e?.message ?? "Errore cloud"));
        // resta comunque con locale
        setCloudReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Quote on load
  useEffect(() => {
    (async () => {
      try {
        setQuoteLoading(true);
        const q = await fetchQuote();
        setQuote(q);
      } finally {
        setQuoteLoading(false);
      }
    })();
  }, []);

  // Notifiche browser (solo mentre l'app è aperta)
  useEffect(() => {
    const supported = typeof window !== "undefined" && "Notification" in window;
    if (!supported) return;
    setNotifEnabled(Notification.permission === "granted");
  }, []);

  const isConfigured = !!settings;
  const selectedSet = useMemo(() => new Set(settings?.selectedDays ?? []), [settings]);

  async function refreshQuote() {
    try {
      setQuoteLoading(true);
      const q = await fetchQuote(quote);
      setQuote(q);
    } finally {
      setQuoteLoading(false);
    }
  }

  // Promemoria “smart”: aggiorna ogni 20s
  useEffect(() => {
    if (!settings) return;

    const tick = async () => {
      const now = nowHHMM();
      const today = todayIndex();
      const isWorkoutDay = selectedSet.has(today);

      const lines: string[] = [];
      lines.push(
        isWorkoutDay
          ? `Oggi allenamento • ore ${settings.workoutTime}`
          : `Oggi riposo • prossima volta alle ${settings.workoutTime}`
      );
      lines.push(`Motivazione • ore ${settings.quoteTime}`);
      setBanner(lines.join(" — "));

      if ("Notification" in window && Notification.permission === "granted") {
        if (now === settings.quoteTime) {
          const q = await fetchQuote(quote);
          setQuote(q);
          new Notification("Motivazione 💪", { body: q });
        }
        if (now === settings.workoutTime && isWorkoutDay) {
          const txt = (workouts[today] ?? "").trim();
          new Notification("Allenamento di oggi", {
            body: txt ? (txt.length > 140 ? txt.slice(0, 140) + "…" : txt) : "Apri l’app e compila la scheda.",
          });
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 20000);
    return () => window.clearInterval(id);
  }, [settings, selectedSet, workouts, quote]);

  const todayIsWorkout = isConfigured ? selectedSet.has(todayIndex()) : false;

  function goDay(d: number) {
    setActiveDay(d);
    setView("day");
  }

  // Salvataggio workout: locale subito + cloud in debounce
  function updateWorkoutText(dayIdx: number, text: string) {
    const next = { ...workouts, [dayIdx]: text };
    setWorkouts(next);
    saveWorkouts(next); // cache locale

    lastSavedRef.current = { dayIdx, text };

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const last = lastSavedRef.current;
        if (!last) return;
        await saveWorkoutDayCloud(last.dayIdx, last.text);
        setCloudReady(true);
      } catch {
        // se fallisce, resta in locale e riproveremo al prossimo salvataggio
      }
    }, 450);
  }

  async function saveSettingsBoth(s: Settings) {
    setSettings(s);
    saveSettings(s); // locale
    try {
      await saveSettingsCloud(s);
      setCloudReady(true);
    } catch {
      // fallisce? resta locale
    }
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) {
      alert("Notifiche non supportate in questo browser.");
      return;
    }
    const res = await Notification.requestPermission();
    setNotifEnabled(res === "granted");
  }

  const weekStart = startOfWeekMonday(weekAnchor);
  const weekDates = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));
  const selDateWeekdayIdx = weekdayIndexMon0(selectedDate);
  const selIsWorkoutDay = isConfigured ? selectedSet.has(selDateWeekdayIdx) : false;
  const selTextPreview = (workouts[selDateWeekdayIdx] ?? "").trim();

  const fallbackName = userEmail ? capFirst(userEmail.split("@")[0]) : "";
  const nameToShow = firstName || fallbackName;
  const welcome = nameToShow ? `Benvenuto, ${nameToShow}!` : "";

  return (
    <div className={"container hasTabbar"}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" />
          <div>
            <div className="h1">Gym Schede</div>
            <div className="sub">Calendario interno • schede settimanali • motivazione</div>

            {welcome ? (
              <div className="sub" style={{ marginTop: 4 }}>
                <span style={{ fontWeight: 900, color: "rgba(255,255,255,0.92)" }}>{welcome}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="row">
          <button className="btn" disabled={quoteLoading} onClick={refreshQuote}>
            {quoteLoading ? "Caricamento..." : "Nuova frase"}
          </button>

          <button className="btn" onClick={() => navigate("home")}>Home</button>
          <button className="btn" onClick={() => navigate("calendar")}>Calendario</button>
          <button className="btn" onClick={() => navigate("settings")}>Impostazioni</button>

          <button className="btn" onClick={logout}>Logout</button>
        </div>
      </header>

      {cloudError ? (
        <div className="banner" style={{ borderColor: "rgba(255,80,80,0.35)" }}>
          <div>
            <div className="bannerTitle">Sync cloud</div>
            <div className="bannerText">Errore cloud: {cloudError} (sto usando i dati locali)</div>
          </div>
          <span className="badge">Offline/Locale</span>
        </div>
      ) : null}

      {isConfigured && banner ? (
        <div className="banner">
          <div>
            <div className="bannerTitle">Promemoria</div>
            <div className="bannerText">{banner}</div>
          </div>
          <div className="row">
            {"Notification" in window ? (
              notifEnabled ? (
                <span className="badge">Notifiche ON</span>
              ) : (
                <button className="btn btnPrimary" onClick={enableBrowserNotifications}>
                  Abilita notif.
                </button>
              )
            ) : (
              <span className="badge">Notifiche non supportate</span>
            )}
            <span className="badge">{cloudReady ? "Sync: Supabase" : "Sync: Locale"}</span>
          </div>
        </div>
      ) : null}

      {!isConfigured ? (
        <Onboarding
          onDone={(s) => {
            saveSettingsBoth(s);
            navigate("home");
          }}
        />
      ) : (
        <>
          {tab === "home" ? (
            <div className="grid" style={{ marginTop: 14 }}>
              <section className="card">
                <div className="cardHeader">
                  <div>
                    <div className="title">Settimana</div>
                    <div className="muted">Tocca un giorno per aprire la scheda. I giorni di allenamento sono evidenziati.</div>
                  </div>
                  <span className="badge">Oggi: {dayNamesLong[todayIndex()]}</span>
                </div>

                <div className="sep" />

                <div className="week">
                  {Array.from({ length: 7 }).map((_, i) => {
                    const isSel = selectedSet.has(i);
                    const isToday = i === todayIndex();
                    const preview = (workouts[i] ?? "").trim();

                    return (
                      <div
                        key={i}
                        className="dayCell"
                        onClick={() => goDay(i)}
                        role="button"
                        aria-label={`Apri ${dayNamesLong[i]}`}
                        style={{ outline: isToday ? "2px solid rgba(34,197,94,0.35)" : "none" }}
                      >
                        <div className="dayTop">
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div style={{ fontWeight: 700 }}>{dayNames[i]}</div>
                            {isSel ? <span className="dot" /> : null}
                          </div>
                          <span className="badge">{isSel ? "Allen." : "Riposo"}</span>
                        </div>

                        <div className="small">
                          {preview ? (preview.length > 60 ? preview.slice(0, 60) + "…" : preview) : "Scheda vuota"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <aside className="card">
                <div className="cardHeader">
                  <div>
                    <div className="title">Oggi</div>
                    <div className="muted">
                      {todayIsWorkout
                        ? "È un giorno di allenamento: apri la scheda e segui la tua lista."
                        : "Giorno di riposo: recupero e alimentazione contano."}
                    </div>
                  </div>
                  <button className="btn btnPrimary" onClick={() => goDay(todayIndex())}>
                    Apri oggi
                  </button>
                </div>

                <div className="sep" />

                <div className="title">Motivazione</div>
                <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                  {quote || "Caricamento..."}
                </div>

                <div className="sep" />

                <div className="title">Vai al calendario</div>
                <div className="muted" style={{ marginTop: 10 }}>
                  Se vuoi scorrere le settimane e scegliere una data, usa la tab “Calendario”.
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => navigate("calendar")}>Calendario</button>
                </div>
              </aside>
            </div>
          ) : null}

          {tab === "calendar" ? (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="cardHeader">
                <div>
                  <div className="title">Calendario</div>
                  <div className="muted">Scorri le settimane e seleziona un giorno.</div>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>←</button>
                  <button className="btn" onClick={() => setWeekAnchor(new Date())}>Oggi</button>
                  <button className="btn" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>→</button>
                </div>
              </div>

              <div className="sep" />

              <div className="week">
                {weekDates.map((d, i) => {
                  const isToday = isSameDay(d, new Date());
                  const isPicked = isSameDay(d, selectedDate);
                  const isWorkout = selectedSet.has(i);

                  return (
                    <div
                      key={d.toISOString()}
                      className="dayCell"
                      onClick={() => setSelectedDate(d)}
                      role="button"
                      style={{
                        outline: isPicked
                          ? "2px solid rgba(34,197,94,0.55)"
                          : isToday
                          ? "2px solid rgba(34,197,94,0.25)"
                          : "none",
                      }}
                    >
                      <div className="dayTop">
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>{dayNames[i]}</div>
                          {isWorkout ? <span className="dot" /> : null}
                        </div>
                        <span className="badge">{formatDDMM(d)}</span>
                      </div>
                      <div className="small">{isWorkout ? "Allenamento" : "Riposo"}</div>
                    </div>
                  );
                })}
              </div>

              <div className="sep" />

              <div className="card" style={{ padding: 14, margin: 0, background: "rgba(255,255,255,0.03)" }}>
                <div className="cardHeader">
                  <div>
                    <div className="title">
                      {dayNamesLong[selDateWeekdayIdx]} • {formatDDMM(selectedDate)} —{" "}
                      {selIsWorkoutDay ? "Allenamento" : "Riposo"}
                    </div>
                    <div className="muted">
                      Scheda associata al giorno della settimana (sincronizzata). In futuro possiamo aggiungere schede “per data”.
                    </div>
                  </div>
                  <button className="btn btnPrimary" onClick={() => goDay(selDateWeekdayIdx)}>
                    Apri scheda
                  </button>
                </div>

                <div className="sep" />

                <div className="muted" style={{ fontSize: 13 }}>
                  {selTextPreview ? selTextPreview : "Scheda vuota. Apri la scheda e scrivi gli esercizi."}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "settings" ? (
            <SettingsScreen
              settings={settings!}
              onSave={(s) => {
                saveSettingsBoth(s);
                navigate("home");
              }}
              onReset={() => {
                resetAll();
                setSettings(null);
                setWorkouts({});
                navigate("home");
              }}
            />
          ) : null}
        </>
      )}

      {isConfigured && view === "day" ? (
        <DayEditor
          dayIdx={activeDay}
          selected={selectedSet.has(activeDay)}
          text={workouts[activeDay] ?? ""}
          onBack={() => setView("home")}
          onChange={(t) => updateWorkoutText(activeDay, t)}
        />
      ) : null}

      {isConfigured ? <MobileTabbar tab={tab} onTab={navigate} /> : null}

      <Footer cloudReady={cloudReady} />
    </div>
  );
}

function MobileTabbar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="tabbar">
      <div className="tabbarInner">
        <button className={"tab " + (tab === "home" ? "tabOn" : "")} onClick={() => onTab("home")}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {tab === "home" ? <span className="tabDot" /> : null}
            <span>Home</span>
          </div>
        </button>
        <button className={"tab " + (tab === "calendar" ? "tabOn" : "")} onClick={() => onTab("calendar")}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {tab === "calendar" ? <span className="tabDot" /> : null}
            <span>Calendario</span>
          </div>
        </button>
        <button className={"tab " + (tab === "settings" ? "tabOn" : "")} onClick={() => onTab("settings")}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {tab === "settings" ? <span className="tabDot" /> : null}
            <span>Impostazioni</span>
          </div>
        </button>
      </div>
    </div>
  );
}

function Footer({ cloudReady }: { cloudReady: boolean }) {
  const links = {
    github: "https://github.com/davidegiambona",
    instagram: "https://instagram.com/davide_giambona",
    email: "mailto:dgiambona82@gmail.com",
    portfolio: "https://davidegiambona.github.io/personal-portfolio/",
  };

  return (
    <footer className="footer">
      <div className="footerInner">
        <div>
          <div className="footerTitle">Gym Schede</div>
          <div className="footerText">
            Webapp responsive per schede settimanali e calendario interno.<br />
            {cloudReady ? "Dati sincronizzati su Supabase." : "Sync in corso (cache locale attiva)."}
          </div>
        </div>

        <div className="footerLinks">
          <a className="iconLink" href={links.github} target="_blank" rel="noreferrer">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <a className="iconLink" href={links.instagram} target="_blank" rel="noreferrer">
            <InstagramIcon />
            <span>Instagram</span>
          </a>
          <a className="iconLink" href={links.email}>
            <MailIcon />
            <span>Email</span>
          </a>
          <a className="iconLink" href={links.portfolio} target="_blank" rel="noreferrer">
            <LinkIcon />
            <span>Portfolio</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

function Onboarding({ onDone }: { onDone: (s: Settings) => void }) {
  const [workoutsPerWeek, setWorkoutsPerWeek] = useState(3);
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 2, 4]);
  const [workoutTime, setWorkoutTime] = useState("18:00");
  const [quoteTime, setQuoteTime] = useState("09:00");

  function toggleDay(d: number) {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function submit() {
    if (selectedDays.length === 0) {
      alert("Seleziona almeno un giorno.");
      return;
    }
    onDone({ workoutsPerWeek, selectedDays, workoutTime, quoteTime });
  }

  return (
    <div className="grid" style={{ marginTop: 14 }}>
      <section className="card">
        <div className="title">Benvenuto 👋</div>
        <div className="muted">Impostiamo la tua settimana in 30 secondi.</div>

        <div className="sep" />

        <div className="title">Quanti allenamenti a settimana?</div>
        <div className="muted">Da 1 a 7. (È solo un’informazione, i giorni li scegli sotto.)</div>

        <input
          className="input"
          type="number"
          min={1}
          max={7}
          value={workoutsPerWeek}
          onChange={(e) => setWorkoutsPerWeek(Math.min(7, Math.max(1, Number(e.target.value || 1))))}
          style={{ marginTop: 10 }}
        />

        <div className="sep" />

        <div className="title">Scegli i giorni</div>
        <div className="row" style={{ marginTop: 10 }}>
          {dayNamesLong.map((n, i) => (
            <div
              key={i}
              className={"pill " + (selectedDays.includes(i) ? "pillOn" : "")}
              onClick={() => toggleDay(i)}
              role="button"
            >
              {n}
            </div>
          ))}
        </div>

        <div className="sep" />

        <div className="row">
          <div style={{ flex: 1 }}>
            <div className="title">Ora promemoria allenamento</div>
            <input className="input" type="time" value={workoutTime} onChange={(e) => setWorkoutTime(e.target.value)} />
          </div>

          <div style={{ flex: 1 }}>
            <div className="title">Ora motivazione</div>
            <input className="input" type="time" value={quoteTime} onChange={(e) => setQuoteTime(e.target.value)} />
          </div>
        </div>

        <div className="sep" />

        <button className="btn btnPrimary" onClick={submit}>
          Crea il mio calendario
        </button>
      </section>

      <aside className="card">
        <div className="title">Cosa otterrai</div>
        <div className="muted" style={{ marginTop: 10 }}>
          • Calendario interno settimanale<br />
          • Schede testuali per ogni giorno<br />
          • Motivazione dal web<br />
          • Sync multi-dispositivo con Supabase
        </div>

        <div className="sep" />

        <div className="muted">
          Dopo la creazione puoi aprire ogni giorno e scrivere gli esercizi (panca, squat, ecc.).
        </div>
      </aside>
    </div>
  );
}

function DayEditor(props: {
  dayIdx: number;
  selected: boolean;
  text: string;
  onBack: () => void;
  onChange: (t: string) => void;
}) {
  return (
    <div className="modalBackdrop" onClick={props.onBack} role="dialog" aria-modal="true">
      <div className="modalSheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetHandle" />

        <div className="cardHeader" style={{ padding: "12px 14px" }}>
          <div>
            <div className="title">
              {dayNamesLong[props.dayIdx]} — {props.selected ? "Allenamento" : "Riposo"}
            </div>
            <div className="muted">Scrivi la scheda del giorno. Salva automaticamente.</div>
          </div>
          <button className="btn" onClick={props.onBack}>
            Chiudi
          </button>
        </div>

        <div className="sep" />

        <div className="modalBody">
          <textarea
            value={props.text}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={"Esempio:\n- Panca 4x8\n- Squat 4x6\n- Trazioni 3x max\n- Addome 3x12"}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsScreen(props: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onReset: () => void;
}) {
  const [s, setS] = useState<Settings>(props.settings);

  function toggleDay(d: number) {
    setS((prev) => ({
      ...prev,
      selectedDays: prev.selectedDays.includes(d)
        ? prev.selectedDays.filter((x) => x !== d)
        : [...prev.selectedDays, d].sort(),
    }));
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="cardHeader">
        <div>
          <div className="title">Impostazioni</div>
          <div className="muted">Modifica i tuoi giorni e orari.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => props.onReset()}>
            Reset
          </button>
          <button className="btn btnPrimary" onClick={() => props.onSave(s)}>
            Salva
          </button>
        </div>
      </div>

      <div className="sep" />

      <div className="title">Allenamenti a settimana</div>
      <input
        className="input"
        type="number"
        min={1}
        max={7}
        value={s.workoutsPerWeek}
        onChange={(e) =>
          setS((prev) => ({
            ...prev,
            workoutsPerWeek: Math.min(7, Math.max(1, Number(e.target.value || 1))),
          }))
        }
        style={{ marginTop: 10 }}
      />

      <div className="sep" />

      <div className="title">Giorni selezionati</div>
      <div className="row" style={{ marginTop: 10 }}>
        {dayNamesLong.map((n, i) => (
          <div
            key={i}
            className={"pill " + (s.selectedDays.includes(i) ? "pillOn" : "")}
            onClick={() => toggleDay(i)}
            role="button"
          >
            {n}
          </div>
        ))}
      </div>

      <div className="sep" />

      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="title">Ora promemoria allenamento</div>
          <input
            className="input"
            type="time"
            value={s.workoutTime}
            onChange={(e) => setS((prev) => ({ ...prev, workoutTime: e.target.value }))}
          />
        </div>

        <div style={{ flex: 1 }}>
          <div className="title">Ora motivazione</div>
          <input
            className="input"
            type="time"
            value={s.quoteTime}
            onChange={(e) => setS((prev) => ({ ...prev, quoteTime: e.target.value }))}
          />
        </div>
      </div>

      <div className="sep" />

      <div className="muted">
        Nota: le notifiche “vere” in background richiedono push + server. Qui puoi abilitarle quando l’app è aperta.
      </div>
    </div>
  );
}

/* ===== Footer Icons (SVG) ===== */

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.77.6-3.35-1.18-3.35-1.18-.45-1.13-1.1-1.44-1.1-1.44-.9-.62.07-.6.07-.6 1 .07 1.52 1.03 1.52 1.03.9 1.52 2.36 1.08 2.94.83.09-.65.35-1.08.63-1.33-2.21-.25-4.54-1.1-4.54-4.9 0-1.08.39-1.97 1.03-2.66-.1-.26-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.8c.85 0 1.71.12 2.51.34 1.9-1.29 2.74-1.02 2.74-1.02.56 1.38.21 2.39.1 2.65.64.69 1.03 1.58 1.03 2.66 0 3.8-2.34 4.65-4.57 4.89.36.31.68.92.68 1.86v2.75c0 .26.18.57.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3z" />
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
      <path d="M18 6.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm2 0 6 5 6-5H6zm12 2.2-6 5-6-5V18h12V8.2z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10.6 13.4a1 1 0 0 1 0-1.4l3-3a1 1 0 1 1 1.4 1.4l-3 3a1 1 0 0 1-1.4 0z" />
      <path d="M8.5 17.5a4 4 0 0 1 0-5.7l2-2a1 1 0 1 1 1.4 1.4l-2 2a2 2 0 1 0 2.8 2.8l2-2a1 1 0 0 1 1.4 1.4l-2 2a4 4 0 0 1-5.6 0z" />
      <path d="M15.5 6.5a4 4 0 0 1 0 5.7l-2 2a1 1 0 1 1-1.4-1.4l2-2a2 2 0 1 0-2.8-2.8l-2 2A1 1 0 1 1 7.9 8.6l2-2a4 4 0 0 1 5.6 0z" />
    </svg>
  );
}
