import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — IUCN Red List Dashboard",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        &larr; Back to dashboard
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Privacy</h1>
      <p className="mt-1 text-xs text-zinc-400">Last updated: 20 March 2026</p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        <p>
          This dashboard is a research project at the University of Cambridge.
          It displays public IUCN Red List and GBIF data. We do not collect
          personal data, require sign-in, or use forms.
        </p>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Analytics
          </h2>
          <p>
            If you accept cookies, we use{" "}
            <strong>PostHog</strong> (EU-hosted) to collect anonymous usage
            analytics — page views, clicks, and feature usage — to help us
            understand how the dashboard is used and improve it. No data is sent
            to PostHog until you consent. No personal data, keystrokes, or form
            inputs are captured.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Other services
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel Analytics &amp; Speed Insights</strong> — anonymous,
              cookieless performance metrics.
            </li>
            <li>
              <strong>Sentry</strong> (EU-hosted) — error reports to help us fix
              bugs.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Your choices
          </h2>
          <p>
            You can accept or decline analytics cookies via the banner on your
            first visit, and change your choice any time using the{" "}
            <strong>Cookie settings</strong> link in the footer.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Contact
          </h2>
          <p>
            Questions? Contact{" "}
            <a
              href="mailto:sw984@cam.ac.uk"
              className="underline hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              sw984@cam.ac.uk
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
