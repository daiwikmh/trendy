import type { Page } from "playwright";

export interface Element {
  idx: number;
  tag: string;
  type: string;
  label: string;
  value: string;
  placeholder: string;
  options?: string[];
  text: string;
}

export interface Observation {
  url: string;
  title: string;
  elements: Element[];
}

// Runs in the page. Tags each interactive element with data-brow-idx and
// returns a labeled descriptor for each. Label resolution follows the order
// forms actually use: <label for>, wrapping <label>, aria-label/-labelledby,
// placeholder, then nearby text.
export async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() => {
    const sel =
      'input, textarea, select, button, a[href], [role=button], [role=combobox], [role=checkbox], [role=radio], [role=option], [role=menuitem], [contenteditable=""], [contenteditable="true"]';
    const vis = (el: any) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const textOf = (el: any) => (el ? (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ") : "");
    const labelFor = (el: any) => {
      if (el.id) {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) return textOf(l);
      }
      const wrap = el.closest("label");
      if (wrap) return textOf(wrap).slice(0, 120);
      const al = el.getAttribute("aria-label");
      if (al) return al.trim();
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const parts = lb.split(/\s+/).map((id: string) => textOf(document.getElementById(id))).filter(Boolean);
        if (parts.length) return parts.join(" ");
      }
      if (el.placeholder) return el.placeholder.trim();
      const prev = el.previousElementSibling;
      if (prev && textOf(prev)) return textOf(prev).slice(0, 120);
      return "";
    };
    const out: any[] = [];
    let i = 0;
    document.querySelectorAll("[data-brow-idx]").forEach((e) => e.removeAttribute("data-brow-idx"));
    for (const el of Array.from(document.querySelectorAll(sel)) as any[]) {
      if (!vis(el)) continue;
      el.setAttribute("data-brow-idx", String(i));
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || el.getAttribute("role") || "").toLowerCase();
      const showText = tag === "button" || tag === "a" || type === "option" || type === "menuitem";
      const d: any = {
        idx: i,
        tag,
        type,
        label: labelFor(el),
        value: (el.value ?? "").toString().slice(0, 80),
        placeholder: (el.placeholder || "").trim(),
        text: showText ? textOf(el).slice(0, 80) : "",
      };
      if (tag === "select") {
        d.options = Array.from(el.options).map((o: any) => o.text.trim()).filter(Boolean).slice(0, 30);
      }
      out.push(d);
      if (++i >= 60) break;
    }
    return { url: location.href, title: document.title, elements: out };
  }) as Promise<Observation>;
}

// ── Content perception (for the fashion scout): images + navigation ──────────
export interface ImageEl {
  idx: number;
  alt: string;
  caption: string;
  context: string;
  src: string;
  w: number;
  h: number;
}
export interface ContentControl {
  idx: number;
  tag: string;
  text: string;
}
export interface ContentObservation {
  url: string;
  title: string;
  images: ImageEl[];
  controls: ContentControl[];
}

export async function observeContent(page: Page): Promise<ContentObservation> {
  return page.evaluate(() => {
    const textOf = (el: any) => (el ? (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ") : "");
    const nearestHeading = (el: any) => {
      let cur = el;
      for (let up = 0; up < 5 && cur; up++, cur = cur.parentElement) {
        const h = cur.querySelector && cur.querySelector("h1,h2,h3,h4");
        if (h && textOf(h)) return textOf(h).slice(0, 140);
      }
      let p = el.previousElementSibling;
      while (p) {
        if (/^h[1-4]$/i.test(p.tagName) && textOf(p)) return textOf(p).slice(0, 140);
        p = p.previousElementSibling;
      }
      return "";
    };
    const captionOf = (el: any) => {
      const fig = el.closest("figure");
      if (fig) {
        const fc = fig.querySelector("figcaption");
        if (fc && textOf(fc)) return textOf(fc).slice(0, 140);
      }
      const a = el.closest("a[title]");
      if (a && a.getAttribute("title")) return a.getAttribute("title").slice(0, 140);
      return "";
    };
    document.querySelectorAll("[data-brow-idx]").forEach((e) => e.removeAttribute("data-brow-idx"));
    let i = 0;
    const images: any[] = [];
    for (const el of Array.from(document.querySelectorAll("img")) as any[]) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 140) continue; // skip icons/logos/avatars
      el.setAttribute("data-brow-idx", String(i));
      images.push({
        idx: i,
        alt: (el.getAttribute("alt") || "").trim().slice(0, 140),
        caption: captionOf(el),
        context: nearestHeading(el),
        src: (el.currentSrc || el.src || "").split("?")[0].split("/").pop() || "",
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
      i++;
      if (images.length >= 40) break;
    }
    const controls: any[] = [];
    for (const el of Array.from(document.querySelectorAll("a[href], button")) as any[]) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const t = textOf(el).slice(0, 60);
      if (!t) continue;
      el.setAttribute("data-brow-idx", String(i));
      controls.push({ idx: i, tag: el.tagName.toLowerCase(), text: t });
      i++;
      if (controls.length >= 25) break;
    }
    return { url: location.href, title: document.title, images, controls };
  }) as Promise<ContentObservation>;
}

export function serializeContent(obs: ContentObservation): string {
  const imgs = obs.images.length
    ? obs.images
        .map((e) => {
          const desc = [e.context, e.caption, e.alt].filter(Boolean).join(" · ") || "(no text)";
          return `[${e.idx}] IMG ${e.w}x${e.h} — ${desc}`;
        })
        .join("\n")
    : "(no sizable images visible)";
  const ctrls = obs.controls.map((c) => `[${c.idx}] ${c.tag} ${JSON.stringify(c.text)}`).join("\n");
  return `IMAGES:\n${imgs}\n\nCONTROLS:\n${ctrls}`;
}

export function serialize(obs: Observation): string {
  return obs.elements
    .map((e) => {
      const bits = [`[${e.idx}] <${e.tag}${e.type ? " " + e.type : ""}>`];
      if (e.label) bits.push(`label=${JSON.stringify(e.label)}`);
      if (e.text) bits.push(`text=${JSON.stringify(e.text)}`);
      if (e.value) bits.push(`current=${JSON.stringify(e.value)}`);
      if (e.options) bits.push(`options=[${e.options.join(", ")}]`);
      return bits.join(" ");
    })
    .join("\n");
}
