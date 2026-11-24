window.__ModuleLoader__.load({ id: "dsh-hippocampus", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/src/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// client/src/MemoryView.tsx
var import_react = require("react");

// client/src/icons.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function Icon({ size = 14, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children
    }
  );
}
var IconBrain = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5v13" })
] });
var IconSearch = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "11", cy: "11", r: "7" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m20 20-3.5-3.5" })
] });
var IconRefresh = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M21 3v6h-6" })
] });
var IconPencil = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { ...p, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" }) });
var IconArchive = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "2", y: "3", width: "20", height: "5", rx: "1" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10 12h4" })
] });
var IconCheck = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { ...p, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M20 6 9 17l-5-5" }) });
var IconX = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M18 6 6 18" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m6 6 12 12" })
] });
var IconGauge = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 14 15.5 10.5" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.34 19a10 10 0 1 1 17.32 0" })
] });
var IconLayers = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m12 2 10 5-10 5L2 7Z" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m2 17 10 5 10-5" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m2 12 10 5 10-5" })
] });
var IconSparkles = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.94 14.06 4 16l5.94 1.94L12 24l2.06-6.06L20 16l-5.94-1.94L12 8Z", transform: "translate(0 -4)" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M20 3v4" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M22 5h-4" })
] });
var IconShield = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m9 12 2 2 4-4" })
] });
var IconInbox = (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Icon, { ...p, children: [
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }),
  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" })
] });

// css-module:client/src/ui.module.css
var css = "/*\n * Shared panel styles for the hippocampus tabs (memory browser + compaction\n * panel). Surfaces, borders, labels and state colors come from the DSH theme\n * aliases (--dsw-*), so light and dark themes follow the host. The category\n * accents (violet / teal / amber / pink) use --color-*-500 when a host\n * defines them and otherwise fixed mid-tone fallbacks that read on both. Light theme sits the\n * white cards on the host's bluish canvas, the same layering the host's own\n * dashboards use; dark theme keeps the host background.\n */\n\n.hippo_idrtqd_root {\n  --hp-canvas: transparent;\n  --hp-card-bg: var(--dsw-alias-bg-layer-1, color-mix(in srgb, currentColor 3%, transparent));\n  --hp-tile-bg: var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 4%, transparent));\n  --hp-border: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 12%, transparent));\n  --hp-line: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 14%, transparent));\n  --hp-label: var(--dsw-alias-label-primary, currentColor);\n  --hp-label-2: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 65%, transparent));\n  --hp-label-3: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 45%, transparent));\n  --hp-hover: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 6%, transparent));\n  --hp-shadow: none;\n  --hp-shadow-hover: none;\n  --hp-ok: var(--dsw-alias-state-success-primary, #22c55e);\n  --hp-err: var(--dsw-alias-state-error-primary, #ef4444);\n  --hp-warn: var(--dsw-alias-state-warn-primary, #f59e0b);\n  --hp-info: var(--dsw-alias-state-business-primary, #4176e6);\n  --hp-violet: var(--color-violet-500, #8b5cf6);\n  --hp-teal: var(--color-teal-500, #14b8a6);\n  --hp-amber: var(--color-amber-500, #f59e0b);\n  --hp-pink: var(--color-pink-500, #ec4899);\n  --hp-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);\n  --hp-ease: var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-in-out);\n\n  box-sizing: border-box;\n  height: 100%;\n  overflow-y: auto;\n  padding: 14px 18px 120px;\n  background: var(--hp-canvas);\n  color: var(--hp-label);\n  font-size: 13px;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n\nbody:not([data-ds-dark-theme]) .hippo_idrtqd_root {\n  --hp-canvas: var(--dsw-static-neutral-bluish-75, #f1f3f5);\n  --hp-shadow: var(--dsw-shadow-lv1, 0 2px 4px #0000000d), var(--dsw-shadow-lv1-blur, 0 4px 12px #00000005);\n  --hp-shadow-hover: var(--dsw-shadow-lv2, 0 2px 8px #0000000f);\n}\n\n/* \u2500\u2500 card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_idfy3f_card {\n  background: var(--hp-card-bg);\n  border: 1px solid var(--hp-border);\n  border-radius: 12px;\n  box-shadow: var(--hp-shadow);\n  padding: 12px 14px;\n  min-width: 0;\n}\n\n.hippo_1p9819u_cardSticky {\n  position: sticky;\n  top: 0;\n  z-index: 3;\n}\n\n.hippo_1e0g2wd_cardHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n  padding-bottom: 9px;\n  margin-bottom: 10px;\n  border-bottom: var(--hp-line);\n}\n\n.hippo_gxpy59_cardTitle {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  margin: 0;\n  font-size: 13px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n.hippo_gxpy59_cardTitle svg {\n  color: var(--hp-label-2);\n}\n\n.hippo_1h6a8zp_cardSub {\n  color: var(--hp-label-2);\n  font-size: 12px;\n  font-weight: 400;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.hippo_gxugbw_cardTools {\n  margin-left: auto;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n}\n\n/* \u2500\u2500 buttons & inputs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_14i6nce_iconBtn,\n.hippo_15gbj9h_btn {\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--hp-label-2);\n  font: inherit;\n  cursor: pointer;\n  border-radius: 6px;\n  transition: background-color var(--hp-ease), color var(--hp-ease), border-color var(--hp-ease);\n}\n\n.hippo_14i6nce_iconBtn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 26px;\n  height: 26px;\n  padding: 0;\n}\n\n.hippo_15gbj9h_btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 12px;\n  padding: 3px 10px;\n  border-color: var(--hp-border);\n  color: var(--hp-label);\n}\n\n.hippo_14i6nce_iconBtn:hover:not(:disabled),\n.hippo_15gbj9h_btn:hover:not(:disabled) {\n  background: var(--hp-hover);\n  color: var(--hp-label);\n}\n\n.hippo_14i6nce_iconBtn:disabled,\n.hippo_15gbj9h_btn:disabled {\n  cursor: default;\n  opacity: 0.4;\n}\n\n.hippo_idsm57_spin {\n  animation: hpSpin 0.9s linear infinite;\n}\n\n@keyframes hpSpin {\n  to { transform: rotate(360deg); }\n}\n\n.hippo_gcr4ps_searchBox {\n  flex: 1;\n  min-width: 160px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 10px;\n  height: 30px;\n  border-radius: 8px;\n  border: 1px solid var(--hp-border);\n  background: var(--hp-tile-bg);\n  color: var(--hp-label-3);\n  transition: border-color var(--hp-ease);\n}\n\n.hippo_gcr4ps_searchBox:focus-within {\n  border-color: var(--hp-info);\n}\n\n.hippo_1g7h007_searchInput {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  outline: none;\n  background: transparent;\n  color: var(--hp-label);\n  font: inherit;\n  font-size: 13px;\n}\n\n.hippo_1ya5i1p_segmented {\n  display: inline-flex;\n  padding: 2px;\n  border-radius: 7px;\n  background: var(--hp-hover);\n  gap: 2px;\n}\n\n.hippo_164v778_segment,\n.hippo_1ya5hht_segmentOn {\n  border: none;\n  background: transparent;\n  color: var(--hp-label-2);\n  font: inherit;\n  font-size: 12px;\n  padding: 3px 10px;\n  border-radius: 5px;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.hippo_1ya5hht_segmentOn {\n  background: var(--hp-card-bg);\n  color: var(--hp-label);\n  font-weight: 600;\n  box-shadow: 0 1px 2px #0000001a;\n}\n\n/* \u2500\u2500 KPI tiles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_12evyaq_tiles {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));\n  gap: 8px;\n}\n\n.hippo_idt827_tile {\n  --hp-accent: var(--hp-label-3);\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n  padding: 8px 10px 8px 12px;\n  border-radius: 9px;\n  border: 1px solid var(--hp-border);\n  background: var(--hp-tile-bg);\n  box-shadow: var(--hp-shadow);\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  overflow: hidden;\n  transition: border-color var(--hp-ease), box-shadow var(--hp-ease), background-color var(--hp-ease);\n}\n\n.hippo_idt827_tile::before {\n  content: '';\n  position: absolute;\n  left: 0;\n  top: 8px;\n  bottom: 8px;\n  width: 3px;\n  border-radius: 0 3px 3px 0;\n  background: var(--hp-accent);\n}\n\nbutton.hippo_idt827_tile {\n  cursor: pointer;\n}\n\nbutton.hippo_idt827_tile:hover {\n  box-shadow: var(--hp-shadow-hover);\n  border-color: color-mix(in srgb, var(--hp-accent) 40%, var(--hp-border));\n}\n\n.hippo_idt827_tile[data-on='true'] {\n  border-color: var(--hp-accent);\n  background: color-mix(in srgb, var(--hp-accent) 8%, var(--hp-tile-bg));\n}\n\n.hippo_13xwqjw_tileValue {\n  font-size: 20px;\n  font-weight: 600;\n  line-height: 1.2;\n  font-variant-numeric: tabular-nums;\n  color: var(--hp-accent);\n}\n\n.hippo_13qub4f_tileLabel {\n  font-size: 12px;\n  color: var(--hp-label-2);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.hippo_1u6bl15_tileSub {\n  font-size: 11px;\n  line-height: 1.4;\n  color: var(--hp-label-3);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n/* \u2500\u2500 accents (category / mode / task colors) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_idrtqd_root [data-accent='violet'] { --hp-accent: var(--hp-violet); }\n.hippo_idrtqd_root [data-accent='blue'] { --hp-accent: var(--hp-info); }\n.hippo_idrtqd_root [data-accent='red'] { --hp-accent: var(--hp-err); }\n.hippo_idrtqd_root [data-accent='teal'] { --hp-accent: var(--hp-teal); }\n.hippo_idrtqd_root [data-accent='amber'] { --hp-accent: var(--hp-amber); }\n.hippo_idrtqd_root [data-accent='pink'] { --hp-accent: var(--hp-pink); }\n.hippo_idrtqd_root [data-accent='green'] { --hp-accent: var(--hp-ok); }\n.hippo_idrtqd_root [data-accent='gray'] { --hp-accent: var(--hp-label-3); }\n.hippo_idrtqd_root [data-accent='ink'] { --hp-accent: var(--hp-label); }\n\n.hippo_idg3r9_chip {\n  --hp-accent: var(--hp-label-3);\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 0 7px;\n  height: 20px;\n  border-radius: 5px;\n  font-size: 11px;\n  font-weight: 600;\n  white-space: nowrap;\n  color: var(--hp-accent);\n  background: color-mix(in srgb, var(--hp-accent) 12%, transparent);\n}\n\n.hippo_1gvo0pe_idChip {\n  font-family: var(--hp-mono);\n  font-size: 11px;\n  color: var(--hp-label-2);\n  padding: 0 6px;\n  height: 20px;\n  display: inline-flex;\n  align-items: center;\n  border-radius: 5px;\n  border: 1px solid var(--hp-border);\n}\n\n.hippo_15gbktk_dot {\n  --hp-accent: var(--hp-label-3);\n  width: 8px;\n  height: 8px;\n  border-radius: 2px;\n  flex: none;\n  background: var(--hp-accent);\n}\n\n.hippo_idnqso_meta {\n  font-size: 11px;\n  color: var(--hp-label-3);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.hippo_12a7gbk_muted {\n  color: var(--hp-label-2);\n}\n\n/* \u2500\u2500 memory list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_125wiz2_group {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.hippo_jujmo_groupHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 2px 4px;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--hp-label-2);\n}\n\n.hippo_i3p2wn_groupCount {\n  font-weight: 400;\n  color: var(--hp-label-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.hippo_1jih6re_memory {\n  --hp-accent: var(--hp-label-3);\n  position: relative;\n  padding: 10px 14px 10px 16px;\n  border-radius: 10px;\n  border: 1px solid var(--hp-border);\n  background: var(--hp-card-bg);\n  box-shadow: var(--hp-shadow);\n  transition: box-shadow var(--hp-ease), border-color var(--hp-ease);\n}\n\n.hippo_1jih6re_memory::before {\n  content: '';\n  position: absolute;\n  left: 0;\n  top: 10px;\n  bottom: 10px;\n  width: 3px;\n  border-radius: 0 3px 3px 0;\n  background: var(--hp-accent);\n}\n\n.hippo_1jih6re_memory:hover {\n  box-shadow: var(--hp-shadow-hover);\n  border-color: color-mix(in srgb, var(--hp-accent) 30%, var(--hp-border));\n}\n\n.hippo_1m1jih8_memoryHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n  margin-bottom: 6px;\n}\n\n.hippo_bhe5mb_importance {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 11px;\n  color: var(--hp-label-2);\n  font-variant-numeric: tabular-nums;\n}\n\n.hippo_1ikg1m0_importanceTrack {\n  width: 46px;\n  height: 4px;\n  border-radius: 2px;\n  background: var(--hp-hover);\n  overflow: hidden;\n}\n\n.hippo_1llx24a_importanceFill {\n  height: 100%;\n  border-radius: 2px;\n  background: var(--hp-label-3);\n}\n\n.hippo_1llx24a_importanceFill[data-tier='high'] { background: var(--hp-err); }\n.hippo_1llx24a_importanceFill[data-tier='mid'] { background: var(--hp-warn); }\n.hippo_1llx24a_importanceFill[data-tier='low'] { background: var(--hp-info); }\n\n.hippo_1iehaiz_memoryActions {\n  margin-left: auto;\n  display: inline-flex;\n  gap: 2px;\n  opacity: 0;\n  transition: opacity var(--hp-ease);\n}\n\n.hippo_1jih6re_memory:hover .hippo_1iehaiz_memoryActions,\n.hippo_1iehaiz_memoryActions:focus-within,\n.hippo_1iehaiz_memoryActions[data-sticky='true'] {\n  opacity: 1;\n}\n\n.hippo_1bplwv3_action {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  border: none;\n  background: transparent;\n  color: var(--hp-label-2);\n  font: inherit;\n  font-size: 12px;\n  padding: 2px 8px;\n  border-radius: 6px;\n  cursor: pointer;\n}\n\n.hippo_1bplwv3_action:hover:not(:disabled) {\n  background: var(--hp-hover);\n  color: var(--hp-label);\n}\n\n.hippo_1bplwv3_action[data-armed='true'] {\n  color: var(--hp-err);\n  background: color-mix(in srgb, var(--hp-err) 10%, transparent);\n  font-weight: 600;\n}\n\n.hippo_1bplwv3_action[data-primary='true'] {\n  color: var(--hp-info);\n  font-weight: 600;\n}\n\n.hippo_1bplwv3_action:disabled {\n  cursor: default;\n  opacity: 0.4;\n}\n\n.hippo_1m1f4lk_memoryBody {\n  line-height: 1.65;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}\n\n.hippo_1nysm53_clamped {\n  display: -webkit-box;\n  -webkit-line-clamp: 4;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.hippo_idnz5g_more {\n  margin-top: 4px;\n  border: none;\n  background: transparent;\n  padding: 0;\n  font: inherit;\n  font-size: 12px;\n  color: var(--hp-info);\n  cursor: pointer;\n}\n\n.hippo_idnne4_mark {\n  background: color-mix(in srgb, var(--hp-warn) 35%, transparent);\n  color: inherit;\n  border-radius: 2px;\n  padding: 0 1px;\n}\n\n.hippo_qmv20g_editBox {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.hippo_ql3h34_editArea {\n  width: 100%;\n  box-sizing: border-box;\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.6;\n  padding: 8px 10px;\n  border-radius: 8px;\n  border: 1px solid var(--hp-border);\n  background: var(--hp-tile-bg);\n  color: var(--hp-label);\n  resize: vertical;\n  outline: none;\n}\n\n.hippo_ql3h34_editArea:focus {\n  border-color: var(--hp-info);\n}\n\n.hippo_qmvfgf_editRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  font-size: 12px;\n  color: var(--hp-label-2);\n}\n\n.hippo_qmvfgf_editRow input[type='range'] {\n  width: 160px;\n  accent-color: var(--hp-info);\n}\n\n.hippo_124hr7v_error {\n  font-size: 12px;\n  color: var(--hp-err);\n  white-space: pre-wrap;\n}\n\n/* \u2500\u2500 states \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_12eerdu_state {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 8px;\n  padding: 28px 16px;\n  text-align: center;\n  font-size: 13px;\n  color: var(--hp-label-2);\n}\n\n.hippo_12eerdu_state svg {\n  color: var(--hp-label-3);\n}\n\n.hippo_1a69z29_inlineState {\n  padding: 14px 4px;\n  text-align: center;\n  font-size: 12px;\n  color: var(--hp-label-3);\n}\n\n.hippo_1cbdddj_banner {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 12px;\n  border-radius: 9px;\n  font-size: 12px;\n  border: 1px solid color-mix(in srgb, var(--hp-info) 30%, var(--hp-border));\n  background: color-mix(in srgb, var(--hp-info) 7%, var(--hp-card-bg));\n}\n\n.hippo_1cbdddj_banner[data-tone='error'] {\n  border-color: color-mix(in srgb, var(--hp-err) 35%, var(--hp-border));\n  background: color-mix(in srgb, var(--hp-err) 7%, var(--hp-card-bg));\n  color: var(--hp-err);\n}\n\n.hippo_1cbdddj_banner[data-tone='ok'] {\n  border-color: color-mix(in srgb, var(--hp-ok) 35%, var(--hp-border));\n  background: color-mix(in srgb, var(--hp-ok) 7%, var(--hp-card-bg));\n}\n\n/* \u2500\u2500 cache chart \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_122utlf_chart {\n  display: flex;\n  align-items: flex-end;\n  gap: 2px;\n  height: 120px;\n  padding: 4px 0 0;\n  border-bottom: var(--hp-line);\n}\n\n.hippo_15gbis6_bar {\n  position: relative;\n  flex: 1 1 0;\n  min-width: 3px;\n  max-width: 22px;\n  display: flex;\n  flex-direction: column-reverse;\n  border-radius: 3px 3px 0 0;\n  overflow: visible;\n  cursor: default;\n}\n\n.hippo_15gbis6_bar:hover {\n  filter: brightness(1.08);\n}\n\n.hippo_15gbis6_bar:hover::after {\n  content: '';\n  position: absolute;\n  inset: -4px -1px 0;\n  border-radius: 4px 4px 0 0;\n  background: var(--hp-hover);\n  z-index: -1;\n}\n\n.hippo_1cbftlh_barSeg {\n  width: 100%;\n  min-height: 0;\n}\n\n.hippo_1cbftlh_barSeg:last-child {\n  border-radius: 3px 3px 0 0;\n}\n\n.hippo_1cbftlh_barSeg[data-kind='read'] { background: var(--hp-ok); }\n.hippo_1cbftlh_barSeg[data-kind='write'] { background: var(--hp-amber); }\n.hippo_1cbftlh_barSeg[data-kind='miss'] { background: color-mix(in srgb, var(--hp-label-3) 55%, transparent); }\n\n.hippo_idfn7j_bust {\n  position: absolute;\n  left: 50%;\n  top: -9px;\n  width: 6px;\n  height: 6px;\n  margin-left: -3px;\n  border-radius: 50%;\n  background: var(--hp-err);\n  box-shadow: 0 0 0 2px var(--hp-card-bg);\n}\n\n.hippo_idexqu_axis {\n  display: flex;\n  justify-content: space-between;\n  margin-top: 4px;\n  font-size: 11px;\n  color: var(--hp-label-3);\n  font-variant-numeric: tabular-nums;\n}\n\n.hippo_1iv1isw_legend {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 14px;\n  margin-top: 8px;\n  font-size: 12px;\n  color: var(--hp-label-2);\n}\n\n.hippo_f9kjy7_legendItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n}\n\n.hippo_9tg4je_legendSwatch {\n  width: 9px;\n  height: 9px;\n  border-radius: 2px;\n}\n\n.hippo_9tg4je_legendSwatch[data-kind='read'] { background: var(--hp-ok); }\n.hippo_9tg4je_legendSwatch[data-kind='write'] { background: var(--hp-amber); }\n.hippo_9tg4je_legendSwatch[data-kind='miss'] { background: color-mix(in srgb, var(--hp-label-3) 55%, transparent); }\n.hippo_9tg4je_legendSwatch[data-kind='bust'] { background: var(--hp-err); border-radius: 50%; }\n\n/* \u2500\u2500 run rows (compaction + dreamer) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.hippo_idrtxo_rows {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n}\n\n.hippo_15gbwl5_row {\n  display: grid;\n  grid-template-columns: 22px minmax(76px, auto) 1fr auto;\n  align-items: start;\n  column-gap: 10px;\n  padding: 8px 6px;\n  border-radius: 8px;\n}\n\n.hippo_15gbwl5_row + .hippo_15gbwl5_row {\n  border-top: var(--hp-line);\n}\n\n.hippo_15gbwl5_row:hover {\n  background: var(--hp-hover);\n}\n\n.hippo_15gbwl5_row[data-status='error'] {\n  background: color-mix(in srgb, var(--hp-err) 6%, transparent);\n}\n\n.hippo_1nom6lh_status {\n  width: 18px;\n  height: 18px;\n  margin-top: 1px;\n  border-radius: 50%;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.hippo_1nom6lh_status[data-status='ok'] {\n  color: var(--hp-ok);\n  background: color-mix(in srgb, var(--hp-ok) 14%, transparent);\n}\n\n.hippo_1nom6lh_status[data-status='error'] {\n  color: var(--hp-err);\n  background: color-mix(in srgb, var(--hp-err) 14%, transparent);\n}\n\n.hippo_rjkkxq_rowMain {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n\n.hippo_rjq2se_rowText {\n  font-size: 12.5px;\n  line-height: 1.55;\n  overflow-wrap: anywhere;\n}\n\n.hippo_15gbwl5_row[data-status='error'] .hippo_rjq2se_rowText {\n  color: var(--hp-err);\n}\n\n.hippo_1kfkgyy_rowFacts {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px 12px;\n  font-size: 11.5px;\n  color: var(--hp-label-2);\n  font-variant-numeric: tabular-nums;\n}\n\n.hippo_1kfkgyy_rowFacts b {\n  font-weight: 600;\n  color: var(--hp-label);\n}\n\n.hippo_64n3jb_details {\n  font-size: 12px;\n}\n\n.hippo_64n3jb_details summary {\n  cursor: pointer;\n  color: var(--hp-info);\n  list-style: none;\n  user-select: none;\n}\n\n.hippo_64n3jb_details summary::-webkit-details-marker {\n  display: none;\n}\n\n.hippo_1fsie2d_detailsBody {\n  margin-top: 6px;\n  padding: 8px 10px;\n  border-radius: 8px;\n  background: var(--hp-tile-bg);\n  border: 1px solid var(--hp-border);\n  max-height: 260px;\n  overflow: auto;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  line-height: 1.55;\n  color: var(--hp-label-2);\n}\n\n.hippo_uh6mlx_listFoot {\n  display: flex;\n  justify-content: center;\n  padding-top: 8px;\n}\n\n.hippo_15gbwl5_row > .hippo_idg3r9_chip {\n  justify-self: start;\n  margin-top: 0;\n}\n";
var tagId = "dsh-hippocampus/ui.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-hippocampus";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var ui_default = { "root": "hippo_idrtqd_root", "card": "hippo_idfy3f_card", "cardSticky": "hippo_1p9819u_cardSticky", "cardHead": "hippo_1e0g2wd_cardHead", "cardTitle": "hippo_gxpy59_cardTitle", "cardSub": "hippo_1h6a8zp_cardSub", "cardTools": "hippo_gxugbw_cardTools", "iconBtn": "hippo_14i6nce_iconBtn", "btn": "hippo_15gbj9h_btn", "spin": "hippo_idsm57_spin", "searchBox": "hippo_gcr4ps_searchBox", "searchInput": "hippo_1g7h007_searchInput", "segmented": "hippo_1ya5i1p_segmented", "segment": "hippo_164v778_segment", "segmentOn": "hippo_1ya5hht_segmentOn", "tiles": "hippo_12evyaq_tiles", "tile": "hippo_idt827_tile", "tileValue": "hippo_13xwqjw_tileValue", "tileLabel": "hippo_13qub4f_tileLabel", "tileSub": "hippo_1u6bl15_tileSub", "chip": "hippo_idg3r9_chip", "idChip": "hippo_1gvo0pe_idChip", "dot": "hippo_15gbktk_dot", "meta": "hippo_idnqso_meta", "muted": "hippo_12a7gbk_muted", "group": "hippo_125wiz2_group", "groupHead": "hippo_jujmo_groupHead", "groupCount": "hippo_i3p2wn_groupCount", "memory": "hippo_1jih6re_memory", "memoryHead": "hippo_1m1jih8_memoryHead", "importance": "hippo_bhe5mb_importance", "importanceTrack": "hippo_1ikg1m0_importanceTrack", "importanceFill": "hippo_1llx24a_importanceFill", "memoryActions": "hippo_1iehaiz_memoryActions", "action": "hippo_1bplwv3_action", "memoryBody": "hippo_1m1f4lk_memoryBody", "clamped": "hippo_1nysm53_clamped", "more": "hippo_idnz5g_more", "mark": "hippo_idnne4_mark", "editBox": "hippo_qmv20g_editBox", "editArea": "hippo_ql3h34_editArea", "editRow": "hippo_qmvfgf_editRow", "error": "hippo_124hr7v_error", "state": "hippo_12eerdu_state", "inlineState": "hippo_1a69z29_inlineState", "banner": "hippo_1cbdddj_banner", "chart": "hippo_122utlf_chart", "bar": "hippo_15gbis6_bar", "barSeg": "hippo_1cbftlh_barSeg", "bust": "hippo_idfn7j_bust", "axis": "hippo_idexqu_axis", "legend": "hippo_1iv1isw_legend", "legendItem": "hippo_f9kjy7_legendItem", "legendSwatch": "hippo_9tg4je_legendSwatch", "rows": "hippo_idrtxo_rows", "row": "hippo_15gbwl5_row", "status": "hippo_1nom6lh_status", "rowMain": "hippo_rjkkxq_rowMain", "rowText": "hippo_rjq2se_rowText", "rowFacts": "hippo_1kfkgyy_rowFacts", "details": "hippo_64n3jb_details", "detailsBody": "hippo_1fsie2d_detailsBody", "listFoot": "hippo_uh6mlx_listFoot" };

// client/src/MemoryView.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var CATEGORY_ORDER = ["PROJECT_RULES", "ARCHITECTURE", "CONSTRAINTS", "CONFIG_VALUES", "NAMING"];
var CATEGORY_ACCENT = {
  PROJECT_RULES: "violet",
  ARCHITECTURE: "blue",
  CONSTRAINTS: "red",
  CONFIG_VALUES: "teal",
  NAMING: "amber"
};
var accentOf = (category) => CATEGORY_ACCENT[category] ?? "gray";
async function fetchProject(cwd) {
  if (cwd === void 0 || cwd === "") return null;
  const response = await fetch(`/plugins/hippocampus/api/resolve?path=${encodeURIComponent(cwd)}`);
  if (!response.ok) return null;
  const reply = await response.json();
  return reply.project ?? null;
}
function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shortRoot(root) {
  const parts = root.split("/").filter(Boolean);
  return parts.length <= 2 ? root : `\u2026/${parts.slice(-2).join("/")}`;
}
function highlight(text, needle) {
  if (needle === "") return text;
  const lower = text.toLowerCase();
  const out = [];
  let from = 0;
  for (; ; ) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)("mark", { className: ui_default.mark, children: text.slice(at, at + needle.length) }, at));
    from = at + needle.length;
  }
  if (out.length === 0) return text;
  out.push(text.slice(from));
  return out;
}
var categoryLabel = (t, category) => {
  const key = `category.${category}`;
  const text = t(key);
  return text === key ? category : text;
};
function MemoryView({ sessionId, useSessions, t }) {
  const cwd = useSessions((s) => s.byId[sessionId]?.cwd);
  const [rows, setRows] = (0, import_react.useState)(null);
  const [stats, setStats] = (0, import_react.useState)(null);
  const [project, setProject] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [filter, setFilter] = (0, import_react.useState)("ALL");
  const [query, setQuery] = (0, import_react.useState)("");
  const [sort, setSort] = (0, import_react.useState)("recent");
  const loadSeq = (0, import_react.useRef)(0);
  const load = (0, import_react.useCallback)(async (quiet = false) => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    if (!quiet) setRows(null);
    setLoading(true);
    setError(null);
    try {
      const resolved = await fetchProject(cwd);
      if (!current()) return;
      setProject(resolved);
      if (resolved === null) {
        setRows([]);
        setStats(null);
        return;
      }
      const [memories, statsReply] = await Promise.all([
        fetch(`/plugins/hippocampus/api/memories?project=${encodeURIComponent(resolved.id)}`),
        fetch(`/plugins/hippocampus/api/stats?project=${encodeURIComponent(resolved.id)}`)
      ]);
      if (!memories.ok || !statsReply.ok) throw new Error(`HTTP ${memories.ok ? statsReply.status : memories.status}`);
      const nextRows = (await memories.json()).memories;
      const nextStats = await statsReply.json();
      if (!current()) return;
      setRows(nextRows);
      setStats(nextStats);
    } catch (reason) {
      if (!current()) return;
      setError(String(reason instanceof Error ? reason.message : reason));
      if (!quiet) {
        setRows([]);
        setStats(null);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [cwd]);
  (0, import_react.useEffect)(() => {
    void load();
  }, [load]);
  const needle = query.trim().toLowerCase();
  const grouped = (0, import_react.useMemo)(() => {
    const source = rows ?? [];
    const filtered = needle === "" ? source : source.filter((row) => row.content.toLowerCase().includes(needle) || row.category.toLowerCase().includes(needle) || `m${row.id}` === needle || `m${row.id}`.startsWith(needle));
    const visible = filter === "ALL" ? filtered : filtered.filter((row) => row.category === filter);
    const byCategory = /* @__PURE__ */ new Map();
    for (const row of visible) {
      const bucket = byCategory.get(row.category) ?? [];
      bucket.push(row);
      byCategory.set(row.category, bucket);
    }
    for (const bucket of byCategory.values()) {
      bucket.sort(sort === "importance" ? (a, b) => b.importance - a.importance || b.created_at - a.created_at : (a, b) => b.created_at - a.created_at);
    }
    const rank = (c) => {
      const i = CATEGORY_ORDER.indexOf(c);
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    const categories2 = [...byCategory.keys()].sort((a, b) => rank(a) - rank(b));
    return categories2.map((category) => [category, byCategory.get(category)]);
  }, [rows, filter, needle, sort]);
  const shown = grouped.reduce((sum, [, bucket]) => sum + bucket.length, 0);
  const onSearchKeyDown = (event) => {
    if (event.key === "Escape") setQuery("");
  };
  if (rows === null && error === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: ui_default.root, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: ui_default.state, children: t("list.loading") }) });
  }
  const total = stats ? Object.values(stats.byCategory).reduce((a, b) => a + b, 0) : rows?.length ?? 0;
  const categories = stats ? Object.keys(stats.byCategory).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a), bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  }) : [];
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: `${ui_default.card} ${ui_default.cardSticky}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: ui_default.cardHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { className: ui_default.cardTitle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconBrain, {}),
          t("list.title")
        ] }),
        project !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.cardSub, title: project.root, children: shortRoot(project.root) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.cardTools, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            className: ui_default.iconBtn,
            onClick: () => {
              void load(true);
            },
            "aria-label": t("list.refresh"),
            title: t("list.refresh"),
            disabled: loading,
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: loading ? ui_default.spin : void 0, style: { display: "inline-flex" }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconRefresh, {}) })
          }
        ) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.tiles, role: "group", "aria-label": t("list.aria"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            "aria-pressed": filter === "ALL",
            className: ui_default.tile,
            "data-accent": "ink",
            "data-on": filter === "ALL",
            onClick: () => {
              setFilter("ALL");
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileValue, children: total }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileLabel, children: t("filter.all") })
            ]
          }
        ),
        categories.map((category) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            "aria-pressed": filter === category,
            className: ui_default.tile,
            "data-accent": accentOf(category),
            "data-on": filter === category,
            onClick: () => {
              setFilter(filter === category ? "ALL" : category);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileValue, children: stats?.byCategory[category] ?? 0 }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileLabel, children: categoryLabel(t, category) })
            ]
          },
          category
        )),
        stats !== null && stats.archived > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.tile, "data-accent": "gray", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileValue, children: stats.archived }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileLabel, children: t("list.archived") })
        ] }) : null,
        stats !== null && stats.pendingEmbeddings > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.tile, "data-accent": "amber", title: t("list.pendingSub"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileValue, children: stats.pendingEmbeddings }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileLabel, children: t("list.pending") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.tileSub, children: t("list.pendingSub") })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.editRow, style: { marginTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: ui_default.searchBox, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconSearch, {}),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "search",
              className: ui_default.searchInput,
              placeholder: t("search.placeholder"),
              value: query,
              onChange: (e) => {
                setQuery(e.target.value);
              },
              onKeyDown: onSearchKeyDown,
              "aria-label": t("search.placeholder")
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: ui_default.segmented, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", "aria-pressed": sort === "recent", className: sort === "recent" ? ui_default.segmentOn : ui_default.segment, onClick: () => {
            setSort("recent");
          }, children: t("sort.recent") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", "aria-pressed": sort === "importance", className: sort === "importance" ? ui_default.segmentOn : ui_default.segment, onClick: () => {
            setSort("importance");
          }, children: t("sort.importance") })
        ] }),
        (needle !== "" || filter !== "ALL") && rows !== null && rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.meta, children: t("list.shown", { shown, total: rows.length }) }) : null
      ] })
    ] }),
    error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.banner, "data-tone": "error", children: [
      t("list.error", { reason: error }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: ui_default.btn, onClick: () => {
        void load();
      }, children: t("list.refresh") })
    ] }) : null,
    rows !== null && rows.length === 0 && error === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: ui_default.card, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.state, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconInbox, { size: 28 }),
      t("list.empty")
    ] }) }) : null,
    grouped.length === 0 && rows !== null && rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: ui_default.card, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.state, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconSearch, { size: 24 }),
      t("search.noMatch")
    ] }) }) : null,
    grouped.map(([category, bucket]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: ui_default.group, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h3", { className: ui_default.groupHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.dot, "data-accent": accentOf(category) }),
        categoryLabel(t, category),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.groupCount, children: bucket.length })
      ] }),
      bucket.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        MemoryCard,
        {
          row,
          needle,
          t,
          onChanged: () => {
            void load(true);
          }
        },
        row.id
      ))
    ] }, category))
  ] });
}
var tierOf = (importance) => importance >= 80 ? "high" : importance >= 60 ? "mid" : "low";
function MemoryCard({ row, needle, t, onChanged }) {
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [draft, setDraft] = (0, import_react.useState)(row.content);
  const [draftImportance, setDraftImportance] = (0, import_react.useState)(row.importance);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [cardError, setCardError] = (0, import_react.useState)(null);
  const [armed, setArmed] = (0, import_react.useState)(false);
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const [overflows, setOverflows] = (0, import_react.useState)(false);
  const bodyRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    setDraft(row.content);
    setDraftImportance(row.importance);
  }, [row.content, row.importance]);
  (0, import_react.useEffect)(() => {
    if (!armed) return;
    const timer = setTimeout(() => {
      setArmed(false);
    }, 3e3);
    return () => {
      clearTimeout(timer);
    };
  }, [armed]);
  const post = async (path, body) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
  };
  const save = async () => {
    if (busy) return;
    if (draft.trim() === "") {
      setCardError(t("edit.empty"));
      return;
    }
    setBusy(true);
    setCardError(null);
    try {
      await post("/plugins/hippocampus/api/memories/edit", { id: row.id, content: draft, importance: draftImportance });
      setEditing(false);
      onChanged();
    } catch (reason) {
      setCardError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setCardError(null);
    try {
      await post("/plugins/hippocampus/api/memories/archive", { id: row.id });
      onChanged();
    } catch (reason) {
      setCardError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  const clamped = !expanded && needle === "";
  (0, import_react.useLayoutEffect)(() => {
    const el = bodyRef.current;
    if (el === null || !clamped) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [clamped, row.content, editing]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: ui_default.memory, "data-accent": accentOf(row.category), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.memoryHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: ui_default.idChip, children: [
        "m",
        row.id
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: ui_default.importance, title: t("importance.aria", { value: row.importance }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.importanceTrack, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.importanceFill, "data-tier": tierOf(row.importance), style: { width: `${Math.max(4, Math.min(100, row.importance))}%`, display: "block" } }) }),
        row.importance
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.meta, children: formatDate(row.created_at) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: ui_default.memoryActions, "data-sticky": editing || armed, children: editing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: ui_default.action, "data-primary": "true", disabled: busy, onClick: () => {
          void save();
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconCheck, { size: 13 }),
          t("edit.save")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: ui_default.action, disabled: busy, onClick: () => {
          setEditing(false);
          setCardError(null);
          setDraft(row.content);
          setDraftImportance(row.importance);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconX, { size: 13 }),
          t("edit.cancel")
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: ui_default.action, disabled: busy, onClick: () => {
          setEditing(true);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconPencil, { size: 13 }),
          t("edit.edit")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: ui_default.action, "data-armed": armed, disabled: busy, onClick: () => {
          void archive();
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconArchive, { size: 13 }),
          armed ? t("edit.confirmArchive") : t("edit.archive")
        ] })
      ] }) })
    ] }),
    editing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: ui_default.editBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "textarea",
        {
          className: ui_default.editArea,
          value: draft,
          onChange: (event) => {
            setDraft(event.target.value);
          },
          rows: Math.min(14, Math.max(3, Math.ceil(draft.length / 70))),
          disabled: busy,
          "aria-label": t("edit.edit")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: ui_default.editRow, children: [
        t("edit.importance"),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            type: "range",
            min: 1,
            max: 100,
            value: draftImportance,
            onChange: (event) => {
              setDraftImportance(Number(event.target.value));
            },
            disabled: busy
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("b", { style: { fontVariantNumeric: "tabular-nums" }, children: draftImportance })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { ref: bodyRef, className: clamped ? `${ui_default.memoryBody} ${ui_default.clamped}` : ui_default.memoryBody, children: highlight(row.content, needle) }),
      needle === "" && (expanded || overflows) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: ui_default.more, onClick: () => {
        setExpanded(!expanded);
      }, children: expanded ? t("list.collapse") : t("list.expand") }) : null
    ] }),
    cardError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: ui_default.error, children: cardError }) : null
  ] });
}

// client/src/ContextView.tsx
var import_react2 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var EMPTY = { model: null, cache: { rows: [], busts: 0 }, compactions: [], compactionRuns: [], dreamRuns: [] };
var CACHE_ROWS_CAP = 120;
var COMPACTION_RUNS_CAP = 20;
var DREAM_RUNS_CAP = 50;
var DREAM_PAGE = 12;
async function fetchProjectId(cwd) {
  if (cwd === void 0 || cwd === "") return null;
  const response = await fetch(`/plugins/hippocampus/api/resolve?path=${encodeURIComponent(cwd)}`);
  if (!response.ok) return null;
  const reply = await response.json();
  return reply.project?.id ?? null;
}
function formatDate2(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? day : `${d.getFullYear()}-${day}`;
}
function formatTokens(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}
var pct = (rate) => `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`;
var hitAccent = (rate) => rate >= 0.7 ? "green" : rate >= 0.4 ? "amber" : "red";
var MODE_ACCENT = {
  background: "blue",
  overflow: "red",
  region: "amber",
  historian: "violet",
  commit: "teal",
  reclaim: "amber"
};
var modeLabel = (t, mode) => {
  const key = `ctx.mode.${mode}`;
  const text = t(key);
  return text === key ? mode : text;
};
var eventLabel = (t, type) => {
  if (type === "compaction/start") return t("ctx.event.start");
  if (type === "compaction/summary") return t("ctx.event.summary");
  if (type === "compaction/end") return t("ctx.event.end");
  if (type === "compaction/prune") return t("ctx.event.prune");
  return type;
};
function dreamResultText(t, run) {
  const r = run.result;
  if (r === null) return "";
  if (typeof r.error === "string") return r.error;
  if (typeof r.checked === "number") return t("ctx.dreamer.checked", { checked: r.checked, applied: Number(r.applied ?? 0) });
  if (typeof r.considered === "number") return t("ctx.dreamer.considered", { considered: r.considered, applied: Number(r.applied ?? 0) });
  if (r.task === "verify" && Object.keys(r).length === 1) return t("ctx.dreamer.nothing");
  return JSON.stringify(r).slice(0, 160);
}
var dreamApplied = (run) => {
  const r = run.result;
  return r !== null && typeof r.applied === "number" ? r.applied : 0;
};
function StatusIcon({ ok, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.status, "data-status": ok ? "ok" : "error", role: "img", "aria-label": ok ? t("ctx.status.ok") : t("ctx.status.error"), children: ok ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconCheck, { size: 11 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconX, { size: 11 }) });
}
function CacheChart({ rows, t }) {
  const max = Math.max(1, ...rows.map((row) => row.input));
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.chart, role: "img", "aria-label": t("ctx.cache.title"), children: rows.map((row) => {
      const miss = Math.max(0, row.input - row.cacheRead - row.cacheWrite);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "div",
        {
          className: ui_default.bar,
          style: { height: `${Math.max(2, row.input / max * 100)}%` },
          title: t("ctx.cache.tip", {
            seq: row.seq,
            rate: pct(row.hitRate),
            read: formatTokens(row.cacheRead),
            write: formatTokens(row.cacheWrite),
            miss: formatTokens(miss)
          }) + (row.bust ? ` \xB7 ${t("ctx.cache.bust")}` : ""),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.barSeg, "data-kind": "read", style: { height: row.input > 0 ? `${row.cacheRead / row.input * 100}%` : 0 } }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.barSeg, "data-kind": "write", style: { height: row.input > 0 ? `${row.cacheWrite / row.input * 100}%` : 0 } }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.barSeg, "data-kind": "miss", style: { height: row.input > 0 ? `${miss / row.input * 100}%` : 0 } }),
            row.bust ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.bust }) : null
          ]
        },
        row.seq
      );
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.axis, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("ctx.cache.axisSeq", { seq: rows[0]?.seq ?? 0 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("ctx.cache.axisMax", { value: formatTokens(max) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("ctx.cache.axisSeq", { seq: rows.at(-1)?.seq ?? 0 }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.legend, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.legendItem, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.legendSwatch, "data-kind": "read" }),
        t("ctx.cache.read")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.legendItem, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.legendSwatch, "data-kind": "write" }),
        t("ctx.cache.write")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.legendItem, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.legendSwatch, "data-kind": "miss" }),
        t("ctx.cache.miss")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.legendItem, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.legendSwatch, "data-kind": "bust" }),
        t("ctx.cache.bust")
      ] })
    ] })
  ] });
}
function CompactionRunRow({ run, t }) {
  const ok = run.status === "ok";
  const facts = [];
  if (run.shadowedStart !== null || run.shadowedEnd !== null) {
    facts.push(t("ctx.compaction.shadowed", { start: String(run.shadowedStart ?? "?"), end: String(run.shadowedEnd ?? "?") }));
  }
  if (run.usage != null) {
    facts.push(t("ctx.compaction.input", { value: formatTokens(run.usage.inputTokens ?? 0) }));
    if ((run.usage.outputTokens ?? 0) > 0) facts.push(t("ctx.compaction.output", { value: formatTokens(run.usage.outputTokens ?? 0) }));
    if ((run.usage.cacheReadTokens ?? 0) > 0) facts.push(t("ctx.compaction.cacheRead", { value: formatTokens(run.usage.cacheReadTokens ?? 0) }));
  }
  if (run.durationMs != null && run.durationMs > 0) facts.push(`${(run.durationMs / 1e3).toFixed(1)}s`);
  const summary = run.summary?.text;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: ui_default.row, "data-status": ok ? "ok" : "error", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StatusIcon, { ok, t }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.chip, "data-accent": MODE_ACCENT[run.mode] ?? "gray", children: modeLabel(t, run.mode) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.rowMain, children: [
      !ok ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.rowText, children: run.error ?? t("ctx.compaction.failed") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.rowFacts, children: [
        run.model !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: run.model }) : null,
        facts.map((fact) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: fact }, fact))
      ] }),
      summary != null && summary !== "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: ui_default.details, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: t("ctx.compaction.summary") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.detailsBody, children: summary })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.meta, children: formatDate2(run.ranAt) })
  ] });
}
function ContextView({ sessionId, useSessions, t }) {
  const cwd = useSessions((s) => s.byId[sessionId]?.cwd);
  const [data, setData] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [projectId, setProjectId] = (0, import_react2.useState)(null);
  const [triggering, setTriggering] = (0, import_react2.useState)(null);
  const [triggerNote, setTriggerNote] = (0, import_react2.useState)(null);
  const [dreamFilter, setDreamFilter] = (0, import_react2.useState)("all");
  const [dreamLimit, setDreamLimit] = (0, import_react2.useState)(DREAM_PAGE);
  const loadSeq = (0, import_react2.useRef)(0);
  const load = (0, import_react2.useCallback)(async (quiet = false) => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    if (!quiet) setData(null);
    setLoading(true);
    setError(null);
    try {
      const project = await fetchProjectId(cwd);
      if (!current()) return;
      setProjectId(project);
      if (project === null) {
        setData(EMPTY);
        return;
      }
      const response = await fetch(
        `/plugins/hippocampus/api/context?session=${encodeURIComponent(sessionId)}&project=${encodeURIComponent(project)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reply = { ...EMPTY, ...await response.json() };
      if (current()) setData(reply);
    } catch (reason) {
      if (!current()) return;
      setError(String(reason instanceof Error ? reason.message : reason));
      if (!quiet) {
        setProjectId(null);
        setData(EMPTY);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [sessionId, cwd]);
  const triggerDreamer = (0, import_react2.useCallback)(async (task) => {
    if (projectId === null || triggering !== null) return;
    setTriggering(task);
    setTriggerNote(null);
    try {
      const response = await fetch("/plugins/hippocampus/api/dreamer/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectId, task })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      setTriggerNote(payload?.status === "ok" ? { ok: true, text: t("ctx.dreamer.done") } : { ok: false, text: `${t("ctx.dreamer.failed")}: ${payload?.result?.error ?? ""}` });
    } catch (reason) {
      setTriggerNote({ ok: false, text: String(reason instanceof Error ? reason.message : reason) });
    } finally {
      setTriggering(null);
      void load(true);
    }
  }, [projectId, triggering, t, load]);
  (0, import_react2.useEffect)(() => {
    void load();
  }, [load]);
  const hasFailedDreams = data?.dreamRuns.some((run) => run.status !== "ok") ?? false;
  (0, import_react2.useEffect)(() => {
    if (!hasFailedDreams) setDreamFilter("all");
  }, [hasFailedDreams]);
  const kpi = (0, import_react2.useMemo)(() => {
    if (data === null) return null;
    const rows = data.cache.rows;
    const input = rows.reduce((sum, row) => sum + row.input, 0);
    const read = rows.reduce((sum, row) => sum + row.cacheRead, 0);
    const runs = data.compactionRuns;
    const rewrites = data.compactions.filter((hit) => hit.type === "compaction/summary" || hit.type === "compaction/prune" && hit.ridesCommit !== true).length;
    return {
      calls: rows.length,
      input,
      read,
      hit: input > 0 ? read / input : 0,
      busts: data.cache.busts,
      capped: rows.length >= CACHE_ROWS_CAP,
      rewrites,
      summaries: runs.filter((run) => run.mode === "historian" && run.status === "ok").length,
      runsFailed: runs.filter((run) => run.status !== "ok").length,
      runsCapped: runs.length >= COMPACTION_RUNS_CAP,
      dreams: data.dreamRuns.length,
      dreamsFailed: data.dreamRuns.filter((run) => run.status !== "ok").length
    };
  }, [data]);
  if (data === null || kpi === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.root, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.state, children: t("ctx.loading") }) });
  }
  const dreams = dreamFilter === "failed" ? data.dreamRuns.filter((run) => run.status !== "ok") : data.dreamRuns;
  const hasCompactions = data.compactionRuns.length > 0 || data.compactions.length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.root, children: [
    error !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.banner, "data-tone": "error", children: [
      t("ctx.error", { reason: error }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: ui_default.btn, onClick: () => {
        void load();
      }, children: t("ctx.refresh") })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: ui_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: ui_default.cardHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h2", { className: ui_default.cardTitle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconGauge, {}),
          t("ctx.cache.title")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.cardSub, children: [
          data.model !== null ? `${data.model} \xB7 ` : "",
          t("ctx.cache.sub")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.cardTools, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: ui_default.iconBtn,
            onClick: () => {
              void load(true);
            },
            "aria-label": t("ctx.refresh"),
            title: t("ctx.refresh"),
            disabled: loading,
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: loading ? ui_default.spin : void 0, style: { display: "inline-flex" }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconRefresh, {}) })
          }
        ) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tiles, style: { marginBottom: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tile, "data-accent": "ink", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileValue, children: kpi.calls }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileLabel, children: t("ctx.kpi.calls") }),
          kpi.capped ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileSub, children: t("ctx.cache.recent", { count: kpi.calls }) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tile, "data-accent": kpi.calls > 0 ? hitAccent(kpi.hit) : "gray", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileValue, children: kpi.calls > 0 ? pct(kpi.hit) : "\u2014" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileLabel, children: t("ctx.kpi.hit") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileSub, children: t("ctx.kpi.hitSub", { read: formatTokens(kpi.read), input: formatTokens(kpi.input) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tile, "data-accent": kpi.busts > 0 ? "red" : "gray", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileValue, children: kpi.busts }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileLabel, children: t("ctx.kpi.busts") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileSub, children: t("ctx.kpi.bustsSub") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tile, "data-accent": kpi.runsFailed > 0 ? "amber" : "violet", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileValue, children: kpi.rewrites }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileLabel, children: t("ctx.kpi.compactions") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.tileSub, children: [
            kpi.summaries > 0 ? t("ctx.kpi.summaries", { count: kpi.summaries, capped: kpi.runsCapped ? "+" : "" }) : t("ctx.kpi.compactionsSub"),
            kpi.runsFailed > 0 ? ` \xB7 ${t("ctx.kpi.failed", { count: kpi.runsFailed })}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.tile, "data-accent": kpi.dreamsFailed > 0 ? "amber" : "teal", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.tileValue, children: [
            kpi.dreams,
            kpi.dreams >= DREAM_RUNS_CAP ? "+" : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.tileLabel, children: t("ctx.kpi.dreams") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.tileSub, children: [
            t("ctx.kpi.dreamsSub"),
            kpi.dreamsFailed > 0 ? ` \xB7 ${t("ctx.kpi.failed", { count: kpi.dreamsFailed })}` : ""
          ] })
        ] })
      ] }),
      data.cache.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.inlineState, children: t("ctx.cache.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CacheChart, { rows: data.cache.rows, t })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: ui_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("header", { className: ui_default.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h2", { className: ui_default.cardTitle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconLayers, {}),
        t("ctx.compaction.title")
      ] }) }),
      !hasCompactions ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.inlineState, children: t("ctx.compaction.empty") }) : null,
      data.compactionRuns.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: ui_default.rows, children: data.compactionRuns.map((run) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CompactionRunRow, { run, t }, `run-${run.id}`)) }) : null,
      data.compactions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: ui_default.details, open: data.compactionRuns.length === 0, style: { marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: t("ctx.compaction.events", { count: data.compactions.length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: ui_default.rows, style: { marginTop: 6 }, children: data.compactions.map((hit) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: ui_default.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.dot, "data-accent": hit.type === "compaction/summary" ? "blue" : hit.type === "compaction/prune" ? "amber" : "gray", style: { marginTop: 5, marginLeft: 5 } }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.chip, "data-accent": hit.type === "compaction/summary" ? "blue" : hit.type === "compaction/prune" ? "amber" : "gray", children: eventLabel(t, hit.type) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ui_default.rowMain, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.meta, children: [
              "seq ",
              hit.seq
            ] }),
            hit.snippet !== null && hit.snippet !== "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: `${ui_default.rowText} ${ui_default.muted}`, children: hit.snippet }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.meta, children: formatDate2(hit.time) })
        ] }, hit.seq)) })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: ui_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: ui_default.cardHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h2", { className: ui_default.cardTitle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconSparkles, {}),
          t("ctx.dreamer.title")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.cardSub, children: t("ctx.dreamer.sub") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.cardTools, children: [
          hasFailedDreams ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ui_default.segmented, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "aria-pressed": dreamFilter === "all", className: dreamFilter === "all" ? ui_default.segmentOn : ui_default.segment, onClick: () => {
              setDreamFilter("all");
            }, children: t("ctx.dreamer.all") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "aria-pressed": dreamFilter === "failed", className: dreamFilter === "failed" ? ui_default.segmentOn : ui_default.segment, onClick: () => {
              setDreamFilter("failed");
            }, children: t("ctx.dreamer.failedOnly") })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: ui_default.btn,
              disabled: projectId === null || triggering !== null,
              onClick: () => {
                void triggerDreamer("verify");
              },
              title: t("ctx.dreamer.verifyTip"),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconShield, { size: 13 }),
                triggering === "verify" ? t("ctx.dreamer.running") : t("ctx.dreamer.verify")
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: ui_default.btn,
              disabled: projectId === null || triggering !== null,
              onClick: () => {
                void triggerDreamer("curate");
              },
              title: t("ctx.dreamer.curateTip"),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconSparkles, { size: 13 }),
                triggering === "curate" ? t("ctx.dreamer.running") : t("ctx.dreamer.curate")
              ]
            }
          )
        ] })
      ] }),
      triggerNote !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.banner, "data-tone": triggerNote.ok ? "ok" : "error", style: { marginBottom: 8 }, children: triggerNote.text }) : null,
      dreams.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.inlineState, children: t("ctx.dreamer.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: ui_default.rows, children: dreams.slice(0, dreamLimit).map((run) => {
        const ok = run.status === "ok";
        const applied = dreamApplied(run);
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: ui_default.row, "data-status": ok ? "ok" : "error", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StatusIcon, { ok, t }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.chip, "data-accent": run.task === "verify" ? "teal" : "violet", children: run.task === "verify" ? t("ctx.dreamer.task.verify") : run.task === "curate" ? t("ctx.dreamer.task.curate") : run.task }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.rowMain, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.rowText, style: ok && applied > 0 ? { fontWeight: 600 } : void 0, children: dreamResultText(t, run) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ui_default.meta, children: formatDate2(run.ranAt) })
        ] }, `dream-${run.id}`);
      }) }),
      dreams.length > dreamLimit ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ui_default.listFoot, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: ui_default.btn, onClick: () => {
        setDreamLimit(dreamLimit + DREAM_PAGE * 2);
      }, children: t("ctx.dreamer.more", { count: Math.min(DREAM_PAGE * 2, dreams.length - dreamLimit) }) }) }) : null
    ] })
  ] });
}

// client/src/locales.ts
var NS = "hippocampus";
var zh = {
  "view.label": "\u8BB0\u5FC6",
  "ctx.view.label": "\u538B\u7F29\u4E0E\u6574\u7406",
  "ctx.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "ctx.error": "\u52A0\u8F7D\u5931\u8D25\uFF1A{reason}",
  "ctx.refresh": "\u5237\u65B0",
  "ctx.kpi.calls": "\u6A21\u578B\u8C03\u7528",
  "ctx.kpi.hit": "\u7F13\u5B58\u547D\u4E2D\u7387",
  "ctx.kpi.hitSub": "\u6309\u8F93\u5165\u91CF\u52A0\u6743\uFF1A\u8BFB {read} / \u8F93\u5165 {input}",
  "ctx.kpi.busts": "\u7F13\u5B58\u51FB\u7A7F",
  "ctx.kpi.bustsSub": "\u5168\u4F1A\u8BDD \xB7 \u524D\u7F00\u88AB\u6362\u540E\u7684\u9996\u6B21\u8C03\u7528",
  "ctx.kpi.compactions": "\u524D\u7F00\u66FF\u6362",
  "ctx.kpi.compactionsSub": "\u5168\u4F1A\u8BDD \xB7 \u65E5\u5FD7\u91CC\u7684\u538B\u7F29\u66FF\u6362",
  "ctx.kpi.summaries": "\u53E6\u6709 {count}{capped} \u6B21\u5206\u6BB5\u603B\u7ED3",
  "ctx.kpi.failed": "{count} \u6B21\u5931\u8D25",
  "ctx.kpi.dreams": "\u540E\u53F0\u6574\u7406",
  "ctx.kpi.dreamsSub": "\u672C\u9879\u76EE\u6700\u8FD1 50 \u6B21\u5185",
  "ctx.cache.title": "\u7F13\u5B58\u547D\u4E2D",
  "ctx.cache.sub": "\u6BCF\u6839\u67F1\u4E00\u6B21\u6A21\u578B\u8C03\u7528\uFF0C\u9AD8\u5EA6\u4E3A\u8F93\u5165\u91CF",
  "ctx.cache.empty": "\u8FD8\u6CA1\u6709\u6A21\u578B\u8C03\u7528\u8BB0\u5F55\u3002",
  "ctx.cache.read": "\u7F13\u5B58\u8BFB",
  "ctx.cache.write": "\u7F13\u5B58\u5199",
  "ctx.cache.miss": "\u672A\u7F13\u5B58",
  "ctx.cache.bust": "\u51FB\u7A7F",
  "ctx.cache.tip": "seq {seq} \xB7 \u547D\u4E2D {rate} \xB7 \u8BFB {read} / \u5199 {write} / \u672A\u7F13\u5B58 {miss}",
  "ctx.cache.recent": "\u56FE\u4E0A\u6700\u8FD1 {count} \u6B21",
  "ctx.cache.axisSeq": "seq {seq}",
  "ctx.cache.axisMax": "\u6700\u9AD8 {value}",
  "ctx.status.ok": "\u6210\u529F",
  "ctx.status.error": "\u5931\u8D25",
  "ctx.compaction.title": "\u538B\u7F29\u8BB0\u5F55",
  "ctx.compaction.empty": "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u53D1\u751F\u8FC7\u4E0A\u4E0B\u6587\u538B\u7F29\u3002",
  "ctx.compaction.events": "\u538B\u7F29\u4E8B\u4EF6\uFF08{count}\uFF09",
  "ctx.compaction.shadowed": "\u906E\u853D seq {start}\u2013{end}",
  "ctx.compaction.input": "\u8F93\u5165 {value}",
  "ctx.compaction.output": "\u8F93\u51FA {value}",
  "ctx.compaction.cacheRead": "\u7F13\u5B58\u8BFB {value}",
  "ctx.compaction.summary": "\u67E5\u770B\u6458\u8981",
  "ctx.compaction.failed": "\u5931\u8D25",
  "ctx.event.start": "\u5F00\u59CB",
  "ctx.event.summary": "\u6458\u8981",
  "ctx.event.end": "\u5B8C\u6210",
  "ctx.event.prune": "\u56DE\u6536",
  "ctx.mode.background": "\u540E\u53F0",
  "ctx.mode.overflow": "\u6EA2\u51FA\u6062\u590D",
  "ctx.mode.region": "\u624B\u52A8\u533A\u95F4",
  "ctx.mode.historian": "\u5206\u6BB5\u603B\u7ED3",
  "ctx.mode.commit": "\u6362\u4E0A\u5386\u53F2",
  "ctx.mode.reclaim": "\u56DE\u6536\u5DE5\u5177\u8F93\u51FA",
  "ctx.dreamer.title": "\u540E\u53F0\u6574\u7406",
  "ctx.dreamer.sub": "\u8BB0\u5FC6\u7684\u9A8C\u8BC1\u4E0E\u6574\u7406\u4EFB\u52A1",
  "ctx.dreamer.empty": "\u8FD8\u6CA1\u6709\u6574\u7406\u4EFB\u52A1\u8FD0\u884C\u8BB0\u5F55\u3002",
  "ctx.dreamer.verify": "\u7ACB\u5373\u9A8C\u8BC1",
  "ctx.dreamer.curate": "\u7ACB\u5373\u6574\u7406",
  "ctx.dreamer.verifyTip": "\u73B0\u5728\u5BF9\u672C\u9879\u76EE\u8BB0\u5FC6\u8FD0\u884C\u4E00\u6B21\u9A8C\u8BC1\u4EFB\u52A1",
  "ctx.dreamer.curateTip": "\u73B0\u5728\u5BF9\u672C\u9879\u76EE\u8BB0\u5FC6\u8FD0\u884C\u4E00\u6B21\u6574\u7406\u4EFB\u52A1",
  "ctx.dreamer.running": "\u8FD0\u884C\u4E2D\u2026",
  "ctx.dreamer.done": "\u4EFB\u52A1\u5B8C\u6210\u3002",
  "ctx.dreamer.failed": "\u4EFB\u52A1\u5931\u8D25",
  "ctx.dreamer.task.verify": "\u9A8C\u8BC1",
  "ctx.dreamer.task.curate": "\u6574\u7406",
  "ctx.dreamer.checked": "\u68C0\u67E5 {checked} \u6761\uFF0C\u5E94\u7528 {applied} \u5904",
  "ctx.dreamer.considered": "\u5BA1\u9605 {considered} \u6761\uFF0C\u5E94\u7528 {applied} \u5904",
  "ctx.dreamer.nothing": "\u65E0\u5F85\u9A8C\u8BC1\u8BB0\u5FC6",
  "ctx.dreamer.all": "\u5168\u90E8",
  "ctx.dreamer.failedOnly": "\u4EC5\u5931\u8D25",
  "ctx.dreamer.more": "\u518D\u663E\u793A {count} \u6761",
  "edit.edit": "\u7F16\u8F91",
  "edit.save": "\u4FDD\u5B58",
  "edit.cancel": "\u53D6\u6D88",
  "edit.archive": "\u5F52\u6863",
  "edit.confirmArchive": "\u786E\u8BA4\u5F52\u6863\uFF1F",
  "edit.importance": "\u91CD\u8981\u6027",
  "edit.empty": "\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A\u3002",
  "search.placeholder": "\u641C\u7D22\u8BB0\u5FC6\uFF08\u5185\u5BB9\u3001\u5206\u7C7B\u6216 m \u7F16\u53F7\uFF09\u2026",
  "search.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u8BB0\u5FC6\u3002",
  "filter.all": "\u5168\u90E8",
  "sort.recent": "\u6700\u65B0",
  "sort.importance": "\u91CD\u8981\u6027",
  "list.aria": "\u9879\u76EE\u8BB0\u5FC6",
  "list.title": "\u9879\u76EE\u8BB0\u5FC6",
  "list.empty": "\u672C\u9879\u76EE\u8FD8\u6CA1\u6709\u8BB0\u5FC6\u3002\u4F1A\u8BDD\u4E2D\u5199\u5165\u7684\u957F\u671F\u8BB0\u5FC6\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "list.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "list.error": "\u52A0\u8F7D\u5931\u8D25\uFF1A{reason}",
  "list.archived": "\u5DF2\u5F52\u6863",
  "list.pending": "\u5F85\u5D4C\u5165",
  "list.pendingSub": "\u8BED\u4E49\u68C0\u7D22\u6682\u4E0D\u53EF\u7528",
  "list.refresh": "\u5237\u65B0",
  "list.expand": "\u5C55\u5F00",
  "list.collapse": "\u6536\u8D77",
  "list.shown": "\u663E\u793A {shown} / {total} \u6761",
  "category.PROJECT_RULES": "\u9879\u76EE\u89C4\u5219",
  "category.ARCHITECTURE": "\u67B6\u6784",
  "category.CONSTRAINTS": "\u786C\u6027\u7EA6\u675F",
  "category.CONFIG_VALUES": "\u5173\u952E\u914D\u7F6E",
  "category.NAMING": "\u547D\u540D\u7EA6\u5B9A",
  "importance.aria": "\u91CD\u8981\u6027 {value}"
};
var en = {
  "view.label": "Memories",
  "ctx.view.label": "Compaction & curation",
  "ctx.loading": "Loading\u2026",
  "ctx.error": "Failed to load: {reason}",
  "ctx.refresh": "Refresh",
  "ctx.kpi.calls": "Model calls",
  "ctx.kpi.hit": "Cache hit rate",
  "ctx.kpi.hitSub": "input-weighted: read {read} / input {input}",
  "ctx.kpi.busts": "Cache busts",
  "ctx.kpi.bustsSub": "whole session \xB7 first call after a rewrite",
  "ctx.kpi.compactions": "Prefix rewrites",
  "ctx.kpi.compactionsSub": "whole session \xB7 replacements in the log",
  "ctx.kpi.summaries": "plus {count}{capped} historian summaries",
  "ctx.kpi.failed": "{count} failed",
  "ctx.kpi.dreams": "Curation runs",
  "ctx.kpi.dreamsSub": "within this project's last 50",
  "ctx.cache.title": "Cache hits",
  "ctx.cache.sub": "one bar per model call, height = input size",
  "ctx.cache.empty": "No model calls recorded yet.",
  "ctx.cache.read": "Cache read",
  "ctx.cache.write": "Cache write",
  "ctx.cache.miss": "Uncached",
  "ctx.cache.bust": "Bust",
  "ctx.cache.tip": "seq {seq} \xB7 hit {rate} \xB7 read {read} / write {write} / uncached {miss}",
  "ctx.cache.recent": "last {count} on the chart",
  "ctx.cache.axisSeq": "seq {seq}",
  "ctx.cache.axisMax": "max {value}",
  "ctx.status.ok": "succeeded",
  "ctx.status.error": "failed",
  "ctx.compaction.title": "Compactions",
  "ctx.compaction.empty": "No context compaction has happened in this session yet.",
  "ctx.compaction.events": "Compaction events ({count})",
  "ctx.compaction.shadowed": "shadowed seq {start}\u2013{end}",
  "ctx.compaction.input": "input {value}",
  "ctx.compaction.output": "output {value}",
  "ctx.compaction.cacheRead": "cache read {value}",
  "ctx.compaction.summary": "Show summary",
  "ctx.compaction.failed": "failed",
  "ctx.event.start": "Start",
  "ctx.event.summary": "Summary",
  "ctx.event.end": "Done",
  "ctx.event.prune": "Pruned",
  "ctx.mode.background": "Background",
  "ctx.mode.overflow": "Overflow",
  "ctx.mode.region": "Region",
  "ctx.mode.historian": "Historian",
  "ctx.mode.commit": "Commit",
  "ctx.mode.reclaim": "Reclaim",
  "ctx.dreamer.title": "Background curation",
  "ctx.dreamer.sub": "memory verify and curate tasks",
  "ctx.dreamer.empty": "No curation runs recorded yet.",
  "ctx.dreamer.verify": "Verify now",
  "ctx.dreamer.curate": "Curate now",
  "ctx.dreamer.verifyTip": "Run one verify task for this project now",
  "ctx.dreamer.curateTip": "Run one curate task for this project now",
  "ctx.dreamer.running": "Running\u2026",
  "ctx.dreamer.done": "Task finished.",
  "ctx.dreamer.failed": "Task failed",
  "ctx.dreamer.task.verify": "Verify",
  "ctx.dreamer.task.curate": "Curate",
  "ctx.dreamer.checked": "checked {checked}, applied {applied}",
  "ctx.dreamer.considered": "reviewed {considered}, applied {applied}",
  "ctx.dreamer.nothing": "nothing to verify",
  "ctx.dreamer.all": "All",
  "ctx.dreamer.failedOnly": "Failed",
  "ctx.dreamer.more": "Show {count} more",
  "edit.edit": "Edit",
  "edit.save": "Save",
  "edit.cancel": "Cancel",
  "edit.archive": "Archive",
  "edit.confirmArchive": "Confirm archive?",
  "edit.importance": "Importance",
  "edit.empty": "Content must not be empty.",
  "search.placeholder": "Search memories (content, category, or m id)\u2026",
  "search.noMatch": "No matching memories.",
  "filter.all": "All",
  "sort.recent": "Newest",
  "sort.importance": "Importance",
  "list.aria": "Project memories",
  "list.title": "Project memory",
  "list.empty": "No memories yet for this project. Long-term facts written during sessions appear here.",
  "list.loading": "Loading\u2026",
  "list.error": "Failed to load: {reason}",
  "list.archived": "Archived",
  "list.pending": "Pending embedding",
  "list.pendingSub": "semantic search unavailable for these",
  "list.refresh": "Refresh",
  "list.expand": "Expand",
  "list.collapse": "Collapse",
  "list.shown": "showing {shown} / {total}",
  "category.PROJECT_RULES": "Rules",
  "category.ARCHITECTURE": "Architecture",
  "category.CONSTRAINTS": "Constraints",
  "category.CONFIG_VALUES": "Config",
  "category.NAMING": "Naming",
  "importance.aria": "importance {value}"
};

// client/src/index.ts
var inject = ["slots", "locale"];
var EMPTY_SNAPSHOT = Object.freeze({});
var ConstantViewBuilder = class {
  empty = EMPTY_SNAPSHOT;
  replace() {
    return EMPTY_SNAPSHOT;
  }
  apply() {
    return EMPTY_SNAPSHOT;
  }
};
var constantView = (target) => ({
  target,
  create: () => new ConstantViewBuilder()
});
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "hippocampus: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.inject(["conversationViews"], (viewsCtx) => {
    viewsCtx.effect(() => viewsCtx.conversationViews.register(constantView("hippocampus")), "hippocampus: view definition");
    viewsCtx.effect(() => viewsCtx.conversationViews.register(constantView("hippocampus-context")), "hippocampus: context view definition");
  });
  ctx.slots.inject(
    "conversation.view",
    () => ctx.slots.register({
      name: "conversation.view",
      id: "hippocampus",
      // After trajectory: memory is reference material, read after the fact.
      order: 20,
      locale: NS,
      label: () => t("view.label")
    }, MemoryView)
  );
  ctx.slots.inject(
    "conversation.view",
    () => ctx.slots.register({
      name: "conversation.view",
      id: "hippocampus-context",
      // Right after the memory tab: same plugin, reference surface.
      order: 21,
      locale: NS,
      label: () => t("ctx.view.label")
    }, ContextView)
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
