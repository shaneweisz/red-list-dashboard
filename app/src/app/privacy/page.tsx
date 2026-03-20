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
            Data controller
          </h2>
          <p>
            This dashboard is operated by Shane Weisz as part of a PhD research
            project at the University of Cambridge. For the purposes of
            applicable data protection law, Shane Weisz is the data controller.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Legal basis for processing
          </h2>
          <p>
            We process personal data on the basis of your <strong>consent</strong>{" "}
            (Article 6(1)(a) GDPR). No data is collected by PostHog until you
            explicitly accept cookies via the consent banner. Sentry and Vercel
            Analytics operate under our <strong>legitimate interest</strong>{" "}
            (Article 6(1)(f) GDPR) in maintaining site reliability and
            performance — these services collect minimal, non-identifying
            technical data.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            What we collect
          </h2>
          <p>
            If you accept cookies, we collect anonymous usage analytics via
            PostHog: page views, clicks, and feature usage. We do{" "}
            <strong>not</strong> capture keystrokes, passwords, form inputs, or
            personal data. No data is sent to PostHog until you consent.
          </p>
          <p className="mt-2">
            Regardless of your cookie choice, the following minimal data is
            collected:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel Analytics &amp; Speed Insights</strong> — anonymous,
              cookieless page performance metrics and Web Vitals. No personal
              data is collected.
            </li>
            <li>
              <strong>Sentry</strong> — error reports and performance traces when
              something goes wrong. May include IP addresses, which Sentry
              retains for 90 days.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Why we collect it
          </h2>
          <p>
            To understand how the dashboard is used, identify usability issues,
            monitor errors, and improve the experience. The data is used solely
            for this purpose.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Third-party services and data transfers
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <strong>PostHog</strong> (EU-hosted, Frankfurt) — usage analytics.
              Only active after consent. Data stays in the EU.
            </li>
            <li>
              <strong>Vercel Analytics &amp; Speed Insights</strong> — servers
              located in the US. Collects anonymous, non-personal performance
              data only.
            </li>
            <li>
              <strong>Sentry</strong> (EU-hosted, Frankfurt) — error tracking.
              May process IP addresses.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Cookies and storage
          </h2>
          <p>
            If you accept cookies, PostHog may set cookies to distinguish
            returning visitors. Your consent choice is managed by PostHog and
            persisted in your browser. No PostHog cookies are set if you decline
            or have not yet made a choice.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Your choices and rights
          </h2>
          <p>
            You can accept or decline cookies via the banner shown on your first
            visit. You can change your choice at any time using the{" "}
            <strong>Cookie settings</strong> link in the dashboard footer.
            Withdrawing consent is as easy as giving it.
          </p>
          <p className="mt-2">
            Under GDPR, you also have the right to:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Access the personal data we hold about you</li>
            <li>Request correction or deletion of your data</li>
            <li>Request restriction of or object to processing</li>
            <li>Data portability</li>
            <li>Withdraw consent at any time</li>
            <li>
              Lodge a complaint with a supervisory authority (e.g. the ICO in the
              UK)
            </li>
          </ul>
          <p className="mt-2">
            To exercise any of these rights, contact us at the address below.
          </p>
        </section>

        <section>
          <h2 className="font-medium text-zinc-900 dark:text-zinc-200">
            Data retention
          </h2>
          <p>
            PostHog analytics data is retained according to PostHog&apos;s
            default retention policy. Sentry retains error data for 90 days.
            Vercel Analytics does not store personally identifiable data.
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
