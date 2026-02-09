export type Settings = {
  workoutsPerWeek: number;        // 1..7
  selectedDays: number[];         // 0=Mon ... 6=Sun
  workoutTime: string;            // "18:00"
  quoteTime: string;              // "09:00"
};

export type WorkoutMap = Record<number, string>; // dayIndex -> text

const KEY_SETTINGS = "gym.settings.v1";
const KEY_WORKOUTS = "gym.workouts.v1";

export function loadSettings(): Settings | null {
  const raw = localStorage.getItem(KEY_SETTINGS);
  if (!raw) return null;
  try { return JSON.parse(raw) as Settings; } catch { return null; }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

export function resetAll() {
  localStorage.removeItem(KEY_SETTINGS);
  localStorage.removeItem(KEY_WORKOUTS);
}

export function loadWorkouts(): WorkoutMap {
  const raw = localStorage.getItem(KEY_WORKOUTS);
  if (!raw) return {};
  try { return JSON.parse(raw) as WorkoutMap; } catch { return {}; }
}

export function saveWorkouts(m: WorkoutMap) {
  localStorage.setItem(KEY_WORKOUTS, JSON.stringify(m));
}
