import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
   REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT,
   REGISTRATION_COUNTRY_OPTIONS,
   REGISTRATION_STATE_PROVINCE_SUGGESTIONS,
   getProvincesForRegistrationCountry,
   registrationStateDropdownCaption
} from "../utils/registration-address-options";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop") || "";

  // Optionally verify signature
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session) shop = session.shop;
  } catch (e) {
    console.log("App proxy auth info:", e);
  }

  if (!shop) {
    return new Response("Missing shop parameter.", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  const formId = url.searchParams.get("id");
  let form;
  
  if (formId) {
    form = await db.registrationForm.findUnique({
      where: { id: formId }
    });
  } else {
    form = await db.registrationForm.findFirst({
      where: { shopId: shop }
    });
  }

  if (!form) {
    return new Response(
      `<html><body><h2>Form Not Found</h2><p>Wait, I didn't find the requested form in the database for shop: <b>${shop}</b>.</p></body></html>`, 
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  return { 
    view: "registration",
    id: form.id,
    formName: form.name, 
    fields: JSON.parse(form.fields),
    shop 
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const clonedRequest = request.clone();
  const formDataCopy = await clonedRequest.formData();
  let shop = (formDataCopy.get("shop") as string) || (formDataCopy.get("shop_domain") as string);

  if (!shop) {
    const url = new URL(request.url);
    shop = url.searchParams.get("shop") || "";
  }

  try {
    await authenticate.public.appProxy(request);
  } catch (e) {
    console.log("App proxy auth info:", e);
  }

  const formData = await request.formData();
  const formIdStr = formData.get("formId") as string;
  const emailField = formData.get("email") as string;

  const data: Record<string, any> = {};
  formData.forEach((value, key) => {
    if (key === "shop" || key === "formId") return;
    if (key.endsWith("[]")) {
      const base = key.slice(0, -2);
      if (!Array.isArray(data[base])) data[base] = [];
      data[base].push(value);
    } else {
      data[key] = value;
    }
  });

  try {
     await db.formSubmission.create({
       data: {
         shopId: shop,
         formId: formIdStr || "unknown",
         customerEmail: emailField || "no-email",
         formData: JSON.stringify(data),
         status: "pending"
       }
     });

     try {
       const store = await db.shop.findUnique({ where: { id: shop } });
       const adminEmail = store?.email || ("admin@" + shop);
       
       // Identify simple first/last name values implicitly
       const customerFirstName = data.first_name || data.firstName || data.fst || data.fname || "";
       const customerLastName = data.last_name || data.lastName || data.lst || data.lname || "";

       const emailData = {
          customerFirstName,
          customerLastName,
          customerEmail: emailField || "",
          shopName: store?.name || shop,
          customerStatus: "Pending"
       };

       import("../services/mailer.server").then(({ sendEmailTemplate }) => {
           if (adminEmail) {
               sendEmailTemplate({ shopId: shop, type: "ADMIN_NEW_APP", to: adminEmail, data: emailData });
           }
           if (emailField) {
               sendEmailTemplate({ shopId: shop, type: "CUSTOMER_PENDING", to: emailField, data: emailData });
           }
       }).catch(console.error);
     } catch (e) {
       console.error("Failed to enqueue notification emails", e);
     }

     return { success: true, message: "Thank you! Your registration has been submitted for approval." };
  } catch (error: any) {
     return { success: false, error: error.message };
  }
};

function registrationFieldName(field: any): string {
  if (field?.name && String(field.name).trim()) return String(field.name).trim();
  if (field?.id === "eml") return "email";
  return String(field.label || "field")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "") || "field";
}

function initialRegistrationCountry(fieldsList: any[]): string {
   if (!Array.isArray(fieldsList)) return "";
   const c = fieldsList.find((f: any) => f.presetKey === "country");
   const v = c?.defaultValue != null ? String(c.defaultValue).trim() : "";
   if (v && REGISTRATION_COUNTRY_OPTIONS.some((o) => o.value === v)) return v;
   return "";
}

// --- shared field styles (used by RegistrationFieldRow) ---
const containerStyle: CSSProperties = { maxWidth: "600px", margin: "60px auto", padding: "0 20px" };
const cardStyle: CSSProperties = { background: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)", border: "1px solid #e1e1e1" };
const labelStyle: CSSProperties = { display: "block", fontSize: "0.9em", fontWeight: "600", color: "#202223", marginBottom: "8px" };
const inputStyle: CSSProperties = {
   width: "100%",
   padding: "12px 16px",
   borderRadius: "8px",
   border: "1px solid #d1d1d1",
   fontSize: "1em",
   boxSizing: "border-box",
   transition: "all 0.2s"
};
const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer", backgroundColor: "#fff" };
const sectionTitleStyle: CSSProperties = {
   fontSize: "1.05rem",
   fontWeight: 700,
   color: "#202223",
   margin: "8px 0 4px",
   paddingBottom: "8px",
   borderBottom: "1px solid #ececec"
};
const submitButtonStyle: CSSProperties = {
   width: "100%",
   background: "#008060",
   color: "white",
   border: "none",
   padding: "14px 20px",
   borderRadius: "8px",
   fontSize: "1.1em",
   fontWeight: "bold",
   transition: "background 0.2s"
};

function RegistrationFieldRow({
   field,
   registrationCountry,
   setRegistrationCountry
}: {
   field: any;
   registrationCountry: string;
   setRegistrationCountry: (v: string) => void;
}) {
   const fname = registrationFieldName(field);
   const hint = field.hint ? String(field.hint) : "";
   const opts = Array.isArray(field.options) ? field.options : [];
   const preset = field.presetKey as string | undefined;
   const stateListId = `rg-state-${String(field.id || fname).replace(/[^a-z0-9_-]/gi, "")}`;
   const defaultStr = field.defaultValue != null ? String(field.defaultValue) : "";
   const provincesForCountry = getProvincesForRegistrationCountry(registrationCountry);

   const control =
      field.type === "textarea" ? (
         <textarea
            name={fname}
            required={field.required}
            defaultValue={defaultStr}
            autoComplete={preset === "address" ? "street-address" : undefined}
            className="input-focus"
            style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }}
         />
      ) : preset === "country" ? (
         <select
            name={fname}
            required={field.required}
            className="input-focus"
            style={selectStyle}
            autoComplete="country-name"
            value={registrationCountry}
            onChange={(e) => setRegistrationCountry(e.target.value)}
         >
            <option value="">{field.required ? "Select country…" : "Select country (optional)…"}</option>
            {REGISTRATION_COUNTRY_OPTIONS.map((o) => (
               <option key={o.value} value={o.value}>
                  {o.label}
               </option>
            ))}
         </select>
      ) : preset === "state" ? (
         provincesForCountry.length > 0 ? (
            <>
               <select
                  key={registrationCountry}
                  name={fname}
                  required={field.required}
                  className="input-focus"
                  style={selectStyle}
                  autoComplete="address-level1"
                  defaultValue={
                     defaultStr && provincesForCountry.includes(defaultStr) ? defaultStr : ""
                  }
               >
                  <option value="">
                     {field.required ? "Select state / province…" : "Select state / province (optional)…"}
                  </option>
                  {provincesForCountry.map((p) => (
                     <option key={p} value={p}>
                        {p}
                     </option>
                  ))}
               </select>
               <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#8c9196" }}>
                  {registrationStateDropdownCaption(registrationCountry)}
               </p>
            </>
         ) : (
            <>
               <input
                  type="text"
                  name={fname}
                  required={field.required}
                  defaultValue={defaultStr}
                  list={stateListId}
                  autoComplete="address-level1"
                  className="input-focus"
                  style={inputStyle}
                  placeholder="State or province"
               />
               <datalist id={stateListId}>
                  {REGISTRATION_STATE_PROVINCE_SUGGESTIONS.map((name) => (
                     <option key={name} value={name} />
                  ))}
               </datalist>
               <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#8c9196" }}>
                  Select a country in the Country field first. For {REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT}{" "}
                  countries (including the United States, Canada, Australia, Japan, and others) a matching region
                  dropdown appears here. For all other countries, type your state or province — suggestions combine
                  regions from every country we list in the dropdown.
               </p>
            </>
         )
      ) : field.type === "dropdown" ? (
         <select
            name={fname}
            required={field.required}
            defaultValue={defaultStr}
            className="input-focus"
            style={selectStyle}
         >
            <option value="">Select an option…</option>
            {opts.map((o: any) => (
               <option key={o.value || o.label} value={o.value || ""}>
                  {o.label || o.value}
               </option>
            ))}
         </select>
      ) : field.type === "choice_list" ? (
         <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {opts.map((o: any, i: number) => (
               <label key={o.value || o.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95em" }}>
                  <input
                     type="radio"
                     name={fname}
                     value={o.value || ""}
                     required={!!field.required && opts.length > 0 && i === 0}
                  />
                  <span>{o.label || o.value}</span>
               </label>
            ))}
         </div>
      ) : field.type === "multi_choice" ? (
         <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {opts.map((o: any) => (
               <label key={o.value || o.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95em" }}>
                  <input type="checkbox" name={`${fname}[]`} value={o.value || ""} />
                  <span>{o.label || o.value}</span>
               </label>
            ))}
         </div>
      ) : (
         <input
            type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
            name={fname}
            required={field.required}
            defaultValue={defaultStr}
            className="input-focus"
            style={inputStyle}
            autoComplete={
               preset === "company"
                  ? "organization"
                  : preset === "city"
                    ? "address-level2"
                    : preset === "postal"
                      ? "postal-code"
                      : preset === "phone"
                        ? "tel"
                        : undefined
            }
            inputMode={preset === "postal" ? "text" : preset === "phone" ? "tel" : undefined}
            placeholder={
               preset === "city"
                  ? "City"
                  : preset === "postal"
                    ? "ZIP or postal code"
                    : preset === "company"
                      ? "Legal or trading name"
                      : undefined
            }
         />
      );

   return (
      <div>
         <label style={labelStyle}>
            {field.label} {field.required && <span style={{ color: "#d72c0d" }}>*</span>}
         </label>
         {hint ? <p style={{ margin: "4px 0 8px", fontSize: "0.85em", color: "#6d7175" }}>{hint}</p> : null}
         {control}
      </div>
   );
}

export default function RegistrationFormPage() {
  const { formName, fields, shop, id } = useLoaderData<any>();
  const actionData = useActionData<any>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const successMessage = actionData?.success ? actionData.message : null;
  const error = actionData?.error;

  const sections = useMemo(() => {
     const hasSection = Array.isArray(fields) && fields.some((f: any) => f.section);
     if (!hasSection) {
        return { mode: "flat" as const, flat: Array.isArray(fields) ? fields : [] };
     }
     return {
        mode: "sections" as const,
        primary: fields.filter((f: any) => f.section === "primary"),
        business: fields.filter((f: any) => f.section === "business"),
        custom: fields.filter((f: any) => f.section === "custom")
     };
  }, [fields]);

  const [registrationCountry, setRegistrationCountry] = useState(() => initialRegistrationCountry(fields));

  const rowProps = { registrationCountry, setRegistrationCountry };

  if (actionData?.success) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", padding: "40px" }}>
            <div style={{ fontSize: "4em", marginBottom: "20px" }}>✅</div>
            <h1 style={{ fontSize: "1.8em", color: "#202223", marginBottom: "15px" }}>Application Received</h1>
            <p style={{ color: "#6d7175", fontSize: "1.1em", lineHeight: "1.6" }}>
              {successMessage}
            </p>
            <a 
              href={`https://${shop}`}
              style={{ ...submitButtonStyle, display: "inline-block", textDecoration: "none", boxSizing: "border-box" }}
            >
              Back to Store
            </a>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div style={containerStyle}>
      <style>{`
        body { margin: 0; background: #f6f6f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .input-focus:focus { border-color: #008060 !important; outline: none; box-shadow: 0 0 0 2px rgba(0, 128, 96, 0.1); }
      `}</style>
      
      <div style={cardStyle}>
        <div style={{ borderBottom: "1px solid #e1e1e1", paddingBottom: "20px", marginBottom: "30px" }}>
          <h1 style={{ margin: 0, fontSize: "1.6em", color: "#202223" }}>{formName}</h1>
          <p style={{ color: "#6d7175", margin: "10px 0 0", fontSize: "0.95em" }}>
            Please complete all sections. Fields marked * are required.
          </p>
        </div>

        {error && (
          <div style={{ background: "#fff4f4", border: "1px solid #ffcece", color: "#c10000", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "0.9em" }}>
            ⚠️ {error}
          </div>
        )}

        <Form method="post" action="/apps/b2b-proxy/registration">
          <input type="hidden" name="shop" value={shop} />
          <input type="hidden" name="formId" value={id} />
          
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {sections.mode === "flat" ? (
               sections.flat.map((field: any) => (
                  <RegistrationFieldRow key={field.id} field={field} {...rowProps} />
               ))
            ) : (
               <>
                  {sections.primary.length > 0 ? (
                     <>
                        <h2 style={sectionTitleStyle}>Primary contact</h2>
                        {sections.primary.map((field: any) => (
                           <RegistrationFieldRow key={field.id} field={field} {...rowProps} />
                        ))}
                     </>
                  ) : null}
                  {sections.business.length > 0 ? (
                     <>
                        <h2
                           style={{
                              ...sectionTitleStyle,
                              marginTop: sections.primary.length > 0 ? 28 : 8
                           }}
                        >
                           Business details
                        </h2>
                        {sections.business.map((field: any) => (
                           <RegistrationFieldRow key={field.id} field={field} {...rowProps} />
                        ))}
                     </>
                  ) : null}
                  {sections.custom.length > 0 ? (
                     <>
                        <h2
                           style={{
                              ...sectionTitleStyle,
                              marginTop: sections.primary.length + sections.business.length > 0 ? 28 : 8
                           }}
                        >
                           More details
                        </h2>
                        {sections.custom.map((field: any) => (
                           <RegistrationFieldRow key={field.id} field={field} {...rowProps} />
                        ))}
                     </>
                  ) : null}
               </>
            )}

            <div style={{ marginTop: "10px" }}>
              <button 
                type="submit" 
                disabled={isSubmitting}
                style={{ 
                  ...submitButtonStyle, 
                  opacity: isSubmitting ? 0.7 : 1,
                  cursor: isSubmitting ? "not-allowed" : "pointer"
                }}
              >
                {isSubmitting ? "Submitting Application..." : "Submit Registration"}
              </button>
            </div>
            
            <p style={{ textAlign: "center", fontSize: "0.85em", color: "#8c9196" }}>
              Already have an account? <a href={`https://${shop}/account/login`} style={{ color: "#008060", textDecoration: "none" }}>Log in here</a>
            </p>
          </div>
        </Form>
      </div>
    </div>
  );
}
