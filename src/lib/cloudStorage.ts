import { supabase } from "./supabaseClient";
import type { Settings, WorkoutMap } from "./storage";

/**
 * Salviamo ANCHE in locale come cache/offline.
 * - Settings: gym.settings.v1 (già usato da storage.ts)
 * - Workouts: gym.workouts.v1 (già usato da storage.ts)
 *
 * Qui ci occupiamo solo del CLOUD + migrazione.
 */

export async function getUserIdOrThrow(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error("Utente non autenticato.");
  return uid;
}

/** ---------- SETTINGS (cloud) ---------- */

export async function loadSettingsCloud(): Promise<Settings | null> {
  const uid = await getUserIdOrThrow();

  const { data, error } = await supabase
    .from("user_settings")
    .select("workouts_per_week, selected_days, workout_time, quote_time")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    workoutsPerWeek: data.workouts_per_week,
    selectedDays: data.selected_days ?? [],
    workoutTime: data.workout_time,
    quoteTime: data.quote_time,
  };
}

export async function saveSettingsCloud(s: Settings): Promise<void> {
  const uid = await getUserIdOrThrow();

  const payload = {
    user_id: uid,
    workouts_per_week: s.workoutsPerWeek,
    selected_days: s.selectedDays,
    workout_time: s.workoutTime,
    quote_time: s.quoteTime,
  };

  const { error } = await supabase
    .from("user_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) throw error;
}

/** ---------- WORKOUTS (cloud) ---------- */

export async function loadWorkoutsCloud(): Promise<WorkoutMap> {
  const uid = await getUserIdOrThrow();

  const { data, error } = await supabase
    .from("user_workouts_weekly")
    .select("day_index, content")
    .eq("user_id", uid);

  if (error) throw error;

  const map: WorkoutMap = {};
  for (const row of data ?? []) {
    map[row.day_index] = row.content ?? "";
  }
  return map;
}

/**
 * Salva un singolo giorno (più efficiente quando scrivi nel textarea)
 */
export async function saveWorkoutDayCloud(dayIdx: number, content: string): Promise<void> {
  const uid = await getUserIdOrThrow();

  const payload = {
    user_id: uid,
    day_index: dayIdx,
    content: content ?? "",
  };

  const { error } = await supabase
    .from("user_workouts_weekly")
    .upsert(payload, { onConflict: "user_id,day_index" });

  if (error) throw error;
}

/**
 * Salva tutti i giorni (utile se vuoi fare “sync” massivo)
 */
export async function saveWorkoutsCloud(m: WorkoutMap): Promise<void> {
  const uid = await getUserIdOrThrow();

  const rows = Array.from({ length: 7 }).map((_, i) => ({
    user_id: uid,
    day_index: i,
    content: m[i] ?? "",
  }));

  const { error } = await supabase
    .from("user_workouts_weekly")
    .upsert(rows, { onConflict: "user_id,day_index" });

  if (error) throw error;
}

/** ---------- MIGRAZIONE: locale -> cloud ---------- */

/**
 * Se nel cloud NON c'è nulla ma in locale sì,
 * carichiamo locale nel cloud (prima sync).
 */
export async function migrateLocalToCloudIfEmpty(localSettings: Settings | null, localWorkouts: WorkoutMap): Promise<void> {
  // settings cloud?
  const cloudSettings = await loadSettingsCloud();

  // workouts cloud?
  const cloudWorkouts = await loadWorkoutsCloud();
  const cloudWorkoutsCount = Object.values(cloudWorkouts).filter((t) => (t ?? "").trim().length > 0).length;

  const localWorkoutsCount = Object.values(localWorkouts ?? {}).filter((t) => (t ?? "").trim().length > 0).length;

  // Se cloud è vuoto e locale ha dati: migra
  const cloudHasSomething =
    !!cloudSettings ||
    cloudWorkoutsCount > 0;

  const localHasSomething =
    !!localSettings ||
    localWorkoutsCount > 0;

  if (!cloudHasSomething && localHasSomething) {
    if (localSettings) await saveSettingsCloud(localSettings);
    if (localWorkouts) await saveWorkoutsCloud(localWorkouts);
  }
}
