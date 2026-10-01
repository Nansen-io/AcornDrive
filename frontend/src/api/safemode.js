import { fetchURL } from "./utils";
import { getApiPath } from "@/utils/url.js";

export async function getSafeModeItems() {
  const res = await fetchURL(getApiPath("api/safemode"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addToSafeMode(items, pin) {
  const res = await fetchURL(getApiPath("api/safemode"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || res.statusText);
  }
  return res.json();
}

export async function removeFromSafeMode(items, pin) {
  const res = await fetchURL(getApiPath("api/safemode"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || res.statusText);
  }
  return res.json();
}

// target {source, path} checks that one SAFEMode item's PIN; without it, the PIN unlocks
// every item that uses it.
export async function verifySafeModePin(pin, target = null) {
  const res = await fetchURL(getApiPath("api/safemode/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target ? { pin, source: target.source, path: target.path } : { pin }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { valid: true/false, items: [{source, path}] } — items are what the PIN unlocked
}
