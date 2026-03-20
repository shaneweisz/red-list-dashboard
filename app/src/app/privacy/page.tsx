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

      <h1 className="mt-4 text-xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-xs text-zinc-400">Last updated: 20 March 2026</p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            What we collect
          </h2>
          <p>
            When you accept cookies, we collect anonymous usage analytics (page
            views, clicks, and feature usage) and may record your browsing
            session (clicks, scrolls, and navigation). We do <strong>not</strong>{" "}
            capture keystrokes, passwords, form inputs, or personal data.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Why we collect it
          </h2>
          <p>
            To understand how the dashboard is used, identify usability issues,
            and improve the experience. This is a research project at the
            University of Cambridge and the data is used solely for this purpose.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Third-party services
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <strong>PostHog</strong> (EU-hosted) — usage analytics and session
              recordings
            </li>
            <li>
              <strong>Vercel Analytics &amp; Speed Insights</strong> — page
              performance and Web Vitals
            </li>
            <li>
              <strong>Sentry</strong> — error tracking and diagnostics
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Cookies and storage
          </h2>
          <p>
            Your consent choice is saved in your browser&apos;s localStorage. If
            you accept analytics, PostHog may set cookies to distinguish
            returning visitors. No cookies are set if you decline.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Your choices
          </h2>
          <p>
            You can choose to accept all tracking (analytics and session
            recordings), analytics only, or decline entirely. You can change your
            choice at any time by clearing your browser&apos;s localStorage for
            this site and reloading the page.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Data retention
          </h2>
          <p>
            Analytics and session recording data is retained according to
            PostHog&apos;s default retention policy. Sentry retains error data
            for 90 days.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Contact
          </h2>
          <p>
            Questions or concerns? Contact{" "}
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
