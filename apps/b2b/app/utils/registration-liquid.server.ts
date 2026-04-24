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

const inputStyle =
   "width:100%;padding:12px 16px;border-radius:8px;border:1px solid #d1d1d1;font-size:1em;box-sizing:border-box;";
const labelStyle = "display:block;font-size:0.9em;font-weight:600;color:#202223;margin-bottom:8px;";
const selectStyle = `${inputStyle}cursor:pointer;background:#fff;`;
const sectionTitle =
   "font-size:1.05rem;font-weight:700;color:#202223;margin:8px 0 4px;padding-bottom:8px;border-bottom:1px solid #ececec;";

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

   let control = "";
   if (field.type === "textarea") {
      control = `<textarea name="${nameAttr}" class="b2b-reg-input"${req} style="${inputStyle}min-height:100px;resize:vertical;" autocomplete="${
         preset === "address" ? "street-address" : "off"
      }">${esc(defaultStr)}</textarea>`;
   } else if (preset === "country") {
      const optsHtml = REGISTRATION_COUNTRY_OPTIONS.map(
         (o) => `<option value="${esc(o.value)}"${o.value === initialCountry ? " selected" : ""}>${esc(o.label)}</option>`
      ).join("");
      const pairAttr = isPairedCountry ? ' data-b2b-reg-country="1"' : "";
      control = `<select name="${nameAttr}" class="b2b-reg-input"${req} style="${selectStyle}" autocomplete="country-name"${pairAttr}>
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
         inner = `<input type="text" name="${nameAttr}" class="b2b-reg-input"${req} style="${inputStyle}" list="${esc(
            stateComboListId
         )}" autocomplete="address-level1" placeholder="Choose a suggestion or type…" value="${esc(def)}"/>
<datalist id="${esc(stateComboListId)}">${dlOpts}</datalist>
<p style="margin:6px 0 0;font-size:0.8rem;color:#8c9196;">${esc(
            registrationStateDropdownCaption(initialCountry)
         )} You can edit the text anytime.</p>`;
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
         inner = `<input type="text" name="${nameAttr}" class="b2b-reg-input"${req} style="${inputStyle}"${listOnInput} autocomplete="address-level1" placeholder="State or province" value="${esc(defaultStr)}"/>${dlBlock}
<p style="margin:6px 0 0;font-size:0.8rem;color:#8c9196;">${esc(hintP)}</p>`;
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
      control = `<select name="${nameAttr}" class="b2b-reg-input"${req} style="${selectStyle}"><option value="">Select an option…</option>${ohtml}</select>`;
   } else if (field.type === "choice_list") {
      control = opts
         .map(
            (o: any, i: number) =>
               `<label style="display:flex;align-items:center;gap:8px;font-size:0.95em;"><input type="radio" name="${nameAttr}" value="${esc(
                  String(o.value || "")
               )}"${field.required && i === 0 ? " required" : ""}/><span>${esc(String(o.label || o.value))}</span></label>`
         )
         .join("");
   } else if (field.type === "multi_choice") {
      control = opts
         .map(
            (o: any) =>
               `<label style="display:flex;align-items:center;gap:8px;font-size:0.95em;"><input type="checkbox" name="${nameAttr}[]" value="${esc(
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
      control = `<input type="${t}" name="${nameAttr}" class="b2b-reg-input"${req} style="${inputStyle}" value="${esc(
         defaultStr
      )}"${ac ? ` autocomplete="${esc(ac)}"` : ""}${preset === "postal" ? ' inputmode="text"' : ""}${
         preset === "phone" ? ' inputmode="tel"' : ""
      }${ph ? ` placeholder="${esc(ph)}"` : ""}/>`;
   }

   const hintBlock = hint
      ? `<p style="margin:4px 0 8px;font-size:0.85em;color:#6d7175;">${esc(hint)}</p>`
      : "";
   return `<div style="margin-bottom:4px;"><label style="${labelStyle}">${esc(String(field.label || ""))} ${
      field.required ? '<span style="color:#d72c0d">*</span>' : ""
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
   const styIn = JSON.stringify(inputStyle);
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
var STY_IN=${styIn};
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
ctrl.style.cssText=STY_IN;
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
ctrl.style.cssText=STY_IN;
ctrl.setAttribute("autocomplete","address-level1");
ctrl.setAttribute("placeholder","State or province");
if(req)ctrl.required=true;
wrap.appendChild(ctrl);
}
var p=document.createElement("p");
p.style.margin="6px 0 0";
p.style.fontSize="0.8rem";
p.style.color="#8c9196";
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
      return `<div class="b2b-registration-liquid" style="max-width:600px;margin:0 auto;padding:2rem 1.25rem;">
  <div style="background:#fff;padding:40px;border-radius:16px;border:1px solid #e1e1e1;text-align:center;">
    <div style="font-size:4em;margin-bottom:20px;">✅</div>
    <h1 style="font-size:1.8em;color:#202223;margin-bottom:15px;">Application Received</h1>
    <p style="color:#6d7175;font-size:1.1em;line-height:1.6;">${esc(thankYouMessage || "Thank you! Your registration has been submitted for approval.")}</p>
    <a href="https://${esc(shop)}/" style="display:inline-block;margin-top:24px;padding:14px 20px;background:#008060;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Back to Store</a>
  </div>
</div>`;
   }

   let body = "";
   if (sections.mode === "flat") {
      body = sections.flat.map((f) => renderField(f, initialCountry, ctx)).join("");
   } else {
      if (sections.primary.length) {
         body += `<h2 style="${sectionTitle}">Primary contact</h2>${sections.primary
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
      if (sections.business.length) {
         body += `<h2 style="${sectionTitle} margin-top:28px;">Business details</h2>${sections.business
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
      if (sections.custom.length) {
         body += `<h2 style="${sectionTitle} margin-top:28px;">More details</h2>${sections.custom
            .map((f) => renderField(f, initialCountry, ctx))
            .join("")}`;
      }
   }

   const errBlock = errorMessage
      ? `<div style="background:#fff4f4;border:1px solid #ffcece;color:#c10000;padding:12px;border-radius:8px;margin-bottom:20px;font-size:0.9em;">⚠️ ${esc(
           errorMessage
        )}</div>`
      : "";

   const geoExtras =
      geoPair != null
         ? `<script type="application/json" id="b2b-reg-sub-${safeFormId}">${JSON.stringify(
              REGISTRATION_COUNTRY_SUBDIVISIONS
           ).replace(/</g, "\\u003c")}</script>${buildCountryStateSyncScript(safeFormId)}`
         : "";

   return `<div class="b2b-registration-liquid" id="b2b-reg-root-${safeFormId}" style="max-width:600px;margin:0 auto;padding:1.5rem 1.25rem 3rem;">
  <div style="background:#fff;padding:40px;border-radius:16px;border:1px solid #e1e1e1;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
    <div style="border-bottom:1px solid #e1e1e1;padding-bottom:20px;margin-bottom:30px;">
      <h1 style="margin:0;font-size:1.6em;color:#202223;">${esc(formName)}</h1>
      <p style="color:#6d7175;margin:10px 0 0;font-size:0.95em;">Please complete all sections. Fields marked * are required.</p>
    </div>
    ${errBlock}
    <form method="post" action="${esc(actionUrl)}">
      <input type="hidden" name="shop" value="${esc(shop)}"/>
      <input type="hidden" name="formId" value="${esc(formId)}"/>
      <div style="display:flex;flex-direction:column;gap:20px;">${body}</div>
      <div style="margin-top:10px;">
        <button type="submit" style="width:100%;background:#008060;color:#fff;border:none;padding:14px 20px;border-radius:8px;font-size:1.1em;font-weight:bold;cursor:pointer;">Submit Registration</button>
      </div>
      <p style="text-align:center;font-size:0.85em;color:#8c9196;margin-top:16px;">Already have an account? <a href="https://${esc(
         shop
      )}/account/login" style="color:#008060;text-decoration:none;">Log in here</a></p>
    </form>${geoExtras}
  </div>
</div>
<style>
  .b2b-reg-input:focus{border-color:#008060!important;outline:none;box-shadow:0 0 0 2px rgba(0,128,96,0.1);}
</style>`;
}
