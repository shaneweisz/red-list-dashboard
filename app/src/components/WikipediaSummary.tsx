"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface WikiSection {
  index: string;
  level: string;
  line: string;
}

interface SectionContent {
  html: string;
  loading: boolean;
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
const HEADERS = { "Api-User-Agent": "RedListDashboard/1.0 (https://github.com/shaneweisz/redlist-dashboard)" };

/** Strip Wikipedia chrome from parsed HTML */
function sanitizeWikiHtml(html: string, { removeImages = false, removeFirstHeading = false } = {}): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Remove unwanted elements
  const removeSelectors = [
    ".mw-editsection",
    ".mw-empty-elt",
    ".noprint",
    ".mw-ref",
    ".reference",
    ".reflist",
    ".refbegin",
    ".references",
    ".shortdescription",
    ".hatnote",
    ".sistersitebox",
    ".navbox",
    ".metadata",
    ".portal",
    ".mw-headline-anchor",
    ".cite_error",
    ".error",
    "style",
    "sup.reference",
    "sup[class]",
    // Infobox / sidebar
    ".infobox",
    ".sidebar",
    ".sidebar-content",
    // Footnotes and citations at bottom
    ".reflist",
    "ol.references",
    ".citation",
  ];

  for (const sel of removeSelectors) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }

  // Remove all sup elements (footnote markers like [1], [2])
  doc.querySelectorAll("sup").forEach((el) => el.remove());

  // Remove images from lead section to keep it clean
  if (removeImages) {
    doc.querySelectorAll("img, figure, .thumb, .tmulti, .image, .mw-file-element, .mw-file-description").forEach((el) => {
      // Walk up to remove the containing figure/thumb wrapper too
      const parent = el.closest("figure, .thumb, .tmulti, td, .floatright, .floatleft");
      if (parent) parent.remove();
      else el.remove();
    });
  }

  // Remove the first heading in section content (we already show it in the accordion)
  if (removeFirstHeading) {
    const firstHeading = doc.querySelector("h1, h2, h3, h4, h5, h6");
    if (firstHeading) firstHeading.remove();
  }

  // Rewrite Wikipedia internal links to point to en.wikipedia.org
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href?.startsWith("/wiki/")) {
      a.setAttribute("href", `https://en.wikipedia.org${href}`);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else if (href?.startsWith("#")) {
      // Remove in-page anchor links (like citation jumps)
      const span = doc.createElement("span");
      span.innerHTML = a.innerHTML;
      a.replaceWith(span);
    }
  });

  return doc.body.innerHTML;
}

/** Filters out non-content sections like References, See also, External links, etc. */
function isContentSection(name: string): boolean {
  const skip = new Set([
    "references",
    "see also",
    "external links",
    "further reading",
    "notes",
    "footnotes",
    "bibliography",
    "sources",
    "citations",
  ]);
  return !skip.has(name.toLowerCase().trim());
}

export default function WikipediaSummary({ scientificName }: { scientificName: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [summaryHtml, setSummaryHtml] = useState<string | null>(null);
  const [sections, setSections] = useState<WikiSection[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [sectionContents, setSectionContents] = useState<Record<string, SectionContent>>({});
  const resolvedTitleRef = useRef<string>(scientificName);

  useEffect(() => {
    let cancelled = false;

    async function fetchWikipedia() {
      setLoading(true);
      setError(null);
      setSummaryHtml(null);
      setSections([]);
      setExpandedSections(new Set());
      setSectionContents({});

      try {
        // Step 1: Get summary to resolve page title (handles redirects like Panthera_leo -> Lion)
        const summaryRes = await fetch(
          `${WIKI_REST}/page/summary/${encodeURIComponent(scientificName)}`,
          { headers: HEADERS }
        );
        if (!summaryRes.ok) {
          if (summaryRes.status === 404) {
            setError("No Wikipedia article found");
            setLoading(false);
            return;
          }
          throw new Error(`Summary API returned ${summaryRes.status}`);
        }
        const summaryData = await summaryRes.json();
        if (cancelled) return;

        const resolvedTitle = summaryData.titles?.canonical || scientificName;
        resolvedTitleRef.current = resolvedTitle;
        setPageTitle(summaryData.title || resolvedTitle);
        setPageUrl(summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle)}`);

        // Step 2: Fetch lead section HTML and section list in parallel
        const [leadRes, sectionsRes] = await Promise.all([
          fetch(
            `${WIKI_API}?action=parse&page=${encodeURIComponent(resolvedTitle)}&prop=text&section=0&format=json&origin=*`,
            { headers: HEADERS }
          ),
          fetch(
            `${WIKI_API}?action=parse&page=${encodeURIComponent(resolvedTitle)}&prop=sections&format=json&origin=*`,
            { headers: HEADERS }
          ),
        ]);

        if (cancelled) return;

        if (leadRes.ok) {
          const leadData = await leadRes.json();
          const rawHtml = leadData.parse?.text?.["*"] || "";
          setSummaryHtml(sanitizeWikiHtml(rawHtml, { removeImages: true }));
        }

        if (sectionsRes.ok) {
          const sectionsData = await sectionsRes.json();
          const allSections: WikiSection[] = sectionsData.parse?.sections || [];
          // Only show top-level content sections (level 2), skip References etc.
          setSections(allSections.filter((s) => s.level === "2" && isContentSection(s.line)));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Wikipedia article");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWikipedia();
    return () => { cancelled = true; };
  }, [scientificName]);

  const toggleSection = useCallback(
    async (section: WikiSection) => {
      const key = section.index;
      setExpandedSections((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });

      // Fetch content if not already loaded
      if (!sectionContents[key]) {
        setSectionContents((prev) => ({ ...prev, [key]: { html: "", loading: true } }));
        try {
          const res = await fetch(
            `${WIKI_API}?action=parse&page=${encodeURIComponent(resolvedTitleRef.current)}&prop=text&section=${key}&format=json&origin=*`,
            { headers: HEADERS }
          );
          if (res.ok) {
            const data = await res.json();
            const rawHtml = data.parse?.text?.["*"] || "<p>No content</p>";
            setSectionContents((prev) => ({
              ...prev,
              [key]: { html: sanitizeWikiHtml(rawHtml, { removeFirstHeading: true }), loading: false },
            }));
          } else {
            setSectionContents((prev) => ({
              ...prev,
              [key]: { html: "<p>Failed to load section</p>", loading: false },
            }));
          }
        } catch {
          setSectionContents((prev) => ({
            ...prev,
            [key]: { html: "<p>Failed to load section</p>", loading: false },
          }));
        }
      }
    },
    [sectionContents]
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading Wikipedia article...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        {error} for <span className="italic">{scientificName}</span>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header with link */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-zinc-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.09 13.119c-.14 1.064-.496 2.1-1.056 3.1-.56 1-1.322 1.9-2.282 2.7-.96.8-2.104 1.2-3.432 1.2-.576 0-1.146-.1-1.71-.3-.566-.2-1.07-.5-1.514-.9-.444-.4-.8-.8-1.068-1.3-.268-.5-.402-1-.402-1.5 0-.7.208-1.3.624-1.9.416-.6.968-1 1.656-1.3-.272-.4-.478-.8-.618-1.2-.14-.4-.21-.8-.21-1.2 0-.7.218-1.3.654-1.8.436-.5 1.006-.8 1.71-.9-.78-.7-1.35-1.5-1.71-2.3-.36-.8-.54-1.6-.54-2.5 0-.7.134-1.3.402-1.9.268-.6.636-1.1 1.104-1.5.468-.4 1.016-.7 1.644-.9.628-.2 1.296-.3 2.004-.3.88 0 1.678.2 2.394.5.716.3 1.302.8 1.758 1.3l-1.26 1.3c-.324-.4-.714-.7-1.17-.9-.456-.2-.954-.3-1.494-.3-.432 0-.828.1-1.188.2-.36.1-.672.3-.936.5-.264.2-.468.5-.612.8-.144.3-.216.7-.216 1.1 0 .5.114 1 .342 1.5.228.5.534 1 .918 1.4l5.712 6.3c.252-.5.45-1.1.594-1.7.144-.6.216-1.2.216-1.8h2.1zm-6.66 5.881c.78-.6 1.386-1.3 1.818-2.1l-3.852-4.2c-.492.2-.882.5-1.17.9-.288.4-.432.8-.432 1.3 0 .3.07.6.21.9.14.3.328.5.564.7.236.2.514.4.834.5.32.1.66.2 1.02.2.36 0 .698-.1 1.008-.2zm7.95-11h2.1v4h4.05v2.1h-4.05v4h-2.1v-4h-4.05v-2.1h4.05v-4z" />
        </svg>
        {pageUrl ? (
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {pageTitle} — Wikipedia
          </a>
        ) : (
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{pageTitle}</span>
        )}
      </div>

      {/* Summary (lead section) — always expanded */}
      {summaryHtml && (
        <WikiHtml html={summaryHtml} className="mb-4" />
      )}

      {/* Collapsible sections */}
      {sections.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-2">
          {sections.map((section) => {
            const isExpanded = expandedSections.has(section.index);
            const content = sectionContents[section.index];
            return (
              <div key={section.index} className="border-b border-zinc-100 dark:border-zinc-800">
                <button
                  className="w-full flex items-center gap-2 px-2 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                  onClick={() => toggleSection(section)}
                >
                  <svg
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span dangerouslySetInnerHTML={{ __html: section.line }} />
                </button>
                {isExpanded && (
                  <div className="px-2 pb-3">
                    {content?.loading ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading...
                      </div>
                    ) : content?.html ? (
                      <WikiHtml html={content.html} />
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Renders sanitized Wikipedia HTML with consistent styling */
function WikiHtml({ html, className = "" }: { html: string; className?: string }) {
  return (
    <div
      className={`wiki-content text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-1 [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a:hover]:underline [&_b]:font-semibold [&_i]:italic [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2 [&_h4]:mb-1 [&_table]:text-xs [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-zinc-300 dark:[&_th]:border-zinc-600 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-zinc-100 dark:[&_th]:bg-zinc-800 [&_td]:border [&_td]:border-zinc-300 dark:[&_td]:border-zinc-600 [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-xs [&_img]:h-auto [&_img]:rounded [&_img]:my-2 [&_.thumbcaption]:text-xs [&_.thumbcaption]:text-zinc-500 [&_.thumbcaption]:mt-1 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
