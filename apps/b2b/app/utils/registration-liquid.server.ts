/* eslint-disable @typescript-eslint/no-explicit-any -- field definitions mirror JSON from registrationForm.fields */
/**
 * Storefront registration HTML for app proxy — same delivery model as quick-order.tsx
 * (loader returns `application/liquid`, no React client bundle on the storefront).
 */
import {
   REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT,
   REGISTRATION_COUNTRY_OPTIONS,
   REGISTRATION_STATE_PROVINCE_SUGGESTIONS,
   getProvincesForRegistrationCountry,
   registrationStateDropdownCaption
} from "./registration-address-options";
import { REGISTRATION_COUNTRY_SUBDIVISIONS } from "./registration-country-subdivisions";

export function registrationFieldName(field: any): string {
   if (field?.name && String(field.name).trim()) return String(field.name).trim();
   if (field?.id === "eml") return "email";
   return (
      String(field.label || "field")
         .toLowerCase()
         .trim()
         .replace(/\s+/g, "_")
         .replace(/[^a-z0-9_]/g, "") || "field"
   );
}

function initialRegistrationCountry(fieldsList: any[]): string {
   if (!Array.isArray(fieldsList)) return "";
   const c = fieldsList.find((f: any) => f.presetKey === "country");
   const v = c?.defaultValue != null ? String(c.defaultValue).trim() : "";
   if (v && REGISTRATION_COUNTRY_OPTIONS.some((o) => o.value === v)) return v;
   return "";
}

function esc(s: string): string {
   return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

function registrationLiquidGlobalStyles(): string {
   return `<style>
.b2b-registration-liquid.b2b-reg-shell{
  max-width:920px;margin:0 auto;padding:2rem 1.25rem 3rem;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;color:#202223;
  font-size:1.0625rem;
}
.b2b-registration-liquid.b2b-reg-shell *,.b2b-registration-liquid.b2b-reg-shell *::before,.b2b-registration-liquid.b2b-reg-shell *::after{box-sizing:border-box;}

.b2b-reg-card{
  background:#fff;border-radius:14px;border:1px solid rgba(0,0,0,0.08);
  box-shadow:0 1px 2px rgba(0,0,0,0.04),0 8px 28px rgba(0,0,0,0.07);
  padding:2.25rem 2rem 2.5rem;
}
.b2b-reg-header{
  margin-bottom:1.85rem;padding-bottom:1.35rem;
  border-bottom:1px solid #e3e5e7;
}
.b2b-reg-title{
  margin:0;font-size:1.875rem;font-weight:650;letter-spacing:-0.02em;color:#111213;line-height:1.2;
}
.b2b-reg-lede{
  margin:0.75rem 0 0;font-size:1.0625rem;line-height:1.55;color:#6d7175;
}

.b2b-reg-section-title{
  margin:1.85rem 0 1.1rem;padding-bottom:0.6rem;border-bottom:1px solid #e3e5e7;
  grid-column:1/-1;
  font-size:1.35rem;font-weight:700;line-height:1.25;
  letter-spacing:-0.015em;color:#111213;
}
.b2b-reg-fields > .b2b-reg-section-title:first-of-type{margin-top:0;}

.b2b-reg-fields{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:1.35rem 1.75rem;
  align-items:start;
}
@media (max-width:700px){
  .b2b-registration-liquid.b2b-reg-shell{font-size:1rem;padding:1.25rem 1rem 2rem;}
  .b2b-reg-card{padding:1.5rem 1.15rem 1.75rem;}
  .b2b-reg-title{font-size:1.5rem;}
  .b2b-reg-section-title{font-size:1.125rem;}
  .b2b-reg-fields{grid-template-columns:1fr;gap:1.2rem;}
}

.b2b-reg-field{margin:0;min-width:0;}
.b2b-reg-field--full{grid-column:1/-1;}
.b2b-reg-label{
  display:block;font-size:1rem;font-weight:600;color:#303030;margin-bottom:0.5rem;letter-spacing:0.01em;
}
.b2b-reg-label-req{color:#c5280c;font-weight:700;margin-left:0.2em;}

.b2b-reg-hint{
  margin:0 0 0.55rem;font-size:0.9375rem;line-height:1.5;color:#6d7175;
}

.b2b-reg-input,.b2b-reg-select{
  width:100%;padding:0.85rem 1rem;font-size:1.0625rem;line-height:1.45;color:#202223;
  background:#fff;border:1px solid #c9cccf;border-radius:10px;
  transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease;
}
.b2b-reg-input:hover,.b2b-reg-select:hover{border-color:#aeb1b5;}
.b2b-reg-input:focus,.b2b-reg-select:focus{
  outline:none;border-color:#008060;
  box-shadow:0 0 0 3px rgba(0,128,96,0.18);
}
.b2b-reg-input::placeholder{color:#8c9196;}
.b2b-reg-textarea{min-height:120px;resize:vertical;}
.b2b-reg-select{
  cursor:pointer;appearance:none;-webkit-appearance:none;
  padding-right:2.5rem;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 14 14'%3E%3Cpath fill='none' stroke='%236d7175' stroke-width='1.4' stroke-linecap='round' d='M3.5 5.25L7 8.75l3.5-3.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 0.85rem center;background-size:16px;
}

.b2b-reg-caption{
  margin:0.55rem 0 0;font-size:0.9375rem;line-height:1.45;color:#8c9196;
}

.b2b-reg-choice{
  display:flex;align-items:flex-start;gap:0.65rem;font-size:1.0625rem;line-height:1.45;color:#202223;
  padding:0.4rem 0;cursor:pointer;
}
.b2b-reg-choice input{margin-top:0.2em;accent-color:#008060;width:1.1rem;height:1.1rem;flex-shrink:0;}

.b2b-reg-alert{
  background:linear-gradient(180deg,#fff8f8 0%,#fff4f4 100%);
  border:1px solid #f0b4b4;color:#8e1f0f;padding:1rem 1.1rem;border-radius:10px;margin-bottom:1.35rem;
  font-size:1rem;line-height:1.5;
}
.b2b-reg-alert strong{display:block;margin-bottom:0.35rem;font-weight:650;}

.b2b-reg-actions{margin-top:2rem;}
.b2b-reg-submit{
  display:inline-flex;align-items:center;justify-content:center;width:100%;
  padding:1rem 1.35rem;font-size:1.125rem;font-weight:650;
  color:#fff;background:linear-gradient(180deg,#00996e 0%,#008060 100%);
  border:none;border-radius:10px;cursor:pointer;
  box-shadow:0 1px 0 rgba(255,255,255,0.2) inset,0 2px 6px rgba(0,128,96,0.35);
  transition:filter .15s ease,transform .1s ease;
}
.b2b-reg-submit:hover{filter:brightness(1.05);}
.b2b-reg-submit:active{transform:translateY(1px);}

.b2b-reg-footer{
  text-align:center;font-size:1rem;color:#8c9196;margin-top:1.35rem;line-height:1.55;
}
.b2b-reg-footer a{color:#008060;font-weight:600;text-decoration:none;}
.b2b-reg-footer a:hover{text-decoration:underline;}

.b2b-reg-card--success{text-align:center;padding:2.75rem 2rem;}
.b2b-reg-success-icon{
  width:4.5rem;height:4.5rem;margin:0 auto 1.35rem;border-radius:50%;
  background:linear-gradient(145deg,#e3f5ef 0%,#c8ebe0 100%);
  color:#008060;font-size:2rem;font-weight:700;
  display:flex;align-items:center;justify-content:center;line-height:1;
}
.b2b-reg-success-title{margin:0 0 0.85rem;font-size:1.875rem;font-weight:650;color:#111213;}
.b2b-reg-success-body{margin:0;font-size:1.125rem;line-height:1.6;color:#6d7175;}
.b2b-reg-submit--secondary{
  margin-top:1.65rem;width:auto;min-width:13rem;padding-left:2rem;padding-right:2rem;
  text-decoration:none;font-size:1.0625rem;
}
</style>`;
}

function renderField(
   field: any,
   initialCountry: string,
   ctx: { geoPair: GeoPairContext | null; safeFormId: string }
): string {
   const { geoPair, safeFormId } = ctx;
   const fname = registrationFieldName(field);
   const nameAttr = esc(fname);
   const hint = field.hint ? String(field.hint) : "";
   const opts = Array.isArray(field.options) ? field.options : [];
   const preset = field.presetKey as string | undefined;
   const defaultStr = field.defaultValue != null ? String(field.defaultValue) : "";
   const req = field.required ? " required" : "";
   const provinces = getProvincesForRegistrationCountry(initialCountry);
   const stateListId = `rg-state-${String(field.id || fname).replace(/[^a-z0-9_-]/gi, "")}`;
   const isPairedState = Boolean(geoPair && preset === "state" && field === geoPair.stateField);
   const isPairedCountry = Boolean(geoPair && preset === "country" && field === geoPair.countryField);
   const fullWidthField =
      field.type === "textarea" || field.type === "choice_list" || field.type === "multi_choice";

   let control = "";
   if (field.type === "textarea") {
      control = `<textarea name="${nameAttr}" class="b2b-reg-input b2b-reg-textarea"${req} autocomplete="${
         preset === "address" ? "street-address" : "off"
      }">${esc(defaultStr)}</textarea>`;
   } else if (preset === "country") {
      const optsHtml = REGISTRATION_COUNTRY_OPTIONS.map(
         (o) => `<option value="${esc(o.value)}"${o.value === initialCountry ? " selected" : ""}>${esc(o.label)}</option>`
      ).join("");
      const pairAttr = isPairedCountry ? ' data-b2b-reg-country="1"' : "";
      control = `<select name="${nameAttr}" class="b2b-reg-input b2b-reg-select"${req} autocomplete="country-name"${pairAttr}>
<option value="">${field.required ? "Select country…" : "Select country (optional)…"}</option>${optsHtml}</select>`;
   } else if (preset === "state") {
      const listAttrForText = stateListId;
      const countryChosen = Boolean(String(initialCountry || "").trim());
      /** Combobox (input + datalist) when country is set and subdivisions exist — pick a suggestion or type/edit freely. */
      const showStateCombobox = provinces.length > 0 && countryChosen;
      const stateComboListId = `b2b-reg-st-dl-${safeFormId}`;
      let inner: string;
      if (showStateCombobox) {
         const def = defaultStr && provinces.includes(defaultStr) ? defaultStr : "";
         const dlOpts = provinces.map((p) => `<option value="${esc(p)}"></option>`).join("");
         inner = `<input type="text" name="${nameAttr}" class="b2b-reg-input"${req} list="${esc(
            stateComboListId
         )}" autocomplete="address-level1" placeholder="Choose a suggestion or type…" value="${esc(def)}"/>
<datalist id="${esc(stateComboListId)}">${dlOpts}</datalist>
<p class="b2b-reg-caption">${esc(registrationStateDropdownCaption(initialCountry))} You can edit the text anytime.</p>`;
      } else {
         const hintP = isPairedState
            ? `Choose a country above first. For ${REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT} countries (including the United States, Canada, Australia, Japan, and others) a region dropdown appears once you select one of those countries; otherwise type your region here.`
            : `Select a country in the Country field first. For ${REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT} countries (including the United States, Canada, Australia, Japan, and others) a matching region dropdown appears when the form default country is set, or type your region below.`;
         const dlBlock = isPairedState
            ? ""
            : `<datalist id="${esc(stateListId)}">${REGISTRATION_STATE_PROVINCE_SUGGESTIONS.map(
                 (n) => `<option value="${esc(n)}"></option>`
              ).join("")}</datalist>`;
         const listOnInput = isPairedState ? "" : ` list="${esc(listAttrForText)}"`;
         inner = `<input type="text" name="${nameAttr}" class="b2b-reg-input"${req}${listOnInput} autocomplete="address-level1" placeholder="State or province" value="${esc(defaultStr)}"/>${dlBlock}
<p class="b2b-reg-caption">${esc(hintP)}</p>`;
      }
      control = isPairedState
         ? `<div data-b2b-reg-state-wrap="1" data-state-required="${field.required ? "1" : "0"}" data-state-name="${esc(
              fname
           )}">${inner}</div>`
         : inner;
   } else if (field.type === "dropdown") {
      const ohtml = opts
         .map(
            (o: any) =>
               `<option value="${esc(String(o.value || ""))}"${defaultStr === String(o.value) ? " selected" : ""}>${esc(
                  String(o.label || o.value || "")
               )}</option>`
         )
         .join("");
      control = `<select name="${nameAttr}" class="b2b-reg-input b2b-reg-select"${req}><option value="">Select an option…</option>${ohtml}</select>`;
   } else if (field.type === "choice_list") {
      control = opts
         .map(
            (o: any, i: number) =>
               `<label class="b2b-reg-choice"><input type="radio" name="${nameAttr}" value="${esc(
                  String(o.value || "")
               )}"${field.required && i === 0 ? " required" : ""}/><span>${esc(String(o.label || o.value))}</span></label>`
         )
         .join("");
   } else if (field.type === "multi_choice") {
      control = opts
         .map(
            (o: any) =>
               `<label class="b2b-reg-choice"><input type="checkbox" name="${nameAttr}[]" value="${esc(
                  String(o.value || "")
               )}"/><span>${esc(String(o.label || o.value))}</span></label>`
         )
         .join("");
   } else {
      const t = field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
      const ac =
         preset === "company"
            ? "organization"
            : preset === "city"
              ? "address-level2"
              : preset === "postal"
                ? "postal-code"
                : preset === "phone"
                  ? "tel"
                  : "";
      const ph =
         preset === "city"
            ? "City"
            : preset === "postal"
              ? "ZIP or postal code"
              : preset === "company"
                ? "Legal or trading name"
                : "";
      control = `<input type="${t}" name="${nameAttr}" class="b2b-reg-input"${req} value="${esc(
         defaultStr
      )}"${ac ? ` autocomplete="${esc(ac)}"` : ""}${preset === "postal" ? ' inputmode="text"' : ""}${
         preset === "phone" ? ' inputmode="tel"' : ""
      }${ph ? ` placeholder="${esc(ph)}"` : ""}/>`;
   }

   const hintBlock = hint ? `<p class="b2b-reg-hint">${esc(hint)}</p>` : "";
   const fieldClass = `b2b-reg-field${fullWidthField ? " b2b-reg-field--full" : ""}`;
   return `<div class="${fieldClass}"><label class="b2b-reg-label">${esc(String(field.label || ""))}${
      field.required ? '<span class="b2b-reg-label-req" aria-hidden="true">*</span>' : ""
   }</label>${hintBlock}${control}</div>`;
}

type GeoPairContext = { countryField: any; stateField: any };

function collectAllFields(sections: ReturnType<typeof sortSections>): any[] {
   if (sections.mode === "flat") return sections.flat;
   return [...sections.primary, ...sections.business, ...sections.custom];
}

function resolveGeoPair(fields: any[]): GeoPairContext | null {
   if (!Array.isArray(fields)) return null;
   const countries = fields.filter((f: any) => f.presetKey === "country");
   const states = fields.filter((f: any) => f.presetKey === "state");
   if (countries.length !== 1 || states.length !== 1) return null;
   return { countryField: countries[0], stateField: states[0] };
}

function sortSections(fields: any[]) {
   const hasSection = Array.isArray(fields) && fields.some((f: any) => f.section);
   if (!hasSection) return { mode: "flat" as const, flat: Array.isArray(fields) ? fields : [] };
   return {
      mode: "sections" as const,
      primary: fields.filter((f: any) => f.section === "primary"),
      business: fields.filter((f: any) => f.section === "business"),
      custom: fields.filter((f: any) => f.section === "custom")
   };
}

function buildCountryStateSyncScript(safeFormId: string): string {
   return `<script>
(function(){
var SAFE=${JSON.stringify(safeFormId)};
var root=document.getElementById("b2b-reg-root-"+SAFE);
if(!root)return;
var elSub=document.getElementById("b2b-reg-sub-"+SAFE);
if(!elSub)return;
var sub;
try{sub=JSON.parse(elSub.textContent||"{}");}catch(e){return;}
var country=root.querySelector("[data-b2b-reg-country]");
var wrap=root.querySelector("[data-b2b-reg-state-wrap]");
if(!country||!wrap)return;
var DLID="b2b-reg-st-dl-"+SAFE;
function cls(n){while(n.firstChild)n.removeChild(n.firstChild);}
function capText(c,hasProv){
if(hasProv)return "Official states, provinces, or regions for "+c+". You can edit the text anytime.";
return c?"Type your state or province (no fixed list for this country).":"Choose a country first, then pick or type your state / province.";
}
function refresh(){
var cval=country.value||"";
var prov=sub[cval];
if(!Array.isArray(prov))prov=[];
var req=wrap.getAttribute("data-state-required")==="1";
var nm=wrap.getAttribute("data-state-name")||"";
cls(wrap);
var hasProv=cval&&prov.length>0;
if(hasProv){
var dl=document.createElement("datalist");
dl.id=DLID;
for(var i=0;i<prov.length;i++){
var o=document.createElement("option");
o.value=prov[i];
dl.appendChild(o);
}
wrap.appendChild(dl);
var ctrl=document.createElement("input");
ctrl.type="text";
ctrl.name=nm;
ctrl.className="b2b-reg-input";
ctrl.setAttribute("autocomplete","address-level1");
ctrl.setAttribute("list",DLID);
ctrl.setAttribute("placeholder","Choose a suggestion or type…");
if(req)ctrl.required=true;
wrap.appendChild(ctrl);
}else{
var ctrl=document.createElement("input");
ctrl.type="text";
ctrl.name=nm;
ctrl.className="b2b-reg-input";
ctrl.setAttribute("autocomplete","address-level1");
ctrl.setAttribute("placeholder","State or province");
if(req)ctrl.required=true;
wrap.appendChild(ctrl);
}
var p=document.createElement("p");
p.className="b2b-reg-caption";
p.textContent=capText(cval,hasProv);
wrap.appendChild(p);
}
country.addEventListener("change",refresh);
})();
</script>`;
}

export function buildRegistrationProxyMarkup(args: {
   formName: string;
   fields: any[];
   shop: string;
   formId: string;
   actionUrl: string;
   thankYou: boolean;
   thankYouMessage?: string;
   errorMessage?: string;
}): string {
   const { formName, fields, shop, formId, actionUrl, thankYou, thankYouMessage, errorMessage } = args;
   const initialCountry = initialRegistrationCountry(fields);
   const sections = sortSections(fields);
   const geoPair = resolveGeoPair(collectAllFields(sections));
   const safeFormId = String(formId || "form").replace(/[^a-z0-9_-]/gi, "") || "form";
   const ctx = { geoPair, safeFormId };

   if (thankYou) {
      return `<div class="b2b-registration-liquid b2b-reg-shell">
  <div class="b2b-reg-card b2b-reg-card--success">
    <div class="b2b-reg-success-icon" aria-hidden="true">✓</div>
    <h1 class="b2b-reg-success-title">Application Received</h1>
    <p class="b2b-reg-success-body">${esc(thankYouMessage || "Thank you! Your registration has been submitted for approval.")}</p>
    <a class="b2b-reg-submit b2b-reg-submit--secondary" href="https://${esc(shop)}/">Back to Store</a>
  </div>
</div>${registrationLiquidGlobalStyles()}`;
   }

   let body = "";
   if (sections.mode === "flat") {
      body = sections.flat.map((f) => renderField(f, initialCountry, ctx)).join("");
   } else {
      if (sections.primary.length) {
         body += `<h2 class="b2b-reg-section-title">Primary contact</h2>${sections.primary
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
      if (sections.business.length) {
         body += `<h2 class="b2b-reg-section-title">Business details</h2>${sections.business
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
      if (sections.custom.length) {
         body += `<h2 class="b2b-reg-section-title">More details</h2>${sections.custom
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
   }

   const errBlock = errorMessage
      ? `<div class="b2b-reg-alert" role="alert"><strong>Something went wrong</strong>${esc(
           errorMessage
        )}</div>`
      : "";

   const geoExtras =
      geoPair != null
         ? `<script type="application/json" id="b2b-reg-sub-${safeFormId}">${JSON.stringify(
              REGISTRATION_COUNTRY_SUBDIVISIONS
           ).replace(/</g, "\\u003c")}</script>${buildCountryStateSyncScript(safeFormId)}`
         : "";

   return `<div class="b2b-registration-liquid b2b-reg-shell" id="b2b-reg-root-${safeFormId}">
  <div class="b2b-reg-card">
    <header class="b2b-reg-header">
      <h1 class="b2b-reg-title">${esc(formName)}</h1>
      <p class="b2b-reg-lede">Please complete all sections. Fields marked <span class="b2b-reg-label-req">*</span> are required.</p>
    </header>
    ${errBlock}
    <form class="b2b-reg-form" method="post" action="${esc(actionUrl)}">
      <input type="hidden" name="shop" value="${esc(shop)}"/>
      <input type="hidden" name="formId" value="${esc(formId)}"/>
      <div class="b2b-reg-fields">${body}</div>
      <div class="b2b-reg-actions">
        <button type="submit" class="b2b-reg-submit">Submit registration</button>
      </div>
      <p class="b2b-reg-footer">Already have an account? <a href="https://${esc(shop)}/account/login">Log in here</a></p>
    </form>${geoExtras}
  </div>
</div>${registrationLiquidGlobalStyles()}`;
}
