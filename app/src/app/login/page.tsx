import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInWithGitHub } from "@/lib/auth/actions";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_init_failed: "Couldn't start the GitHub sign-in flow. Please try again.",
  auth_callback_failed: "Sign-in didn't complete. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Sign in</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Sign in with your GitHub account to continue.
        </p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
          </p>
        )}
        <form action={signInWithGitHub}>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23a11.28 11.28 0 013-.405c1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
