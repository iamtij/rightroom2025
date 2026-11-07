import { useEffect, useState } from "react";
import { AdminSections } from "./sections";

export default function Admin() {
  const [email, setEmail] = useState("admin@ibmcph.com");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ setupToken: string; secret: string; otpauthUrl: string } | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" }).then((response) => {
      if (response.ok) setSignedIn(true);
    });
  }, []);

  async function login() {
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, code }),
    });
    const payload = await response.json();
    if (response.ok && payload.setupToken) {
      setSetup(payload);
      setMfaRequired(false);
      return;
    }
    if (payload.mfaRequired) {
      setMfaRequired(true);
      setError(payload.error || "Enter the code from your authenticator.");
      return;
    }
    if (!response.ok) {
      setError(payload.error || "Sign in failed");
      return;
    }
    setSignedIn(true);
  }

  async function confirmSetup() {
    if (!setup) return;
    setError("");
    const response = await fetch("/api/admin/mfa/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupToken: setup.setupToken, code }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "That code is wrong.");
      return;
    }
    setSignedIn(true);
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setSignedIn(false);
    setPassword("");
    setCode("");
    setSetup(null);
    setMfaRequired(false);
    setError("");
  }

  const inputClass = "w-full rounded-[10px] border border-[#D9D5CF] px-3 py-3 text-base font-normal";

  return (
    <div className="scroll-wrapper bg-[#F6F4F1] font-sans text-[#141416]">
      <div className={`mx-auto flex min-h-full w-full flex-col px-5 py-8 ${signedIn ? "max-w-[1200px]" : "max-w-[480px]"}`}>
        <div className="flex w-full flex-col gap-6">
          <header className="flex items-center justify-between">
            <a href="/" className="font-archivo text-lg font-extrabold text-[#141416] no-underline">
              IBMC <span className="text-[#D0202E]">2027</span>
            </a>
            {signedIn ? (
              <button type="button" className="text-sm font-semibold text-[#A8131F]" onClick={logout}>
                Log out
              </button>
            ) : (
              <span className="text-sm text-[#5C5C63]">Admin</span>
            )}
          </header>
          {!signedIn ? (
            <form
              className="flex w-full flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (setup) confirmSetup();
                else login();
              }}
            >
              <h1 className="m-0 font-archivo text-[28px] font-extrabold">Sign in</h1>
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]">
                Email
                <input className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]">
                Password
                <input type="password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {setup ? (
                <div className="flex flex-col gap-2 rounded-[10px] bg-[#F6F4F1] p-3 text-sm">
                  <p className="m-0">Add this key to an authenticator app, then enter the 6-digit code.</p>
                  <p className="m-0 break-all font-mono text-[13px]">{setup.secret}</p>
                </div>
              ) : null}
              {setup || mfaRequired ? (
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]">
                  Authenticator code
                  <input inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                </label>
              ) : null}
              {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
              <button type="submit" className="w-full rounded-full bg-[#D0202E] py-3.5 font-bold text-white">{setup ? "Confirm code" : "Sign in"}</button>
            </form>
          ) : (
            <AdminSections />
          )}
        </div>
      </div>
    </div>
  );
}
