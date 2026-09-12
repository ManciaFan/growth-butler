"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./cloud";

export function useCloudResource<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [resolved, setResolved] = useState<{ loader: typeof loader } | null>(
    null,
  );
  const sequence = useRef(0);
  const fetchData = useCallback(() => {
    const current = ++sequence.current;
    return Promise.resolve()
      .then(loader)
      .then((value) => {
        if (current === sequence.current) {
          setData(value);
          setError("");
          setVersion((value) => value + 1);
        }
      })
      .catch((cause) => {
        if (current === sequence.current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (current === sequence.current) {
          setLoading(false);
          setResolved({ loader });
        }
      });
  }, [loader]);
  const cancel = useCallback(() => {
    sequence.current++;
  }, []);
  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchData();
  }, [fetchData]);
  useEffect(() => {
    void fetchData();
    return cancel;
  }, [fetchData, cancel]);
  return {
    data,
    setData,
    loading: loading || resolved?.loader !== loader,
    error,
    reload,
    version,
  };
}
