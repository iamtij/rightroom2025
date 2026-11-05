import { useEffect, useState } from "react";
import { AdminSections } from "./sections";

export default function Admin() {
  const [email, setEmail] = useState("admin@ibmcph.com");
  const [password, setPassword] = useState("");
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
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "Sign in failed");
      return;
    }
    setSignedIn(true);
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setSignedIn(false);
    setPassword("");
    setError("");
  }

  return (
    <div className="scroll-wrapper bg-[#F6F4F1] font-sans text-[#141416]">
      <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-6 px-5 py-8">
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
            className="flex max-w-[420px] flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-5"
            onSubmit={(event) => {
              event.preventDefault();
              login();
            }}
          >
            <h1 className="m-0 font-archivo text-[28px] font-extrabold">Sign in</h1>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]">
              Email
              <input className="rounded-[10px] border border-[#D9D5CF] px-3 py-3 text-base font-normal" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]">
              Password
              <input type="password" className="rounded-[10px] border border-[#D9D5CF] px-3 py-3 text-base font-normal" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
            <button type="submit" className="rounded-full bg-[#D0202E] py-3.5 font-bold text-white">Sign in</button>
          </form>
        ) : (
          <AdminSections />
        )}
      </div>
    </div>
  );
}
