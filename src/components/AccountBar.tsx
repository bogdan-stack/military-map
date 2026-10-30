"use client";

import { useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!persistence.configured && persistence.status === "saved") {
    return (
      <div className="account-bar" aria-live="polite">
        <span>Saved on this browser</span>
      </div>
    );
  }

  async function submit(mode: "in" | "up") {
    setBusy(true);
    setNotice("");
    setNoticeOk(false);
    if (mode === "in") {
      const error = await persistence.signIn(email, password);
      setNotice(error ?? "");
      if (!error) setOpen(false);
    } else {
      const result = await persistence.signUp(email, password);
      if (result.error) setNotice(result.error);
      else if (result.needsConfirmation) setNotice("Check your email to confirm the account, then sign in.");
      else setOpen(false);
    }
    setBusy(false);
  }

  return (
    <div className={`account-bar${persistence.status === "conflict" || persistence.status === "error" ? " warn" : ""}`} aria-live="polite">
      <span>{LABELS[persistence.status]}</span>
      {persistence.email ? (
        <>
          <span className="account-email">{persistence.email}</span>
          <button type="button" onClick={() => void persistence.signOut()}>
            Sign out
          </button>
          <button
            type="button"
            aria-label="Copy this computer's map to your account"
            onClick={async () => {
              const error = await persistence.uploadLocal();
              setNoticeOk(!error);
              setNotice(error ?? "Copied this computer's map to your account.");
            }}
          >
            {persistence.status === "conflict" ? "Use this computer" : "Copy to account"}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setOpen((value) => !value)}>
          Sign in
        </button>
      )}
      {persistence.offerUpload && (
        <span className="account-offer">
          Upload this browser&apos;s map to your account?
          <button
            type="button"
            aria-label="Copy this computer's map to your account"
            onClick={() =>
              void persistence.uploadLocal().then((error) => {
                setNoticeOk(!error);
                setNotice(error ?? "Copied this computer's map to your account.");
              })
            }
          >
            Copy to account
          </button>
          <button type="button" onClick={persistence.dismissUpload}>
            Not now
          </button>
        </span>
      )}
      {persistence.status === "conflict" && (
        <button type="button" onClick={() => void persistence.reloadRemote()}>
          Use saved map
        </button>
      )}
      {open && !persistence.email && (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("in");
          }}
        >
          <input
            type="email"
            autoComplete="username"
            placeholder="Email"
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            Sign in
          </button>
          <button type="button" disabled={busy} onClick={() => void submit("up")}>
            Create account
          </button>
        </form>
      )}
      {notice && <span className={`account-notice${noticeOk ? " ok" : ""}`}>{notice}</span>}
    </div>
  );
}
