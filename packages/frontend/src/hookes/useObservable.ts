import { useEffect, useState } from "react";
import type { Observable } from "rxjs";

/** Subscribes to an API's `state` observable and returns its latest value. */
export default function useObservable<T>(obs: Observable<T> | undefined) {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!obs) return;
    const sub = obs.subscribe({
      next: setValue,
      error: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
    return () => sub.unsubscribe();
  }, [obs]);
  return { value, error };
}
