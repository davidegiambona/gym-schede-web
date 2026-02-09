import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { NATIONALITIES } from "./lib/nationalities";

type PendingProfile = {
  email: string;
  first_name: string;
  last_name: string;
  birth_date: string;     // YYYY-MM-DD
  nationality: string;
  created_at: number;
};

const PENDING_KEY = "gym.pendingProfile.v1";

function savePendingProfile(p: PendingProfile) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

function loadPendingProfile(): PendingProfile | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingProfile;
  } catch {
    return null;
  }
}

function clearPendingProfile() {
  localStorage.removeItem(PENDING_KEY);
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  // Se c'è un profilo pending e ora siamo loggati, prova a scriverlo su Supabase
  async function tryFlushPendingProfile(currentSession: any) {
    const pending = loadPendingProfile();
    const uid = currentSession?.user?.id;
    const email = currentSession?.user?.email;

    if (!pending || !uid || !email) return;

    // Se il pending è di un'altra email, non fare nulla
    if (pending.email.toLowerCase() !== String(email).toLowerCase()) return;

    const payload = {
      id: uid,
      email,
      first_name: pending.first_name,
      last_name: pending.last_name,
      birth_date: pending.birth_date,
      nationality: pending.nationality,
    };

    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
    if (!error) clearPendingProfile();
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) await tryFlushPendingProfile(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      setLoading(false);
      if (s) await tryFlushPendingProfile(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="container"><div className="card">Caricamento…</div></div>;
  if (!session) return <AuthScreen />;

  return <>{children}</>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // profilo
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState(""); // YYYY-MM-DD
  const [nationality, setNationality] = useState("");

  // dropdown scorrevole + ricerca
  const [countryQuery, setCountryQuery] = useState("");
  const filteredNationalities = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return NATIONALITIES;
    return NATIONALITIES.filter(x => x.toLowerCase().includes(q));
  }, [countryQuery]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function validateCommon() {
    if (!email.includes("@")) throw new Error("Inserisci una email valida.");
    if (password.length < 6) throw new Error("Password minimo 6 caratteri.");
  }

  function validateProfile() {
    if (!firstName.trim()) throw new Error("Inserisci il nome.");
    if (!lastName.trim()) throw new Error("Inserisci il cognome.");
    if (!birthDate) throw new Error("Inserisci la data di nascita.");
    if (!nationality) throw new Error("Seleziona una nazionalità.");
  }

  async function upsertProfileForLoggedUser() {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    const userEmail = u.user?.email;
    if (!uid || !userEmail) return;

    const payload = {
      id: uid,
      email: userEmail,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      birth_date: birthDate,
      nationality,
    };

    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
    if (error) throw error;
  }

  async function signup() {
    validateCommon();
    validateProfile();

    // SALVIAMO SEMPRE pending, così anche con conferma email ON non perdi dati
    savePendingProfile({
      email: email.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      birth_date: birthDate,
      nationality,
      created_at: Date.now(),
    });

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // opzionale: redirect al tuo dominio quando confermi (lo metteremo quando hostiamo)
      // options: { emailRedirectTo: window.location.origin }
    });

    if (error) throw error;

    // Se Supabase ti dà una sessione già valida (dipende dalle impostazioni), allora scriviamo subito anche su DB
    if (data.session) {
      try {
        await upsertProfileForLoggedUser();
        clearPendingProfile();
      } catch {
        // Se fallisce, va bene: verrà scritto al primo login (pending è già salvato)
      }
    }

    setMsg(
      "Account creato! Se la conferma email è attiva, controlla la mail e poi fai login. " +
      "I dati del profilo verranno salvati automaticamente al primo accesso."
    );
    setMode("signin");
  }

  async function signin() {
    validateCommon();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) throw error;

    // Dopo login sei autenticato: se esiste pending per questa email, scrivilo su profiles
    const pending = loadPendingProfile();
    const uid = data.user?.id;
    const userEmail = data.user?.email;

    if (pending && uid && userEmail && pending.email.toLowerCase() === userEmail.toLowerCase()) {
      const payload = {
        id: uid,
        email: userEmail,
        first_name: pending.first_name,
        last_name: pending.last_name,
        birth_date: pending.birth_date,
        nationality: pending.nationality,
      };
      const { error: upErr } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (!upErr) clearPendingProfile();
    }

    // Se l’utente ha compilato i campi anche in questa schermata (caso raro), aggiorniamo comunque
    if (uid && (firstName || lastName || birthDate || nationality)) {
      try {
        await upsertProfileForLoggedUser();
      } catch {
        // non blocchiamo il login
      }
    }
  }

  async function submit() {
    setMsg("");
    setBusy(true);
    try {
      if (mode === "signup") await signup();
      else await signin();
    } catch (e: any) {
      const m = String(e?.message ?? "Errore");
      if (m.toLowerCase().includes("email not confirmed")) {
        setMsg("Email non confermata: conferma dalla mail oppure disattiva la conferma nelle impostazioni Supabase.");
      } else {
        setMsg(m);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="cardHeader">
          <div>
            <div className="title">{mode === "signin" ? "Accedi" : "Crea account"}</div>
            <div className="muted">Sincronizza schede e calendario su tutti i dispositivi.</div>
          </div>
          <div className="row">
            <button className={"btn " + (mode === "signin" ? "btnPrimary" : "")} disabled={busy} onClick={() => setMode("signin")}>
              Login
            </button>
            <button className={"btn " + (mode === "signup" ? "btnPrimary" : "")} disabled={busy} onClick={() => setMode("signup")}>
              Signup
            </button>
          </div>
        </div>

        <div className="sep" />

        {mode === "signup" ? (
          <>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="title">Nome</div>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Es. Davide" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="title">Cognome</div>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Es. Giambona" />
              </div>
            </div>

            <div className="sep" />

            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="title">Data di nascita</div>
                <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="title">Nazionalità</div>
                <input
                  className="input"
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  placeholder="Cerca… (es. Ita, Spa, Fra)"
                  style={{ marginBottom: 10 }}
                />
                <select
                  className="input"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  size={6}
                  style={{ padding: 10 }}
                >
                  <option value="" disabled>Seleziona…</option>
                  {filteredNationalities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sep" />
          </>
        ) : null}

        <div className="title">Email</div>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" />

        <div className="sep" />

        <div className="title">Password</div>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

        {msg ? <div className="muted" style={{ marginTop: 10 }}>{msg}</div> : null}

        <div className="sep" />

        <button className="btn btnPrimary" style={{ width: "100%" }} disabled={busy} onClick={submit}>
          {busy ? "Attendi…" : (mode === "signin" ? "Accedi" : "Crea account")}
        </button>
      </div>
    </div>
  );
}
