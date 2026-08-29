import { useState, type FormEvent } from "react";
import { getSupabase } from "../lib/supabase";

export function AuthPanel({ onUseLocal }: { onUseLocal?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const client = getSupabase();
    const result =
      mode === "signin"
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password });
    setBusy(false);

    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to finish creating your private account.");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <span className="privacy-badge">Private · only you</span>
        <h1 id="auth-heading">Proof Gallery</h1>
        <p className="lede">
          Save concrete evidence with its date and source, then retrieve it when
          your own history is difficult to reach.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {message && <p className="form-message">{message}</p>}
          <button className="primary-button" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMessage(null);
          }}
        >
          {mode === "signin" ? "Create a private account" : "I already have an account"}
        </button>
        {onUseLocal && (
          <button type="button" className="text-button" onClick={onUseLocal}>
            Use this browser without an account
          </button>
        )}
        <p className="small-print">
          This app has no public gallery, social feed, or automatic collection.
          Local browser storage is not encrypted and is separate from a hosted
          account.
        </p>
      </section>
    </main>
  );
}
