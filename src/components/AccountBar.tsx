"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore } from "@/lib/store";

const LABELS = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline",
  conflict: "Saved copy differs",
  error: "Not saved",
} as const;

export function AccountBar() {
  const { persistence } = useMapStore();

  if (!persistence.configured && persistence.status === "saved") {
    return (
      <div className="account-bar" aria-live="polite">
        <span>Saved on this browser</span>
      </div>
    );
  }

  return (
    <div className={`account-bar${persistence.status === "conflict" || persistence.status === "error" ? " warn" : ""}`} aria-live="polite">
      <span>{LABELS[persistence.status]}</span>
    </div>
  );
}

export function AccountPanel() {
  const { dispatch, persistence } = useMapStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(persistence.email);

  async function submit(mode: "in" | "up") {
    setBusy(true);
    setNotice("");
    setNoticeOk(false);
    if (mode === "in") {
      const error = await persistence.signIn(email, password);
      setNotice(error ?? "");
      setNoticeOk(!error);
    } else {
      const result = await persistence.signUp(email, password);
      if (result.error) setNotice(result.error);
      else if (result.needsConfirmation) setNotice("Check your email to confirm the account, then sign in.");
      else setNoticeOk(true);
    }
    setBusy(false);
  }

  return (
    <aside className="panel panel-left">
      <header className="panel-head">
        <strong>{signedIn ? "Account" : "Sign in"}</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-left", panel: "account" })} aria-label="Close account">
          Close
        </button>
      </header>
      <div className="panel-scroll account-fields">
        <p className={`account-status${persistence.status === "conflict" || persistence.status === "error" ? " warn" : ""}`}>
          {LABELS[persistence.status]}
        </p>
        {signedIn ? (
          <>
            <p className="account-email">{persistence.email}</p>
            <Button type="button" variant="outline" className="w-full" onClick={() => void persistence.signOut()}>
              Sign out
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              aria-label="Copy this computer's map to your account"
              onClick={async () => {
                const error = await persistence.uploadLocal();
                setNoticeOk(!error);
                setNotice(error ?? "Copied this computer's map to your account.");
              }}
            >
              {persistence.status === "conflict" ? "Use this computer" : "Copy to account"}
            </Button>
          </>
        ) : (
          <form
            className="account-fields"
            onSubmit={(event) => {
              event.preventDefault();
              void submit("in");
            }}
          >
            <label>
              Email
              <Input
                type="email"
                autoComplete="username"
                placeholder="Email"
                aria-label="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                aria-label="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <Button type="submit" className="w-full" disabled={busy}>
              Sign in
            </Button>
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void submit("up")}>
              Create account
            </Button>
          </form>
        )}
        {persistence.offerUpload && (
          <div className="account-offer">
            <p>Upload this browser&apos;s map to your account?</p>
            <Button
              type="button"
              className="w-full"
              aria-label="Copy this computer's map to your account"
              onClick={() =>
                void persistence.uploadLocal().then((error) => {
                  setNoticeOk(!error);
                  setNotice(error ?? "Copied this computer's map to your account.");
                })
              }
            >
              Copy to account
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={persistence.dismissUpload}>
              Not now
            </Button>
          </div>
        )}
        {persistence.status === "conflict" && (
          <Button type="button" variant="outline" className="w-full" onClick={() => void persistence.reloadRemote()}>
            Use saved map
          </Button>
        )}
        {notice && <p className={`account-notice${noticeOk ? " ok" : ""}`}>{notice}</p>}
      </div>
    </aside>
  );
}
