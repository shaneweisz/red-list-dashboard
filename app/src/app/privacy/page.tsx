import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How this dashboard uses anonymous, cookieless usage analytics.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <Link
        href="/"
        className="text-xs text-zinc-400 dark:text-zinc-500 underline hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        ← Back to the dashboard
      </Link>

      <h1 className="mt-6 text-2xl font-semibold text-zinc-800 dark:text-zinc-100">
        Privacy
      </h1>

      <div className="mt-4 space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          This dashboard is part of a PhD research project at the University of
          Cambridge, which is the data controller. We collect a small amount of{" "}
          <strong>anonymous usage analytics</strong> to understand how the
          dashboard is used and to improve it.
        </p>

        <p>
          <strong>What we collect.</strong> Pages viewed, the referring page,
          and general device information such as browser and screen size, via{" "}
          <a
            href="https://posthog.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            PostHog
          </a>{" "}
          (hosted in the EU). This data is not linked to your identity. We do{" "}
          <strong>not</strong> use analytics cookies or store any identifier on
          your device, so no cookie banner is needed. We also use{" "}
          <a
            href="https://sentry.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Sentry
          </a>{" "}
          to record technical error reports so we can fix problems.
        </p>

        <p>
          <strong>Why.</strong> We process this data under our legitimate
          interest in maintaining and improving a public research tool. We do
          not sell it or use it for advertising.
        </p>

        <p>
          <strong>Your rights and more information.</strong> You have rights
          over your personal data under UK data protection law. For details, and
          to exercise those rights, see the University of Cambridge{" "}
          <a
            href="https://www.cam.ac.uk/about-this-site/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            privacy policy
          </a>{" "}
          and{" "}
          <a
            href="https://www.information-compliance.admin.cam.ac.uk/data-protection"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            data protection information
          </a>
          . For anything specific to this dashboard, contact{" "}
          <a
            href="mailto:sw984@cam.ac.uk"
            className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            sw984@cam.ac.uk
          </a>
          .
        </p>
      </div>
    </div>
  );
}
