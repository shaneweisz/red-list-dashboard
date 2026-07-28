import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignInForm } from "./SignInForm";

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
        <SignInForm />
      </div>
    </div>
  );
}
