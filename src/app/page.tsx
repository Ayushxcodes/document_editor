"use client";

import React, { useState } from "react";
import CanvasEditor from "../components/CanvasEditor";

const fields = [
  { key: "company_name", x: 80, y: 120, fontSize: 24 },
  { key: "date", x: 600, y: 120, fontSize: 16 },
  { key: "fees", x: 80, y: 900, fontSize: 20 },
];

export default function Homepage() {
  const templates = [
    { id: "saturn", label: "Saturn", src: "/saturn_bg.png" },
    { id: "ss", label: "ss", src: "/ss_bg.png" },
    { id: "ledgerworks", label: "Ledgerworks", src: "/ledgerworks_bg.png" },
  ];

  // generic presets (not used directly when template-specific sets are present)
  const presets: Record<string, Record<string, string>> = {
    demo1: { company_name: "ABC Ltd", date: "06-04-2026", fees: "50,000" },
    demo2: { company_name: "Omega Corp", date: "01-01-2026", fees: "120,000" },
    demo3: { company_name: "Gamma LLC", date: "12-12-2025", fees: "7,500" },
  };

  // content options loaded from public/templates/{templateId}_content.json
  const [contentOptions, setContentOptions] = useState<Array<{ id: string; label: string; data: Record<string, string> }>>([]);
  const [signatureOptions, setSignatureOptions] = useState<string[]>([]);
  // defensive shim for any legacy references to `contentSets` in hot-reloaded code
  // (some runtime bundles may still reference it briefly) — keep as empty map
  const contentSets: Record<string, Array<{ id: string; label: string; data: Record<string, string> }>> = {};

  const [pages, setPages] = useState(() => [
    { template: templates[0].src, data: presets.demo1 },
  ] as Array<{ template: string; data: Record<string, string> }>);
  const [current, setCurrent] = useState(0);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  // load content JSON for the current page's template
  React.useEffect(() => {
    // Only refetch when the current page's template changes (not when page data updates)
    const tplSrc = pages[current]?.template;
    const tpl = templates.find((t) => t.src === tplSrc);
    if (!tpl) {
      setContentOptions([]);
      setSelectedContentId(null);
      return;
    }
    const url = `/templates/${tpl.id}_content.json`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const list = Array.isArray(json) ? json : [];
        setContentOptions(list);
        // preserve previous selection if still present in the new list
        setSelectedContentId((prev) => (prev && list.find((c) => c.id === prev) ? prev : null));
      })
      .catch((err) => {
        console.warn("Could not load content JSON", err);
        setContentOptions([]);
        setSelectedContentId(null);
      });
  }, [pages[current]?.template, current]);

  // load available signature images from public/signatures/index.json
  React.useEffect(() => {
    fetch('/signatures/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((json) => {
        setSignatureOptions(Array.isArray(json) ? json : []);
      })
      .catch(() => setSignatureOptions([]));
  }, []);

  function updateFieldOnPage(pageIndex: number, key: string, value: string) {
    setPages((p) => p.map((pg, i) => (i === pageIndex ? { ...pg, data: { ...pg.data, [key]: value } } : pg)));
  }

  function changeTemplateOnPage(pageIndex: number, templateSrc: string) {
    setPages((p) => p.map((pg, i) => (i === pageIndex ? { ...pg, template: templateSrc } : pg)));
  }

  function addPage(templateSrc?: string) {
    setPages((p) => [...p, { template: templateSrc ?? templates[0].src, data: presets.demo1 }]);
    setCurrent((c) => pages.length);
  }

  function removePage(index: number) {
    setPages((p) => p.filter((_, i) => i !== index));
    setCurrent((c) => Math.max(0, Math.min(c, pages.length - 2)));
  }

  // split long text fields into chunks and insert additional pages after `startIndex`
  function applyContentWithPagination(startIndex: number, chosen: { id: string; label: string; data: Record<string, any> }) {
    // estimate chars per page based on canvas and body textbox layout used in CanvasEditor
    const CANVAS_W = 800;
    const CANVAS_H = 1100;
    const BODY_LEFT = 80;
    const BODY_TOP = 160;
    const BODY_RIGHT = 80;
    const BOTTOM_MARGIN = 120;
    const BODY_FONT = 14;
    const avgCharWidth = BODY_FONT * 0.6; // rough avg
    const charsPerLine = Math.max(20, Math.floor(((CANVAS_W - BODY_LEFT - BODY_RIGHT) / avgCharWidth)));
    const linesPerPage = Math.max(4, Math.floor((CANVAS_H - BODY_TOP - BOTTOM_MARGIN) / (BODY_FONT * 1.25)));
    const CHARS_PER_PAGE = charsPerLine * linesPerPage;
    const longKeys: string[] = [];
    function asText(v: any) {
      if (v == null) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.join("\n");
      if (typeof v === "object") return JSON.stringify(v, null, 2);
      return String(v);
    }
    Object.keys(chosen.data || {}).forEach((k) => {
      const v = chosen.data[k];
      const txt = asText(v);
      if (txt.length > CHARS_PER_PAGE) longKeys.push(k);
    });

    // if nothing long, just set on the current page
    if (longKeys.length === 0) {
      setPages((p) => p.map((pg, i) => (i === startIndex ? { ...pg, data: chosen.data } : pg)));
      return;
    }

    // split each long key into chunks, preferring paragraph boundaries
    const chunksByKey: Record<string, string[]> = {};
    let maxChunks = 1;
    longKeys.forEach((k) => {
      const raw = chosen.data[k];
      const txt = asText(raw) || "";
      const paras = txt.split(/\n{2,}|\r\n{2,}/).map((p) => p.trim()).filter(Boolean);
      const chunks: string[] = [];
      let current = "";
      paras.forEach((p) => {
        if ((current + "\n\n" + p).trim().length <= CHARS_PER_PAGE) {
          current = (current ? current + "\n\n" : "") + p;
        } else {
          if (current) {
            chunks.push(current);
            current = p;
          } else {
            // single paragraph exceeds page — hard split
            for (let i = 0; i < p.length; i += CHARS_PER_PAGE) {
              chunks.push(p.slice(i, i + CHARS_PER_PAGE));
            }
            current = "";
          }
        }
      });
      if (current) chunks.push(current);
      chunksByKey[k] = chunks;
      if (chunks.length > maxChunks) maxChunks = chunks.length;
    });

    // diagnostics: report what was detected and how many pages will be created
    // eslint-disable-next-line no-console
    console.log("applyContentWithPagination: longKeys detected", longKeys, Object.fromEntries(Object.entries(chunksByKey).map(([k, v]) => [k, v.length])) , "maxChunks", maxChunks);

    // build pages: first page keeps short fields and first chunk; subsequent pages keep company headers and chunk parts
    const baseShorts: Record<string, any> = {};
    Object.keys(chosen.data).forEach((k) => {
      const v = chosen.data[k];
      if (!longKeys.includes(k)) baseShorts[k] = v; // copy short fields to all pages
    });

    const newPages = [] as Array<{ template: string; data: Record<string, any> }>;
    for (let pageIdx = 0; pageIdx < maxChunks; pageIdx++) {
      const pageData: Record<string, any> = { ...baseShorts };
      // fill long keys for this page (or empty string if done)
      longKeys.forEach((k) => {
        pageData[k] = chunksByKey[k][pageIdx] ?? "";
      });
      newPages.push({ template: pages[startIndex].template, data: pageData });
    }

    // replace the current page with the first new page and insert the rest
    setPages((p) => {
      const before = p.slice(0, startIndex);
      const after = p.slice(startIndex + 1);
      return [...before, ...newPages, ...after];
    });
    // keep current at first of the inserted pages
    setCurrent(startIndex);
  }

  return (
    <div style={{ display: "flex", gap: 20, padding: 24 }}>
      <aside style={{ width: 320 }}>
        <h3>Page {current + 1} / {pages.length}</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>Prev</button>
          <button onClick={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))} disabled={current === pages.length - 1}>Next</button>
          <button onClick={() => addPage()}>+ Add Page</button>
          <button onClick={() => removePage(current)} disabled={pages.length <= 1}>Delete</button>
        </div>

        <h4>Template</h4>
        <select value={pages[current].template} onChange={(e) => changeTemplateOnPage(current, e.target.value)} style={{ width: "100%", padding: 8, marginBottom: 12 }}>
          {templates.map((t) => (
            <option key={t.id} value={t.src}>{t.label}</option>
          ))}
        </select>

        {/* Content selector driven by template/company */}
        <h4>Company / Contract</h4>
        <select
          value={selectedContentId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedContentId(id || null);
            if (!id) return;
            const chosen = contentOptions.find((c) => c.id === id);
            if (chosen) {
              applyContentWithPagination(current, chosen as any);
            }
          }}
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        >
          <option value="">— select —</option>
          {contentOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        <h4>Signature Image</h4>
        <select
          value={((pages[current].data as any)?.signatory?.image) || ""}
          onChange={(e) => {
            const img = e.target.value || "";
            setPages((p) => p.map((pg, i) => (i === current ? { ...pg, data: { ...pg.data, signatory: { ...(pg.data as any).signatory, image: img } } } : pg)));
          }}
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        >
          <option value="">— none —</option>
          {signatureOptions.map((f) => (
            <option key={f} value={`/signatures/${f}`}>{f}</option>
          ))}
        </select>

        <h4>Fields</h4>
        {fields.map((f) => (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "#333" }}>{f.key}</label>
            <input
              value={(pages[current].data as any)[f.key] || ""}
              onChange={(e) => updateFieldOnPage(current, f.key, e.target.value)}
              style={{ width: "100%", padding: 8 }}
            />
          </div>
        ))}
      </aside>

      <main>
        <CanvasEditor
          template={pages[current].template}
          width={800}
          height={1100}
          fields={fields}
          data={pages[current].data}
          onOverflow={(overflowText) => {
            // insert a new page after current with the overflow text (single synthetic key)
            setPages((p) => {
              // avoid double-inserting if already handled
              const already = (p[current].data as any).__overflow_handled;
              if (already) return p;
              const newPage = { template: p[current].template, data: { __overflow_body: overflowText } };
              const updated = [...p.slice(0, current + 1), newPage, ...p.slice(current + 1)];
              // mark current page as handled
              updated[current] = { ...updated[current], data: { ...(updated[current].data as any), __overflow_handled: true } };
              return updated;
            });
            // move to the inserted page
            setCurrent((c) => c + 1);
          }}
        />
      </main>
    </div>
  );
}