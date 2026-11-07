const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REFERENCE = /^IBMC27-[a-f0-9]{6}$/i;
const MOBILE_CHARS = /^[+\d][\d\s().-]*$/;

export const LOOKUP_CONTACT_ERROR = "Enter a valid email or mobile number.";

export function philippineMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits.length === 10 ? `0${digits}` : digits;
  return /^09\d{9}$/.test(local) ? local : null;
}

/**
 * @param {string} query
 * @param {{ reference?: boolean }} [options]
 * @returns {{ error: string, status: number } | { kind: "email" | "mobile" | "reference", value: string }}
 */
export function parseLookupContact(query, options = {}) {
  const raw = String(query || "").trim();
  if (!raw) return { error: "Add your email or mobile number.", status: 400 };
  if (raw.includes("@")) {
    if (raw.length > 254 || !EMAIL.test(raw)) return { error: LOOKUP_CONTACT_ERROR, status: 400 };
    return { kind: "email", value: raw.toLowerCase() };
  }
  if (options.reference && REFERENCE.test(raw)) return { kind: "reference", value: raw };
  const mobile = philippineMobile(raw);
  if (mobile && MOBILE_CHARS.test(raw)) return { kind: "mobile", value: mobile };
  return { error: LOOKUP_CONTACT_ERROR, status: 400 };
}
