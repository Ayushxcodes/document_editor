"use client";

import React, { useEffect, useRef, useState } from "react";

type Field = { key: string; x: number; y: number; fontSize?: number };

export default function CanvasEditor({
  template = "/companyA-bg.png",
  width = 800,
  height = 1100,
  fields = [] as Field[],
  data = {} as Record<string, string>,
  onOverflow,
}: {
  template?: string;
  width?: number;
  height?: number;
  fields?: Field[];
  data?: Record<string, string>;
  onOverflow?: (overflowText: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<any>(null);
  const canvasInstanceRef = useRef<any>(null);
  const textObjectsRef = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // helper: format field values into strings for display (shared)
  function formatValue(val: any) {
    if (val == null) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (Array.isArray(val)) return val.join("\n");
    if (typeof val === "object") {
      const entries = Object.entries(val).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      return entries.join("\n");
    }
    return String(val);
  }

  useEffect(() => {
    let mounted = true;
    let createdCanvas: any = null;

    (async () => {
      try {
        const mod = await import("fabric");
        const lib = (mod as any).fabric ?? (mod as any).default ?? mod;
        if (!mounted) return;
        if (!lib || !lib.Canvas) {
          console.error("fabric import did not expose Canvas:", mod);
          return;
        }

        // dispose previous canvas if any
        if (canvasInstanceRef.current && typeof canvasInstanceRef.current.dispose === "function") {
          try {
            canvasInstanceRef.current.dispose();
          } catch (e) {
            // ignore
          }
          canvasInstanceRef.current = null;
        }

        fabricRef.current = lib;
        const el = canvasRef.current as HTMLCanvasElement;
        const canvas = new lib.Canvas(el, {
          preserveObjectStacking: true,
        });

        // set dimensions in a compatibility-friendly way
        if (typeof canvas.setDimensions === "function") {
          canvas.setDimensions({ width, height });
        } else if (typeof canvas.setWidth === "function") {
          canvas.setWidth(width);
          canvas.setHeight(height);
        } else if ((canvas as any).lowerCanvasEl) {
          (canvas as any).lowerCanvasEl.width = width;
          (canvas as any).lowerCanvasEl.height = height;
          if (typeof (canvas as any).calcOffset === "function") (canvas as any).calcOffset();
        }

        canvasInstanceRef.current = canvas;
        createdCanvas = canvas;
        // expose for quick debugging in browser console
        try {
          // @ts-ignore
          window.__fabricCanvas = canvas;
          // @ts-ignore
          window.__fabricLib = lib;
        } catch (e) {
          /* ignore */
        }

        // give the canvas a subtle background so user can see the preview area
        try {
          if (typeof canvas.setBackgroundColor === "function") {
            canvas.setBackgroundColor("#f8fafc", canvas.renderAll.bind(canvas));
          } else if (canvas.lowerCanvasEl) {
            canvas.lowerCanvasEl.style.background = "#f8fafc";
          }
        } catch (e) {
          /* ignore */
        }

        // load template via an Image element (more reliable than fromURL in some bundlers)
        let backgroundLoaded = false;
        try {
          // eslint-disable-next-line no-console
          console.log("CanvasEditor: loading template via Image element", template);
          const imgEl = new Image();
          imgEl.crossOrigin = "anonymous";
          imgEl.onload = () => {
            try {
              const w = (canvas.getWidth && canvas.getWidth()) || width;
              const h = (canvas.getHeight && canvas.getHeight()) || height;
              const fabricImg = new lib.Image(imgEl, { selectable: false, evented: false });
              const ratioX = w / imgEl.width;
              const ratioY = h / imgEl.height;
              if (ratioX < ratioY) {
                if (typeof fabricImg.scaleToWidth === "function") fabricImg.scaleToWidth(w);
                else if (typeof fabricImg.scale === "function") fabricImg.scale(ratioX);
              } else {
                if (typeof fabricImg.scaleToHeight === "function") fabricImg.scaleToHeight(h);
                else if (typeof fabricImg.scale === "function") fabricImg.scale(ratioY);
              }
              try {
                // Prefer using canvas.setBackgroundImage so the image is rendered beneath objects
                if (typeof canvas.setBackgroundImage === "function") {
                  canvas.setBackgroundImage(imgEl.src, canvas.renderAll.bind(canvas), {
                    originX: "left",
                    originY: "top",
                    left: 0,
                    top: 0,
                    scaleX: ratioX,
                    scaleY: ratioY,
                    crossOrigin: "anonymous",
                  });
                } else {
                  fabricImg.set({ left: 0, top: 0, originX: "left", originY: "top", selectable: false, evented: false });
                  canvas.add(fabricImg);
                  // Fabric builds vary — try safe ways to move the image to the back
                  try {
                    if (typeof canvas.sendToBack === "function") {
                      canvas.sendToBack(fabricImg);
                    } else if (typeof fabricImg.sendToBack === "function") {
                      fabricImg.sendToBack();
                    } else if (typeof canvas.moveTo === "function") {
                      canvas.moveTo(fabricImg, 0);
                    } else if ((canvas as any)._objects && Array.isArray((canvas as any)._objects)) {
                      // last-resort: reorder internal array
                      const idx = (canvas as any)._objects.indexOf(fabricImg);
                      if (idx > -1) {
                        (canvas as any)._objects.splice(idx, 1);
                        (canvas as any)._objects.unshift(fabricImg);
                      }
                    }
                  } catch (e) {
                    // ignore - some builds throw on private APIs
                  }
                }
                if (typeof canvas.requestRenderAll === "function") canvas.requestRenderAll();
                else canvas.renderAll();
                backgroundLoaded = true;
                // eslint-disable-next-line no-console
                console.log("CanvasEditor: background added (imgEl)", template);
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error("Failed to add background image to canvas", e);
                setInitError(String(e));
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error("Failed to set background image from element", e);
              setInitError(String(e));
            }
          };
          imgEl.onerror = (ev) => {
            // eslint-disable-next-line no-console
            console.error("Image element failed to load", ev);
            setInitError("Template image failed to load; check path/CORS");
          };
          imgEl.src = template;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Error loading image element", e);
          setInitError(String(e));
        }

        // if background doesn't load within 2.5s, show a helpful message and render fields
        setTimeout(() => {
          if (!backgroundLoaded) {
            setInitError((prev) => prev ?? "Background did not load quickly; check console/path.");
            setReady(true);
          }
        }, 2500);

        // don't clear objects here — avoid removing a background that may have
        // been added quickly by the Image onload handler. Keep existing objects
        // so text remains visible above the background.

        // create textboxes for fields
        fields.forEach((f) => {
          const txt = new lib.Textbox(data[f.key] || `{{${f.key}}}`, {
            left: f.x,
            top: f.y,
            fontSize: f.fontSize || 18,
            width: 400,
            editable: false,
            selectable: false,
          });
          textObjectsRef.current[f.key] = txt;
          canvas.add(txt);
          // eslint-disable-next-line no-console
          console.log("CanvasEditor: added textbox", f.key, data[f.key]);
        });

        // create a single flowing body textbox for any non-field keys (subject, intro, scope, etc.)
        try {
          const fieldKeys = new Set(fields.map((f) => f.key));
          const bodyPieces: string[] = [];
          Object.keys(data || {}).forEach((k) => {
            if (!fieldKeys.has(k)) {
              const v = (data as any)[k];
              const s = formatValue(v);
              if (s) bodyPieces.push(`${k.toUpperCase()}\n${s}`);
            }
          });
          const bodyText = bodyPieces.join('\n\n');
          const body = new lib.Textbox(bodyText || "", {
            left: 80,
            top: 160,
            originX: "left",
            originY: "top",
            textAlign: "left",
            fontSize: 14,
            width: Math.max(400, (width || 800) - 160),
            editable: false,
            selectable: false,
          });
          textObjectsRef.current["__body"] = body;
          canvas.add(body);
          // ensure body is above background
          try { if (typeof body.bringToFront === 'function') body.bringToFront(); } catch (e) {}
          // clamp to canvas bounds
          try {
            const cw = (canvas.getWidth && canvas.getWidth()) || width;
            const maxW = Math.max(40, cw - (body.left || 0) - 20);
            if (body.width > maxW) {
              if (typeof body.set === 'function') body.set('width', maxW);
              else body.width = maxW;
            }
            if ((body.left || 0) < 0) {
              if (typeof body.set === 'function') body.set('left', 0);
              else body.left = 0;
            }
            if (typeof body.setCoords === 'function') body.setCoords();
            // prevent overlapping lower mapped fields by truncating body text to available area
            try {
              const bodyTop = typeof body.top === 'number' ? body.top : 160;
              const lowerFields = fields.filter((ff: any) => typeof ff.y === 'number' && ff.y > bodyTop).map((ff: any) => ff.y);
              const boundaryY = lowerFields.length ? Math.min(...lowerFields) : ((canvas.getHeight && canvas.getHeight()) || height) - 40;
              const availableHeight = Math.max(20, boundaryY - bodyTop - 12);
              const lineHeight = (body.fontSize || 14) * 1.25;
              const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
              const avgCharWidth = (body.fontSize || 14) * 0.6;
              const charsPerLine = Math.max(20, Math.floor((body.width || maxW) / avgCharWidth));
              const maxChars = charsPerLine * maxLines;
              const currentText = (body.text || "") as string;
              if (currentText.length > maxChars) {
                const visible = currentText.slice(0, Math.max(0, maxChars - 1)).trimEnd();
                const overflow = currentText.slice(Math.max(0, maxChars - 1)).trimStart();
                const trimmed = visible + "…";
                if (typeof body.set === 'function') body.set('text', trimmed); else body.text = trimmed;
                try {
                  const prevReported = (textObjectsRef.current as any).__overflowReported;
                  if (overflow && onOverflow && prevReported !== overflow) {
                    try { onOverflow(overflow); } catch (e) { /* ignore callback errors */ }
                    (textObjectsRef.current as any).__overflowReported = overflow;
                  }
                } catch (e) {
                  /* ignore */
                }
              }
            } catch (e) {
              /* ignore truncation errors */
            }
          } catch (e) {
            /* ignore */
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Failed to create body textbox', e);
        }

        try {
          canvas.renderAll();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("canvas.renderAll failed", e);
        }

        // mark ready once objects are added (background may follow)
        // eslint-disable-next-line no-console
        console.log("CanvasEditor: initialization complete, setting ready");
        try {
          // diagnostics: report objects and canvas internals
          // eslint-disable-next-line no-console
          console.log("CanvasEditor: canvas objects after init:", canvas.getObjects().map((o: any) => o.type));
          // eslint-disable-next-line no-console
          console.log("CanvasEditor: lowerCanvasEl present:", !!(canvas as any).lowerCanvasEl);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("CanvasEditor: diagnostics failed", e);
        }
        setReady(true);
      } catch (err: any) {
        console.error("Failed to initialize fabric canvas", err);
        setInitError(String(err?.message ?? err));
      }
    })();

    return () => {
      mounted = false;
      if (createdCanvas && typeof createdCanvas.dispose === "function") {
        try {
          createdCanvas.dispose();
        } catch (e) {
          // ignore
        }
      }
      canvasInstanceRef.current = null;
    };
  }, [template, width, height, fields]);

  // update text objects when data changes
  useEffect(() => {
    const canvas = canvasInstanceRef.current;
    const lib = fabricRef.current;
    // diagnostics
    // eslint-disable-next-line no-console
    console.log("CanvasEditor: data update", { data, canvasPresent: !!canvas, textKeys: Object.keys(textObjectsRef.current) });
    if (!canvas || !lib) {
      // eslint-disable-next-line no-console
      console.warn("CanvasEditor: no canvas or fabric lib available during data update");
      return;
    }

    // helper: format field values into strings for display
    function formatValue(val: any) {
      if (val == null) return "";
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      if (Array.isArray(val)) return val.join("; ");
      if (typeof val === "object") {
        const entries = Object.entries(val).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
        return entries.join(" | ");
      }
      return String(val);
    }

    // ensure all defined fields have a textbox; update text and clamp positions
    fields.forEach((f) => {
      const key = f.key;
      let obj = textObjectsRef.current[key];
      const raw = (data && (data as any)[key]);
      const newText = formatValue(raw);
      const desiredLeft = typeof f.x === "number" ? f.x : 0;
      const desiredTop = typeof f.y === "number" ? f.y : 0;
      const maxWidth = Math.max(200, (width || 800) - desiredLeft - 20);

      if (!obj) {
        // create a textbox if it doesn't exist yet
        try {
          obj = new lib.Textbox(newText || `{{${key}}}`, {
            left: desiredLeft,
            top: desiredTop,
            fontSize: f.fontSize || 18,
            width: Math.min(800, maxWidth),
            editable: false,
            selectable: false,
            originX: "left",
            originY: "top",
          });
          textObjectsRef.current[key] = obj;
          canvas.add(obj);
          // eslint-disable-next-line no-console
          console.log("CanvasEditor: created missing textbox", key, newText);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to create textbox for", key, e);
        }
      } else {
        try {
          if (typeof obj.set === "function") obj.set("text", newText);
          else obj.text = newText;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to update textbox text for", key, e);
        }
      }

      // clamp position and width to canvas bounds
      try {
        const clampedLeft = Math.max(0, Math.min(desiredLeft, (width || 800) - 10));
        const clampedTop = Math.max(0, Math.min(desiredTop, (height || 1100) - 10));
        if (typeof obj.set === "function") {
          obj.set({ left: clampedLeft, top: clampedTop, width: Math.min(obj.width || maxWidth, maxWidth), originX: "left", originY: "top" });
        } else {
          obj.left = clampedLeft;
          obj.top = clampedTop;
          obj.width = Math.min(obj.width || maxWidth, maxWidth);
        }
        if (typeof obj.setCoords === "function") obj.setCoords();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to clamp textbox position for", key, e);
      }
      // log position for diagnosis
      try {
        // eslint-disable-next-line no-console
        console.log("CanvasEditor: field", key, "pos->", obj.left, obj.top, "width->", obj.width);
      } catch (e) {
        /* ignore */
      }
    });

    try {
      if (typeof canvas.requestRenderAll === "function") canvas.requestRenderAll();
      else canvas.renderAll();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("canvas.renderAll failed in data update", e);
    }

    try {
      // diagnostics: list canvas objects
      // eslint-disable-next-line no-console
      console.log("CanvasEditor: canvas objects after data update:", canvas.getObjects().map((o: any) => ({ type: o.type, text: o.text }))); 
    }
    catch (e) {
      /* ignore */
    }
    // Update or create the flowing body textbox for any non-field data keys
    try {
      const fieldKeys = new Set(fields.map((f) => f.key));
      const bodyPieces: string[] = [];
      Object.keys(data || {}).forEach((k) => {
        if (!fieldKeys.has(k)) {
          const v = (data as any)[k];
          const s = formatValue(v);
          if (s) bodyPieces.push(`${k.toUpperCase()}\n${s}`);
        }
      });
      const bodyText = bodyPieces.join('\n\n');
      // diagnostics
      // eslint-disable-next-line no-console
      console.log('CanvasEditor: assembled bodyText length', bodyText.length, 'preview:', bodyText.slice(0, 240));

      let body = textObjectsRef.current["__body"];
      if (!body) {
        body = new lib.Textbox(bodyText || "", {
          left: 80,
          top: 160,
          originX: "left",
          originY: "top",
          textAlign: "left",
          fontSize: 14,
          width: Math.max(400, (width || 800) - 160),
          editable: false,
          selectable: false,
        });
        textObjectsRef.current["__body"] = body;
        canvas.add(body);
      } else {
        try {
          if (typeof body.set === "function") body.set("text", bodyText || "");
          else body.text = bodyText || "";
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to set body textbox text", e);
        }
      }
      try {
        const cw = (canvas.getWidth && canvas.getWidth()) || width;
        const left = typeof body.left === 'number' ? body.left : 80;
        const maxW = Math.max(40, cw - left - 20);
        if (typeof body.set === 'function') body.set('width', Math.min(body.width || maxW, maxW)); else body.width = Math.min(body.width || maxW, maxW);
        if (left < 0) { if (typeof body.set === 'function') body.set('left', 0); else body.left = 0; }
        // truncation to avoid overlap with lower mapped fields
        try {
          const bodyTop = typeof body.top === 'number' ? body.top : 160;
          const lowerFields = fields.filter((ff: any) => typeof ff.y === 'number' && ff.y > bodyTop).map((ff: any) => ff.y);
          const boundaryY = lowerFields.length ? Math.min(...lowerFields) : ((canvas.getHeight && canvas.getHeight()) || height) - 40;
          const availableHeight = Math.max(20, boundaryY - bodyTop - 12);
          const lineHeight = (body.fontSize || 14) * 1.25;
          const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
          const avgCharWidth = (body.fontSize || 14) * 0.6;
          const charsPerLine = Math.max(20, Math.floor((body.width || maxW) / avgCharWidth));
          const maxChars = charsPerLine * maxLines;
          const currentText = (body.text || "") as string;
          if (currentText.length > maxChars) {
            const visible = currentText.slice(0, Math.max(0, maxChars - 1)).trimEnd();
            const overflow = currentText.slice(Math.max(0, maxChars - 1)).trimStart();
            const trimmed = visible + "…";
            if (typeof body.set === 'function') body.set('text', trimmed); else body.text = trimmed;
            try {
              const prevReported = (textObjectsRef.current as any).__overflowReported;
              if (overflow && onOverflow && prevReported !== overflow) {
                try { onOverflow(overflow); } catch (e) { /* ignore callback errors */ }
                (textObjectsRef.current as any).__overflowReported = overflow;
              }
            } catch (e) {
              /* ignore */
            }
          }
        } catch (e) {
          /* ignore truncation errors */
        }
        if (typeof body.setCoords === 'function') body.setCoords();
      } catch (e) {}
      try { if (typeof canvas.requestRenderAll === 'function') canvas.requestRenderAll(); else canvas.renderAll(); } catch (e) {}
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to update/create body textbox in data update', e);
    }
  }, [data]);

  // render signatory image if provided in data.signatory.image
  useEffect(() => {
    const canvas = canvasInstanceRef.current;
    const lib = fabricRef.current;
    if (!canvas || !lib) return;
    const sigPath = (data as any)?.signatory?.image;
    const key = "__signatory_image";

    // remove old signatory image if clearing
    if (!sigPath) {
      const old = textObjectsRef.current[key];
      if (old && typeof canvas.remove === "function") {
        try {
          canvas.remove(old);
        } catch (e) {
          /* ignore */
        }
      }
      delete textObjectsRef.current[key];
      try { if (typeof canvas.requestRenderAll === "function") canvas.requestRenderAll(); else canvas.renderAll(); } catch (e) {}
      return;
    }

    // if already present and same src, skip
    const existing = textObjectsRef.current[key];
    if (existing && existing._src === sigPath) return;

    // load and add signatory image
    const imgEl = new Image();
    imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => {
      try {
        const fImg = new lib.Image(imgEl, { selectable: false, evented: false });
        // position at bottom-right by default
        const w = (canvas.getWidth && canvas.getWidth()) || width;
        const h = (canvas.getHeight && canvas.getHeight()) || height;
        const targetW = Math.min(180, w * 0.22);
        if (typeof fImg.scaleToWidth === "function") fImg.scaleToWidth(targetW);
        else if (typeof fImg.scale === "function") fImg.scale(targetW / imgEl.width);
        fImg.set({ left: Math.max(20, w - (fImg.getScaledWidth ? fImg.getScaledWidth() : targetW) - 20), top: Math.max(20, h - (fImg.getScaledHeight ? fImg.getScaledHeight() : 80) - 40), originX: "left", originY: "top", selectable: false, evented: false });
        // remove previous signatory image
        if (existing && typeof canvas.remove === "function") {
          try { canvas.remove(existing); } catch (e) { /* ignore */ }
        }
        textObjectsRef.current[key] = fImg;
        canvas.add(fImg);
        if (typeof canvas.sendToBack === "function") canvas.sendToBack(fImg);
        if (typeof canvas.requestRenderAll === "function") canvas.requestRenderAll(); else canvas.renderAll();
        // store src for comparison
        (textObjectsRef.current[key] as any)._src = sigPath;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to add signatory image", e);
      }
    };
    imgEl.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn("Failed to load signatory image:", sigPath);
    };
    imgEl.src = sigPath;
  }, [data?.signatory?.image]);

  function downloadPNG() {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: "png", quality: 1 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "document.png";
    a.click();
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width, height, border: "1px solid #e2e8f0", background: "#f8fafc", boxSizing: "border-box", position: "relative" }}>
        <canvas ref={canvasRef} width={width} height={height} style={{ display: "block", width: "100%", height: "100%", background: "transparent" }} />
        {!ready && !initError && (
          <div style={{ position: "relative", marginTop: -height, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
            Loading preview...
          </div>
        )}
        {initError && (
          <div style={{ position: "relative", marginTop: -height, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#b91c1c", padding: 12, textAlign: "center" }}>
            Failed to load preview: {initError}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div>Template: {template}</div>
        <div>
          Canvas: {width}x{height}
        </div>
        <button onClick={downloadPNG} disabled={!ready}>
          Export PNG
        </button>
        <div style={{ fontSize: 12, color: "#666" }}>
          For PDF export, convert PNG(s) to PDF server-side or use a client PDF
          library like pdf-lib or jsPDF.
        </div>
      </div>
    </div>
  );
}
