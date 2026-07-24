"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "@/lib/auth/actions";

export function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { email: null }))
      .then((data: { email: string | null }) => {
        if (!cancelled) {
          setEmail(data.email);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return <span className="w-14 h-8" aria-hidden="true" />;
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        Sign in
      </Link>
    );
  }

  return (
    <form action={signOut} className="flex items-center gap-2">
      <span
        className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[10rem]"
        title={email}
      >
        {email}
      </span>
      <button
        type="submit"
        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
