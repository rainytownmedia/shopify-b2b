import { useState, useEffect, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import React from "react";
import { Text } from "@shopify/polaris";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { TagCombobox } from "../components/TagCombobox";
import { getComboboxTagOptions, syncCustomerTagInventory } from "../utils/customer-tags.server";

/** Client-only draft when `formId=new` — no DB row until the user saves in the designer. */
const NEW_REGISTRATION_FORM_DRAFT = {
   id: "new",
   name: "New Wholesale Form",
   autoApprove: false,
   fields: JSON.stringify([])
};

/** Preset fields for the “Business Details” picker (create form). */
const BUSINESS_FIELD_PALETTE: Array<{
   presetKey: string;
   label: string;
   defaultId: string;
   type: string;
   required: boolean;
}> = [
   { presetKey: "company", label: "Company", defaultId: "company", type: "text", required: false },
   { presetKey: "address", label: "Address", defaultId: "address", type: "textarea", required: false },
   { presetKey: "country", label: "Country", defaultId: "country", type: "text", required: false },
   { presetKey: "state", label: "State / Province", defaultId: "state", type: "text", required: false },
   { presetKey: "city", label: "City", defaultId: "city", type: "text", required: false },
   { presetKey: "postal", label: "Postal Code", defaultId: "postal", type: "text", required: false },
   { presetKey: "phone", label: "Phone", defaultId: "phone", type: "tel", required: false }
];

/** Legacy field ids that count as a palette preset (avoid duplicate Email, etc.). */
const LEGACY_FIELD_IDS_FOR_PRESET: Record<string, string[]> = {
   email: ["eml"]
};

const PRIMARY_CONTACT_DEFS = [
   { id: "fname", name: "first_name", label: "First name", type: "text", required: true, placeholder: "First name", hint: "" },
   { id: "lname", name: "last_name", label: "Last name", type: "text", required: true, placeholder: "Last name", hint: "" },
   { id: "eml", name: "email", label: "Email", type: "email", required: true, placeholder: "Email address", hint: "" }
];

const FIELD_REORDER_DRAG_MIME = "application/x-rainy-field-reorder";
/** Sentinel: insert dragged field at end of its section (bottom half of last row). */
const FIELD_REORDER_INSERT_END = "__field_reorder_insert_end__";

/** Insert-before would keep the same order (e.g. dragged field already sits directly above the target). */
function isFieldReorderInsertNoOp(list: { id: string }[], draggedId: string, insertBeforeId: string): boolean {
   const d = list.findIndex((x) => x.id === draggedId);
   if (d < 0) return true;
   if (insertBeforeId === FIELD_REORDER_INSERT_END) {
      return d === list.length - 1;
   }
   const b = list.findIndex((x) => x.id === insertBeforeId);
   if (b < 0) return true;
   return d + 1 === b;
}

const CUSTOM_FIELD_PALETTE_ENTRIES = [
   { type: "text", defaultLabel: "Text Field" },
   { type: "textarea", defaultLabel: "Multiline Text Field" },
   { type: "dropdown", defaultLabel: "Select Field" },
   { type: "choice_list", defaultLabel: "Choice List" },
   { type: "multi_choice", defaultLabel: "Multi Choice List" }
];

type FieldDesignerSection = "primary" | "business" | "custom";

/** Grip used to drag-reorder form fields in the designer (shows stronger on hover). */
function FieldReorderDragHandle({
   section,
   fieldId,
   onReorderDragStart,
   onReorderDragEnd
}: {
   section: FieldDesignerSection;
   fieldId: string;
   onReorderDragStart: (section: FieldDesignerSection, fieldId: string) => void;
   onReorderDragEnd: () => void;
}) {
   const hint =
      "Drag to reorder: press and hold the handle, then drop on the row you want this field to appear before.";
   return (
      <div
         draggable
         onDragStart={(e) => {
            onReorderDragStart(section, fieldId);
            const payload = JSON.stringify({ section, fieldId });
            e.dataTransfer.setData(FIELD_REORDER_DRAG_MIME, payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "move";
         }}
         onDragEnd={onReorderDragEnd}
         title={hint}
         aria-label={hint}
         role="button"
         tabIndex={0}
         onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.preventDefault();
         }}
         style={{
            flexShrink: 0,
            width: 34,
            minHeight: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
            border: "1px solid transparent",
            color: "#9ca3af",
            cursor: "grab",
            userSelect: "none",
            transition: "color 0.15s, border-color 0.15s, background 0.15s"
         }}
         onMouseEnter={(e) => {
            e.currentTarget.style.color = "#374151";
            e.currentTarget.style.borderColor = "#e5e7eb";
            e.currentTarget.style.background = "#f9fafb";
         }}
         onMouseLeave={(e) => {
            e.currentTarget.style.color = "#9ca3af";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.background = "transparent";
         }}
      >
         <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="7" cy="5" r="1.65" />
            <circle cx="13" cy="5" r="1.65" />
            <circle cx="7" cy="10" r="1.65" />
            <circle cx="13" cy="10" r="1.65" />
            <circle cx="7" cy="15" r="1.65" />
            <circle cx="13" cy="15" r="1.65" />
         </svg>
      </div>
   );
}

/** Easing for insert gap open/close — slightly slow so rows feel like they ease aside. */
const FIELD_REORDER_SLOT_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const FIELD_REORDER_SLOT_DURATION = "0.45s";

/** Drop preview: gap where the field will land when released (must accept drops — rows alone do not receive drops on the slot). */
function FieldReorderInsertSlot({
   visible,
   variant,
   dragTargetHandlers
}: {
   visible: boolean;
   variant: "between" | "end";
   dragTargetHandlers?: { onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
}) {
   const label =
      variant === "end" ? "Release to move to end of list" : "Release to insert field here";
   const transition = `max-height ${FIELD_REORDER_SLOT_DURATION} ${FIELD_REORDER_SLOT_EASE}, opacity ${FIELD_REORDER_SLOT_DURATION} ease, margin-top ${FIELD_REORDER_SLOT_DURATION} ${FIELD_REORDER_SLOT_EASE}, margin-bottom ${FIELD_REORDER_SLOT_DURATION} ${FIELD_REORDER_SLOT_EASE}`;
   return (
      <div
         aria-hidden={!visible}
         style={{
            maxHeight: visible ? 72 : 0,
            opacity: visible ? 1 : 0,
            marginTop: visible ? 6 : 0,
            marginBottom: visible ? 6 : 0,
            overflow: "hidden",
            transition,
            pointerEvents: visible ? "auto" : "none"
         }}
      >
         <div
            {...(visible ? dragTargetHandlers : {})}
            style={{
               minHeight: 36,
               borderRadius: "10px",
               border: "2px dashed #008060",
               background: "rgba(0, 128, 96, 0.07)",
               display: "flex",
               alignItems: "center",
               justifyContent: "center",
               fontSize: "0.75rem",
               fontWeight: 600,
               color: "#008060"
            }}
         >
            {label}
         </div>
      </div>
   );
}

function slugFieldName(label: string) {
   const s = String(label || "field")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
   return s || "field";
}

function defaultOptionsForFieldType(type: string) {
   if (type === "dropdown" || type === "choice_list" || type === "multi_choice") {
      return [
         { label: "Choice 1", value: "choice_1" },
         { label: "Choice 2", value: "choice_2" }
      ];
   }
   return [];
}

function sortFieldsBySection(list: any[]) {
   const prim = list.filter((f) => f.section === "primary");
   const bus = list.filter((f) => f.section === "business");
   const cust = list.filter((f) => f.section === "custom");
   return [...prim, ...bus, ...cust];
}

function normalizeFieldsOnLoad(raw: any[]): any[] {
   if (!Array.isArray(raw) || raw.length === 0) {
      return PRIMARY_CONTACT_DEFS.map((d) => ({ ...d, section: "primary" }));
   }

   const consumed = new Set<string>();
   const primOut: any[] = [];

   for (const def of PRIMARY_CONTACT_DEFS) {
      const found =
         raw.find((f) => f.id === def.id) ||
         (def.id === "eml" ? raw.find((f) => f.id === "email") : undefined) ||
         raw.find((f) => String(f.name || "").toLowerCase() === def.name.toLowerCase());
      if (found) consumed.add(found.id);
      primOut.push({
         ...def,
         ...(found || {}),
         id: def.id,
         section: "primary",
         name: def.name,
         label: found?.label ?? def.label,
         type: def.type,
         required: found?.required ?? def.required,
         hint: found?.hint ?? "",
         placeholder: found?.placeholder ?? def.placeholder,
         defaultValue: found?.defaultValue ?? ""
      });
   }

   const rest = raw.filter((f) => !consumed.has(f.id));
   const mapped = rest.map((f) => {
      if (f.section === "primary") {
         return { ...f, section: "business" };
      }
      if (f.presetKey || BUSINESS_FIELD_PALETTE.some((p) => p.presetKey === f.presetKey)) {
         return { ...f, section: "business", hint: f.hint ?? "" };
      }
      const name = f.name || slugFieldName(f.label);
      const opts = Array.isArray(f.options) ? f.options : defaultOptionsForFieldType(f.type);
      return {
         ...f,
         section: "custom",
         name,
         hint: f.hint ?? "",
         defaultValue: f.defaultValue ?? "",
         options: opts
      };
   });

   return sortFieldsBySection([...primOut, ...mapped]);
}

function fieldHasPresetInList(businessList: any[], presetKey: string) {
   const preset = BUSINESS_FIELD_PALETTE.find((p) => p.presetKey === presetKey);
   if (!preset) return false;
   const legacyIds = LEGACY_FIELD_IDS_FOR_PRESET[presetKey] || [];
   return businessList.some(
      (f: any) =>
         f.presetKey === presetKey ||
         f.id === preset.defaultId ||
         (typeof f.id === "string" && f.id.startsWith(`${preset.defaultId}_`)) ||
         legacyIds.includes(f.id)
   );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
   const { admin, session } = await authenticate.admin(request);
   // Search from URL
   const url = new URL(request.url);
   const searchTerm = url.searchParams.get("query") || "";

   const [
      customerJson,
      pLists,
      regForms,
      submissionCounts,
      formSubmissions,
      uniqueTags
   ] = await Promise.all([
      (async () => {
         const r = await admin.graphql(
            `#graphql
     query getCustomers($query: String) {
       customers(first: 50, query: $query) {
         edges {
           node {
             id
             firstName
             lastName
             email
             tags
             createdAt
           }
         }
       }
     }`,
            { variables: { query: searchTerm } }
         );
         return r.json();
      })(),
      db.priceList.findMany({
         where: { shopId: session.shop, category: "REGISTRATION" },
         orderBy: { updatedAt: "desc" }
      }),
      db.registrationForm.findMany({
         where: { shopId: session.shop },
         orderBy: { createdAt: "desc" }
      }),
      db.formSubmission.groupBy({
         by: ["formId"],
         where: { shopId: session.shop },
         _count: { _all: true }
      }),
      db.formSubmission.findMany({
         where: { shopId: session.shop },
         orderBy: { createdAt: "desc" }
      }),
      getComboboxTagOptions(session.shop)
   ]);

   const customers = (customerJson as any).data?.customers?.edges || [];

   const formsWithCounts = regForms.map((form) => ({
      ...form,
      customerCount: submissionCounts.find((c) => c.formId === form.id)?._count?._all || 0
   }));

   // 4. Handle Default Form Creation (Early Return)
   if (regForms.length === 0) {
      const defaultForm = await db.registrationForm.create({
         data: {
            shopId: session.shop,
            name: "Default Wholesale Signup",
            fields: JSON.stringify([
               { id: "fname", label: "First Name", type: "text", required: true },
               { id: "lname", label: "Last Name", type: "text", required: true },
               { id: "eml", label: "Email Address", type: "email", required: true },
               { id: "comp", label: "Company Name", type: "text", required: true }
            ]),
            status: "active"
         }
      });
      return {
         customers,
         priceLists: pLists,
         registrationForms: [{ ...defaultForm, customerCount: 0 }],
         formSubmissions,
         uniqueTags,
         searchTerm,
         shopId: session.shop
      };
   }

   // 5. Final Return
   return { customers, priceLists: pLists, registrationForms: formsWithCounts, formSubmissions, uniqueTags, searchTerm, shopId: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
   const { session, admin } = await authenticate.admin(request);
   const formData = await request.formData();
   const actionType = formData.get("actionType");

   if (actionType === "createRegistrationGroup") {
      const name = formData.get("name") as string;
      const tag = formData.get("tag") as string;
      await db.priceList.create({
         data: {
            shopId: session.shop,
            name,
            customerTag: tag,
            category: "REGISTRATION"
         }
      });
   } else if (actionType === "deleteRegistrationGroup") {
      const id = formData.get("id") as string;
      await db.priceList.delete({ where: { id } });
   } else if (actionType === "saveRegistrationForm") {
      const name = formData.get("name") as string;
      const autoApprove = formData.get("autoApprove") === "true";
      const fields = formData.get("fields") as string;
      const formId = formData.get("formId") as string;

      await db.registrationForm.update({
         where: { id: formId },
         data: {
            name,
            autoApprove,
            fields
         }
      });
      return { success: true, message: "Registration form saved successfully" };
   } else if (actionType === "createRegistrationForm") {
      const name = ((formData.get("name") as string) || "").trim() || "New Wholesale Form";
      const autoApprove = formData.get("autoApprove") === "true";
      const fieldsJson =
         (formData.get("fields") as string) ||
         JSON.stringify([
            { id: "fname", label: "First Name", type: "text", required: true },
            { id: "eml", label: "Email Address", type: "email", required: true }
         ]);
      const created = await db.registrationForm.create({
         data: {
            shopId: session.shop,
            name,
            autoApprove,
            fields: fieldsJson,
            status: "active"
         }
      });
      return { success: true, message: "Registration form created", formId: created.id };
   } else if (actionType === "deleteRegistrationForm") {
      const id = formData.get("id") as string;
      await db.registrationForm.delete({ where: { id } });
      return { success: true, message: "Form deleted" };
   } else if (actionType === "saveSubmissionAssignments") {
      const rowsRaw = (formData.get("rows") as string) || "[]";
      const rows: Array<{ id: string; status: string; customerTags: string }> = JSON.parse(rowsRaw);

      let updatedCount = 0;
      for (const row of rows) {
         const submission = await db.formSubmission.findUnique({ where: { id: row.id } });
         if (!submission || submission.shopId !== session.shop) continue;

         const prevStatus = submission.status;
         const nextStatusFromRow = row.status === "approved" ? "approved" : "pending";
         const nextStatus = prevStatus === "approved" ? "approved" : nextStatusFromRow;
         const tagSource = (row.customerTags || "").trim();
         const prevTags = ((submission as any).customerTags || "").trim();
         const tagsChanged = tagSource !== prevTags;
         const statusChanged = prevStatus !== nextStatus;

         if (prevStatus === "pending" && nextStatus === "approved") {
            // When approving, merge new tags with existing Shopify tags if customer already exists
            const checkRes = await admin.graphql(
               `#graphql
               query FindCustomerByEmail($query: String!) {
                  customers(first: 1, query: $query) {
                     edges {
                        node { id tags }
                     }
                  }
               }`,
               { variables: { query: `email:${submission.customerEmail}` } }
            );
            const checkJson: any = await checkRes.json();
            const existingForMerge = checkJson.data?.customers?.edges?.[0]?.node;
            let tagsToUse = tagSource;
            
            if (existingForMerge?.id) {
               const currentTags = normalizeTags(existingForMerge.tags || []);
               const newTags = normalizeTags((tagSource || "").split(","));
               const mergedTags = normalizeTags([...currentTags, ...newTags]);
               tagsToUse = mergedTags.join(", ");
            }
            
            const approveResult = await approveSubmissionAndCreateCustomer({
               admin,
               submission,
               fallbackTags: tagsToUse
            });
            if (!approveResult.success) {
               return { success: false, message: approveResult.message || "Failed to approve customer" };
            }
            updatedCount += 1;
            await db.formSubmission.update({
               where: { id: submission.id },
               data: { status: nextStatus, customerTags: tagSource } as any
            });
            try {
               const payload = parseSubmissionPayload(submission.formData);
               const store = await db.shop.findUnique({ where: { id: session.shop } });
               const emailData = {
                  customerFirstName: getPayloadValue(payload, ["first_name", "firstName", "fst", "fname"]) || "",
                  customerLastName: getPayloadValue(payload, ["last_name", "lastName", "lst", "lname"]) || "",
                  customerEmail: submission.customerEmail || "",
                  shopName: store?.name || session.shop,
                  customerStatus: "Approved"
               };

               const { sendEmailTemplate } = await import("../services/mailer.server");
               if (submission.customerEmail) {
                  void sendEmailTemplate({
                     shopId: session.shop,
                     type: "CUSTOMER_APPROVED",
                     to: submission.customerEmail,
                     data: emailData
                  });
               }
            } catch (emailError) {
               console.error("Failed to send CUSTOMER_APPROVED email", emailError);
            }
            continue;
         }

         // Already approved: sync tags to Shopify if changed
         if (prevStatus === "approved" && nextStatus === "approved") {
            const existingRes = await admin.graphql(
               `#graphql
               query FindCustomerByEmail($query: String!) {
                  customers(first: 1, query: $query) {
                     edges {
                        node { id tags }
                     }
                  }
               }`,
               { variables: { query: `email:${submission.customerEmail}` } }
            );
            const existingJson: any = await existingRes.json();
            const existingCustomer = existingJson.data?.customers?.edges?.[0]?.node;
            if (existingCustomer?.id && tagsChanged) {
               const desiredTags = normalizeTags((tagSource || "").split(","));
               const currentTags = normalizeTags(existingCustomer.tags || []);
               // Merge: keep current tags and add new ones from app (not replace)
               const mergedTags = normalizeTags([...currentTags, ...desiredTags]);
               const hasTagChanges = mergedTags.join("|") !== currentTags.join("|");
               if (hasTagChanges) {
                  const updateResult = await updateCustomerTags(admin, existingCustomer.id, mergedTags);
                  if (!updateResult.success) {
                     return { success: false, message: updateResult.message || "Failed to update customer tags" };
                  }
                  updatedCount += 1;
               }
            }
            // Always save tag change to DB
            if (tagsChanged) {
               await db.formSubmission.update({
                  where: { id: submission.id },
                  data: { customerTags: tagSource } as any
               });
               updatedCount += 1;
            }
         } else if (statusChanged) {
            // Status changed (pending → something else)
            await db.formSubmission.update({
               where: { id: submission.id },
               data: { status: nextStatus, customerTags: tagSource } as any
            });
            updatedCount += 1;
         } else if (tagsChanged) {
            // Only tags changed (pending rows)
            await db.formSubmission.update({
               where: { id: submission.id },
               data: { customerTags: tagSource } as any
            });
            updatedCount += 1;
         }
      }

      await syncCustomerTagInventory(session.shop);

      return { success: true, message: updatedCount > 0 ? "Assignments saved" : "No changes to save" };
   } else if (actionType === "deleteSubmission") {
      const submissionId = formData.get("submissionId") as string;
      const submission = await db.formSubmission.findUnique({ where: { id: submissionId } });
      if (!submission || submission.shopId !== session.shop) {
         return { success: false, message: "Submission not found" };
      }

      await db.formSubmission.delete({ where: { id: submissionId } });
      return { success: true, message: "Submission deleted" };
   }

   return { success: true };
};

export default function CustomerManagementPage() {
   const { customers, priceLists, registrationForms, formSubmissions, uniqueTags, searchTerm, shopId } = useLoaderData<typeof loader>();
   const [searchParams, setSearchParams] = useSearchParams();
   const fetcher = useFetcher();
   const navigate = useNavigate();
   const shopify = useAppBridge();

   const [search, setSearch] = useState(searchTerm);
   const [showGroupModal, setShowGroupModal] = useState(false);
   const [newGroupName, setNewGroupName] = useState("");
   const [newGroupTag, setNewGroupTag] = useState("");

   const mode = searchParams.get("mode"); // null (list), 'groups', 'onboarding'

   const handleSearch = () => {
      const next = new URLSearchParams(searchParams);
      next.set("query", search);
      setSearchParams(next);
   };

   const createGroup = () => {
      fetcher.submit({ actionType: "createRegistrationGroup", name: newGroupName, tag: newGroupTag }, { method: "POST" });
      setShowGroupModal(false);
      setNewGroupName("");
      setNewGroupTag("");
      shopify.toast.show("Registration group created");
   };

   /**
    * 1. MAIN LIST VIEW
    */
   if (!mode) {
      return (
         <>
            <Breadcrumbs items={[{ label: "B2B Customers" }]} />
            <s-page heading="B2B Customers & Onboarding" back-action-url="/app">
               {/* Quick Nav Cards */}
               <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "30px" }}>
                  <div style={smallCardStyle}>
                     <strong>📝 Registration Form</strong>
                     <p style={{ fontSize: "0.85em", color: "#666" }}>Customize the form for new B2B customer applications.</p>
                     <s-button variant="secondary" onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("mode", "onboarding");
                        setSearchParams(next);
                     }}>Manage Form</s-button>
                  </div>
                  <div style={smallCardStyle}>
                     <strong>📧 Email Setup</strong>
                     <p style={{ fontSize: "0.85em", color: "#666" }}>Configure automated emails for B2B status.</p>
                     <s-button variant="secondary" onClick={() => {
                        navigate("/app/email-setup");
                     }}>Setup Emails</s-button>
                  </div>
               </div>

               <div style={{ background: "white", padding: "20px", borderRadius: "12px", border: "1px solid #ddd", marginBottom: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                     type="text"
                     placeholder="Search by name, email, or tag..."
                     value={search}
                     onChange={e => setSearch(e.target.value)}
                     onKeyDown={e => e.key === "Enter" && handleSearch()}
                     style={{ ...inputStyle, flex: 1 }}
                  />
                  <s-button variant="primary" onClick={handleSearch}>Search</s-button>
               </div>
               
               <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                     <thead>
                        <tr style={{ textAlign: "left", background: "#fcfcfc", borderBottom: "1px solid #eee" }}>
                           <th style={thStyle}>Customer</th>
                           <th style={thStyle}>Email</th>
                           <th style={thStyle}>Tags</th>
                           <th style={thStyle}>Joined</th>
                           <th style={{ ...thStyle, textAlign: "right" }}>Edit</th>
                        </tr>
                     </thead>
                     <tbody>
                        {customers.length === 0 ? (
                           <tr><td colSpan={5} style={{ textAlign: "center", padding: "40px", color: "#888" }}>No customers found.</td></tr>
                        ) : customers.map(({ node: c }: any) => (
                           <tr key={c.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                              <td style={tdStyle}><strong>{c.firstName} {c.lastName}</strong></td>
                              <td style={tdStyle}>{c.email}</td>
                              <td style={tdStyle}>
                                 <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                    {c.tags.map((t: string) => <span key={t} style={tagStyle}>{t}</span>)}
                                 </div>
                              </td>
                              <td style={tdStyle}>{new Date(c.createdAt).toLocaleDateString()}</td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                 <a
                                    href={shopifyAdminCustomerEditUrl(shopId, c.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#2c6ecb", fontWeight: 600, textDecoration: "none" }}
                                 >
                                    Edit
                                 </a>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </s-page>
         </>
      );
   }

   /**
    * 2. GROUPS VIEW
    */
   if (mode === 'groups') {
      return (
         <>
            <Breadcrumbs items={[{ label: "B2B Customers", url: "/app/customer-management" }, { label: "Registration Groups" }]} />
            <s-page heading="Customer Registration Groups" back-action-url="/app/customer-management">
               <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between" }}>
                  <s-button variant="secondary" onClick={() => {
                     const next = new URLSearchParams(searchParams);
                     next.delete("mode");
                     setSearchParams(next);
                  }}>← Back to List</s-button>
                  <s-button variant="primary" onClick={() => setShowGroupModal(true)}>+ Create New Group</s-button>
               </div>

               <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                     <thead>
                        <tr style={{ textAlign: "left", background: "#fcfcfc", borderBottom: "1px solid #eee" }}>
                           <th style={thStyle}>Group Name</th>
                           <th style={thStyle}>Shopify Tag</th>
                           <th style={thStyle}>Registration Form URL</th>
                           <th style={thStyle}>Action</th>
                        </tr>
                     </thead>
                     <tbody>
                        {priceLists.map(pl => (
                           <tr key={pl.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                              <td style={tdStyle}><strong>{pl.name}</strong></td>
                              <td style={tdStyle}><span style={tagStyle}>{pl.customerTag}</span></td>
                              <td style={tdStyle}>
                                 <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <code style={{ fontSize: "0.85em", background: "#f4f4f4", padding: "4px 8px", borderRadius: "4px" }}>
                                       /apps/b2b-portal/register?tag={pl.customerTag}
                                    </code>
                                    <s-button variant="secondary" onClick={() => {
                                       navigator.clipboard.writeText(`${window.location.origin}/apps/b2b-portal/register?tag=${pl.customerTag}`);
                                       shopify.toast.show("URL copied");
                                    }}>Copy</s-button>
                                 </div>
                              </td>
                              <td style={tdStyle}>
                                 <button onClick={() => fetcher.submit({ actionType: "deleteRegistrationGroup", id: pl.id }, { method: "POST" })} style={{ color: "red", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>

               {showGroupModal && (
                  <div style={modalOverlayStyle}>
                     <div style={modalContentStyle}>
                        <h2 style={{ marginTop: 0 }}>Create Registration Group</h2>
                        <p style={{ color: "#666", fontSize: "0.9em", marginBottom: "20px" }}>Customers who register via this group's link will automatically be assigned the tag below.</p>
                        <div style={{ marginBottom: "15px" }}>
                           <label style={labelStyle}>Group Name</label>
                           <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} style={inputStyle} placeholder="e.g. VIP Wholesalers" />
                        </div>
                        <div style={{ marginBottom: "25px" }}>
                           <label style={labelStyle}>Assign Tag</label>
                           <input type="text" value={newGroupTag} onChange={e => setNewGroupTag(e.target.value)} style={inputStyle} placeholder="e.g. wholesale_vip" />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                           <s-button variant="secondary" onClick={() => setShowGroupModal(false)}>Cancel</s-button>
                           <s-button variant="primary" onClick={createGroup}>Create Group</s-button>
                        </div>
                     </div>
                  </div>
               )}
            </s-page>
         </>
      );
   }

   /**
    * 3. ONBOARDING (REGISTRATION FORM MANAGER)
    */
   if (mode === 'onboarding') {
      return <RegistrationFormManager registrationForms={registrationForms} formSubmissions={formSubmissions} priceLists={priceLists} uniqueTags={uniqueTags} searchParams={searchParams} setSearchParams={setSearchParams} shopId={shopId} />;
   }

    return <div>Invalid View</div>;
}

/**
 * MANAGER COMPONENT
 */
function RegistrationFormManager({ registrationForms, formSubmissions, priceLists, uniqueTags, searchParams, setSearchParams, shopId }: any) {
   const fetcher = useFetcher<any>();
   const shopify = useAppBridge();

   // Navigation from URL: 'list' (default), 'designer', 'submissions'
   const view = searchParams.get("view") || "list";
   const activeFormId = searchParams.get("formId");

   const activeForm =
      activeFormId === "new"
         ? NEW_REGISTRATION_FORM_DRAFT
         : registrationForms.find((f: any) => f.id === activeFormId);
   const submissionFilterFormId =
      !activeFormId || activeFormId === "all"
         ? null
         : registrationForms.some((f: any) => f.id === activeFormId)
            ? activeFormId
            : null;
   const activeFormSubmissions = submissionFilterFormId
      ? (formSubmissions || []).filter((s: any) => s.formId === submissionFilterFormId)
      : (formSubmissions || []);
   const selectedSubmissionForm = submissionFilterFormId
      ? registrationForms.find((f: any) => f.id === submissionFilterFormId)
      : null;

   const setSubmissionFormFilter = (nextId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("view", "submissions");
      next.set("formId", nextId === "all" ? "all" : nextId);
      setSearchParams(next);
   };

   const handleCreate = () => {
      const next = new URLSearchParams(searchParams);
      next.set("view", "designer");
      next.set("formId", "new");
      setSearchParams(next);
   };

   const handleDelete = (id: string) => {
      if (confirm("Are you sure you want to delete this form and all its submissions?")) {
         fetcher.submit({ actionType: "deleteRegistrationForm", id }, { method: "POST" });
      }
   };

   const setView = (newView: string, formId?: string) => {
      const next = new URLSearchParams(searchParams);
      if (newView === 'list') {
         next.delete("view");
         next.delete("formId");
      } else {
         next.set("view", newView);
         if (formId) next.set("formId", formId);
      }
      setSearchParams(next);
   };

   useEffect(() => {
      const d = fetcher.data;
      if (!d?.success || !d.message) return;
      shopify.toast.show(d.message);
   }, [fetcher.data, shopify]);

   /**
    * VIEW: LIST
    */
   if (view === 'list') {
      return (
         <>
            <Breadcrumbs items={[{ label: "B2B Customers", url: "/app/customer-management" }, { label: "Registration Forms" }]} />
            <s-page heading="Registration Forms" back-action-url="/app/customer-management">
               <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <s-button variant="secondary" onClick={() => {
                     const next = new URLSearchParams(searchParams);
                     next.delete("mode");
                     setSearchParams(next);
                  }}>← Dashboard</s-button>
                  <s-button variant="primary" onClick={handleCreate}>Create New Form</s-button>
               </div>

               <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                     <thead>
                        <tr style={{ textAlign: "left", background: "#fcfcfc", borderBottom: "1px solid #eee" }}>
                           <th style={thStyle}>Name</th>
                           <th style={thStyle}>Customer Count</th>
                           <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                        </tr>
                     </thead>
                     <tbody>
                        {registrationForms.map((form: any) => (
                           <tr key={form.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                              <td style={tdStyle}><strong>{form.name}</strong></td>
                              <td style={tdStyle}>{form.customerCount} Customers</td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                 <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "center" }}>
                                    <IconButton title="Edit Form" onClick={() => setView('designer', form.id)}>
                                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                    </IconButton>
                                    <IconButton title="View Submissions" onClick={() => setView('submissions', form.id)}>
                                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/></svg>
                                    </IconButton>
                                    <IconButton title="Copy Link" onClick={() => {
                                       navigator.clipboard.writeText(`https://${shopId}/apps/b2b-proxy/registration?id=${form.id}`);
                                       shopify.toast.show("Form URL copied!");
                                    }}>
                                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    </IconButton>
                                    <IconButton title="Open Form" onClick={() => window.open(`https://${shopId}/apps/b2b-proxy/registration?id=${form.id}`, "_blank")}>
                                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                    </IconButton>
                                    <button onClick={() => handleDelete(form.id)} style={{ color: "red", background: "none", border: "none", cursor: "pointer", fontSize: "0.9em", marginLeft: "10px" }}>Delete</button>
                                 </div>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </s-page>
         </>
      );
   }

   /**
    * VIEW: DESIGNER
    */
   if (view === "designer" && activeForm) {
      return (
         <FormDesigner
            key={activeForm.id}
            form={activeForm}
            onBack={() => setView("list")}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
         />
      );
   }

   /**
    * VIEW: SUBMISSIONS
    */
   if (view === "submissions") {
      const submissionFormFilterKey = submissionFilterFormId ?? "all";
      return (
         <FormSubmissions
            key={submissionFormFilterKey}
            forms={registrationForms}
            selectedFormId={submissionFormFilterKey}
            onSelectForm={setSubmissionFormFilter}
            form={selectedSubmissionForm}
            submissions={activeFormSubmissions}
            priceLists={priceLists}
            uniqueTags={uniqueTags}
            onBack={() => setView("list")}
         />
      );
   }

   return <div>Error: Form not found. <s-button onClick={() => setView('list')}>Back to List</s-button></div>;
}

/**
 * ICON BUTTON COMPONENT
 */
function IconButton({ children, onClick, title }: any) {
   return (
      <button 
         onClick={onClick} 
         title={title}
         style={{ 
            background: "#333", 
            color: "white", 
            border: "none", 
            borderRadius: "6px", 
            width: "32px", 
            height: "32px", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            cursor: "pointer",
            transition: "background 0.2s"
         }}
         onMouseOver={(e) => e.currentTarget.style.background = "#000"}
         onMouseOut={(e) => e.currentTarget.style.background = "#333"}
      >
         {children}
      </button>
   );
}

/**
 * DESIGNER VIEW
 */
function FormDesigner({ form, onBack, searchParams, setSearchParams }: any) {
   const fetcher = useFetcher<any>();
   const shopify = useAppBridge();
   const isNewForm = form.id === "new";

   const [formName, setFormName] = useState(form.name);
   const [autoApprove, setAutoApprove] = useState(form.autoApprove);
   const [fields, setFields] = useState(() => normalizeFieldsOnLoad(JSON.parse(form.fields || "[]")));
   const [fieldModal, setFieldModal] = useState<any | null>(null);
   const [fieldReorderDrag, setFieldReorderDrag] = useState<{ section: FieldDesignerSection; fieldId: string } | null>(null);
   const [fieldReorderInsert, setFieldReorderInsert] = useState<{
      section: FieldDesignerSection;
      beforeId: string;
   } | null>(null);
   const fieldReorderDragRef = React.useRef<{ section: FieldDesignerSection; fieldId: string } | null>(null);
   const fieldReorderInsertRef = React.useRef<{ section: FieldDesignerSection; beforeId: string } | null>(null);

   const primaryFields = useMemo(() => fields.filter((f) => f.section === "primary"), [fields]);
   const businessFields = useMemo(() => fields.filter((f) => f.section === "business"), [fields]);
   const customFields = useMemo(() => fields.filter((f) => f.section === "custom"), [fields]);

   const openFieldModal = (f: any) => {
      setFieldModal(JSON.parse(JSON.stringify(f)));
   };

   const saveFieldModal = () => {
      if (!fieldModal) return;
      setFields((prev) => prev.map((x) => (x.id === fieldModal.id ? { ...fieldModal } : x)));
      setFieldModal(null);
   };

   const addPresetField = (preset: (typeof BUSINESS_FIELD_PALETTE)[0]) => {
      if (fieldHasPresetInList(businessFields, preset.presetKey)) return;
      setFields((prev) => {
         const sorted = sortFieldsBySection(prev);
         const p = sorted.filter((f) => f.section === "primary");
         const b = sorted.filter((f) => f.section === "business");
         const c = sorted.filter((f) => f.section === "custom");
         const nf = {
            id: `${preset.defaultId}_${Date.now()}`,
            label: preset.label,
            type: preset.type,
            required: preset.required,
            presetKey: preset.presetKey,
            section: "business",
            hint: ""
         };
         return sortFieldsBySection([...p, ...b, nf, ...c]);
      });
   };

   const addCustomFieldFromPalette = (entry: (typeof CUSTOM_FIELD_PALETTE_ENTRIES)[0]) => {
      const id = `cf_${Date.now()}`;
      const name = `${slugFieldName(entry.defaultLabel)}_${id.slice(-4)}`;
      const nf = {
         id,
         section: "custom",
         label: entry.defaultLabel,
         type: entry.type,
         required: false,
         name,
         hint: "",
         defaultValue: "",
         options: defaultOptionsForFieldType(entry.type)
      };
      setFields((prev) => sortFieldsBySection([...prev, nf]));
   };

   const reorderFieldToInsertBefore = (section: FieldDesignerSection, draggedId: string, beforeId: string) => {
      if (draggedId === beforeId) return;
      setFields((prev) => {
         const sorted = sortFieldsBySection(prev);
         const prim = sorted.filter((f) => f.section === "primary");
         const bus = sorted.filter((f) => f.section === "business");
         const cust = sorted.filter((f) => f.section === "custom");
         const arr =
            section === "primary" ? [...prim] : section === "business" ? [...bus] : [...cust];
         const idsBefore = arr.map((x) => x.id).join(",");
         const fromIdx = arr.findIndex((f) => f.id === draggedId);
         if (fromIdx < 0) return prev;
         const work = [...arr];
         const [item] = work.splice(fromIdx, 1);
         let insertAt = work.length;
         if (beforeId !== FIELD_REORDER_INSERT_END) {
            const j = work.findIndex((f) => f.id === beforeId);
            if (j >= 0) insertAt = j;
         }
         work.splice(insertAt, 0, item);
         if (work.map((x) => x.id).join(",") === idsBefore) return prev;
         if (section === "primary") return [...work, ...bus, ...cust];
         if (section === "business") return [...prim, ...work, ...cust];
         return [...prim, ...bus, ...work];
      });
   };

   const endFieldReorderDrag = () => {
      fieldReorderDragRef.current = null;
      fieldReorderInsertRef.current = null;
      setFieldReorderDrag(null);
      setFieldReorderInsert(null);
   };

   const handleFieldReorderDragStart = (section: FieldDesignerSection, fieldId: string) => {
      fieldReorderDragRef.current = { section, fieldId };
      setFieldReorderDrag({ section, fieldId });
   };

   /** Drop on the green insert slot (insert immediately before `beforeFieldId`). */
   const makeInsertSlotHandlers = (section: FieldDesignerSection, beforeFieldId: string) => ({
      onDragOver: (e: React.DragEvent) => {
         e.preventDefault();
         e.stopPropagation();
         e.dataTransfer.dropEffect = "move";
         if (fieldReorderDragRef.current?.section !== section) return;
         const next = { section, beforeId: beforeFieldId };
         fieldReorderInsertRef.current = next;
         setFieldReorderInsert(next);
      },
      onDrop: (e: React.DragEvent) => {
         e.preventDefault();
         e.stopPropagation();
         let payload: { section: FieldDesignerSection; fieldId: string } | null = fieldReorderDragRef.current;
         if (!payload) {
            try {
               const raw =
                  e.dataTransfer.getData(FIELD_REORDER_DRAG_MIME) || e.dataTransfer.getData("text/plain");
               if (raw) payload = JSON.parse(raw);
            } catch {
               /* ignore */
            }
         }
         if (!payload || payload.section !== section) {
            endFieldReorderDrag();
            return;
         }
         if (beforeFieldId === payload.fieldId) {
            endFieldReorderDrag();
            return;
         }
         const listForDrop =
            section === "primary" ? primaryFields : section === "business" ? businessFields : customFields;
         if (isFieldReorderInsertNoOp(listForDrop, payload.fieldId, beforeFieldId)) {
            endFieldReorderDrag();
            return;
         }
         reorderFieldToInsertBefore(section, payload.fieldId, beforeFieldId);
         endFieldReorderDrag();
      }
   });

   const makeFieldRowDragHandlers = (section: FieldDesignerSection, fieldId: string, index: number) => {
      const listForSection = () =>
         section === "primary" ? primaryFields : section === "business" ? businessFields : customFields;
      return {
         onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (fieldReorderDragRef.current?.section !== section) return;
            const list = listForSection();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const insertBeforeThisRow = e.clientY < rect.top + rect.height / 2;
            const nextId = insertBeforeThisRow
               ? fieldId
               : (list[index + 1]?.id ?? FIELD_REORDER_INSERT_END);
            const dragId = fieldReorderDragRef.current.fieldId;
            if (isFieldReorderInsertNoOp(list, dragId, nextId)) {
               fieldReorderInsertRef.current = null;
               setFieldReorderInsert(null);
               return;
            }
            const next = { section, beforeId: nextId };
            fieldReorderInsertRef.current = next;
            setFieldReorderInsert(next);
         },
         onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            let payload: { section: FieldDesignerSection; fieldId: string } | null = fieldReorderDragRef.current;
            if (!payload) {
               try {
                  const raw =
                     e.dataTransfer.getData(FIELD_REORDER_DRAG_MIME) || e.dataTransfer.getData("text/plain");
                  if (raw) payload = JSON.parse(raw);
               } catch {
                  /* ignore */
               }
            }
            if (!payload || payload.section !== section) {
               endFieldReorderDrag();
               return;
            }
            const list = listForSection();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const fallbackBeforeId: string =
               e.clientY < rect.top + rect.height / 2
                  ? fieldId
                  : (list[index + 1]?.id ?? FIELD_REORDER_INSERT_END);
            const refIns = fieldReorderInsertRef.current;
            const beforeId: string =
               refIns?.section === section && refIns.beforeId ? refIns.beforeId : fallbackBeforeId;
            if (beforeId === payload.fieldId) {
               endFieldReorderDrag();
               return;
            }
            if (isFieldReorderInsertNoOp(list, payload.fieldId, beforeId)) {
               endFieldReorderDrag();
               return;
            }
            reorderFieldToInsertBefore(section, payload.fieldId, beforeId);
            endFieldReorderDrag();
         }
      };
   };

   const removeFieldById = (id: string) => {
      if (primaryFields.some((p) => p.id === id)) return;
      setFields((prev) => prev.filter((x) => x.id !== id));
   };

   const handleSave = () => {
      const payload = sortFieldsBySection(fields);
      if (isNewForm) {
         fetcher.submit(
            {
               actionType: "createRegistrationForm",
               name: formName,
               autoApprove: autoApprove.toString(),
               fields: JSON.stringify(payload)
            },
            { method: "POST" }
         );
      } else {
         fetcher.submit(
            {
               actionType: "saveRegistrationForm",
               formId: form.id,
               name: formName,
               autoApprove: autoApprove.toString(),
               fields: JSON.stringify(payload)
            },
            { method: "POST" }
         );
      }
   };

   useEffect(() => {
      const d = fetcher.data;
      if (!d?.success) return;
      if (d.message) shopify.toast.show(d.message);
      if (isNewForm && d.formId) {
         const next = new URLSearchParams(searchParams);
         next.set("view", "designer");
         next.set("formId", d.formId);
         setSearchParams(next);
      }
   }, [fetcher.data, form.id, isNewForm, searchParams, setSearchParams, shopify]);

   const paletteRowStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      width: "100%",
      padding: "12px 14px",
      marginBottom: "4px",
      border: "none",
      borderRadius: "10px",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left",
      fontSize: "0.95rem",
      color: "#4a4a4a"
   };

   const newFormCardStyle: React.CSSProperties = {
      background: "#fff",
      borderRadius: "14px",
      border: "1px solid #e3e3e3",
      padding: "24px 28px 28px",
      boxShadow: "0 1px 0 rgba(0,0,0,0.04)"
   };

   const designerCrumb = isNewForm ? "Create form" : "Edit form";
   const saveButtonLabel = isNewForm ? "Create form" : "Save changes";
   const autoApproveId = isNewForm ? "aa-form-new" : "aa-form-edit";

   const pencilBtnStyle: React.CSSProperties = {
      width: 40,
      height: 40,
      borderRadius: "8px",
      border: "1px solid #c9cccf",
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
   };

   const reorderHintStyle: React.CSSProperties = {
      fontSize: "0.82rem",
      color: "#6d7175",
      margin: "0 0 16px",
      lineHeight: 1.45,
      padding: "10px 12px",
      background: "#f6f6f7",
      borderRadius: "8px",
      border: "1px solid #ececec"
   };

   const choiceTypes = ["dropdown", "choice_list", "multi_choice"];
   const showOptionsInModal = fieldModal && choiceTypes.includes(fieldModal.type);

   return (
      <>
         <Breadcrumbs items={[{ label: "Registration Forms", onClick: onBack }, { label: designerCrumb }]} />
         <s-page heading={formName} back-action-url="/app/customer-management?mode=onboarding">
            <div style={{ marginBottom: "18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
               <s-button variant="secondary" onClick={onBack}>
                  ← Back to List
               </s-button>
               <s-button variant="primary" onClick={handleSave} loading={fetcher.state === "submitting"}>
                  {saveButtonLabel}
               </s-button>
            </div>

            <div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "10px", maxWidth: "520px" }}>
               <label style={labelStyle}>Form name</label>
               <input style={inputStyle} value={formName} onChange={(e) => setFormName(e.target.value)} />
               <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} id={autoApproveId} />
                  <label htmlFor={autoApproveId} style={{ fontSize: "0.9em", color: "#444" }}>
                     Auto-approve submissions
                  </label>
               </div>
            </div>

            {/* Primary Contact Details */}
            <div style={{ ...newFormCardStyle, marginBottom: "20px" }}>
               <h2 style={{ margin: "0 0 18px", fontSize: "1.15rem", fontWeight: 700, color: "#202223" }}>Primary Contact Details</h2>
               <div style={reorderHintStyle}>
                  <strong style={{ color: "#202223" }}>Reorder:</strong> drag from the handle. Hover the <strong>top half</strong> of a row to insert before that field, or the <strong>bottom half</strong> to insert after it. A green slot appears only when the order would change — including a slot at the <strong>end</strong> when you use the bottom half of the last row. Order is used on the public registration form.
               </div>
               <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {primaryFields.map((f: any, idx: number) => {
                     const rowDragging =
                        fieldReorderDrag?.fieldId === f.id && fieldReorderDrag?.section === "primary";
                     const showInsertGap =
                        fieldReorderDrag &&
                        fieldReorderInsert?.section === "primary" &&
                        fieldReorderInsert.beforeId === f.id &&
                        fieldReorderDrag.fieldId !== f.id &&
                        !isFieldReorderInsertNoOp(primaryFields, fieldReorderDrag.fieldId, f.id);
                     return (
                        <React.Fragment key={f.id}>
                           <FieldReorderInsertSlot
                              visible={!!showInsertGap}
                              variant="between"
                              dragTargetHandlers={makeInsertSlotHandlers("primary", f.id)}
                           />
                           <div
                              style={{
                                 display: "flex",
                                 flexDirection: "column",
                                 gap: "6px",
                                 opacity: rowDragging ? 0.52 : 1,
                                 borderRadius: "10px",
                                 transform: rowDragging ? "scale(0.992)" : "scale(1)",
                                 transition:
                                    "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)"
                              }}
                              {...makeFieldRowDragHandlers("primary", f.id, idx)}
                           >
                           <label style={{ fontSize: "0.8rem", color: "#6d7175", display: "block" }}>{f.label}</label>
                           <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                              <FieldReorderDragHandle
                                 section="primary"
                                 fieldId={f.id}
                                 onReorderDragStart={handleFieldReorderDragStart}
                                 onReorderDragEnd={endFieldReorderDrag}
                              />
                              <input
                                 readOnly
                                 placeholder={f.placeholder || f.label}
                                 style={{
                                    ...inputStyle,
                                    flex: 1,
                                    minWidth: 0,
                                    background: "#f5f5f5",
                                    color: "#8c9196",
                                    cursor: "default"
                                 }}
                              />
                              <button type="button" title="Edit field" style={pencilBtnStyle} onClick={() => openFieldModal(f)}>
                                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                 </svg>
                              </button>
                           </div>
                        </div>
                        </React.Fragment>
                     );
                  })}
                  <FieldReorderInsertSlot
                     visible={
                        !!(
                           fieldReorderDrag?.section === "primary" &&
                           fieldReorderInsert?.section === "primary" &&
                           fieldReorderInsert.beforeId === FIELD_REORDER_INSERT_END &&
                           fieldReorderDrag.fieldId &&
                           !isFieldReorderInsertNoOp(primaryFields, fieldReorderDrag.fieldId, FIELD_REORDER_INSERT_END)
                        )
                     }
                     variant="between"
                     dragTargetHandlers={makeInsertSlotHandlers("primary", FIELD_REORDER_INSERT_END)}
                  />
               </div>
            </div>

            {/* Business Details */}
            <div style={newFormCardStyle}>
               <h2 style={{ margin: "0 0 20px", fontSize: "1.15rem", fontWeight: 700, color: "#202223" }}>Business Details</h2>
               <div
                  style={{
                     display: "grid",
                     gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 300px)",
                     gap: "24px",
                     alignItems: "stretch"
                  }}
               >
                  <div
                     style={{
                        minHeight: "320px",
                        borderRadius: "12px",
                        border: "1px solid #ececec",
                        background: "#fafafa",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: businessFields.length === 0 ? "center" : "flex-start",
                        padding: businessFields.length === 0 ? "32px" : "20px",
                        overflow: "auto"
                     }}
                  >
                     {businessFields.length === 0 ? (
                        <>
                           <div style={{ marginBottom: "20px", color: "#c4cdd5" }}>
                              <svg width="72" height="88" viewBox="0 0 72 88" fill="none" aria-hidden>
                                 <rect x="10" y="6" width="18" height="18" rx="3" fill="#f5a623" />
                                 <rect x="8" y="14" width="56" height="70" rx="6" stroke="#c4cdd5" strokeWidth="2" fill="white" />
                                 <path d="M22 38h28M22 48h20M22 58h24" stroke="#dfe3e8" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                           </div>
                           <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#202223", marginBottom: "8px" }}>No Fields Added Yet</div>
                           <div style={{ fontSize: "0.9rem", color: "#6d7175", textAlign: "center", maxWidth: "280px" }}>
                              Pick form elements to add them to your form
                           </div>
                        </>
                     ) : (
                        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
                           <div style={{ ...reorderHintStyle, marginBottom: 0 }}>
                              <strong style={{ color: "#202223" }}>Reorder:</strong> drag from the handle. Use the <strong>top or bottom half</strong> of a card to insert before or after that field. A green slot appears only when the order would change, including at the end (within Business Details).
                           </div>
                           {businessFields.map((f: any, idx: number) => {
                              const rowDragging =
                                 fieldReorderDrag?.fieldId === f.id && fieldReorderDrag?.section === "business";
                              const showInsertGap =
                                 fieldReorderDrag &&
                                 fieldReorderInsert?.section === "business" &&
                                 fieldReorderInsert.beforeId === f.id &&
                                 fieldReorderDrag.fieldId !== f.id &&
                                 !isFieldReorderInsertNoOp(businessFields, fieldReorderDrag.fieldId, f.id);
                              return (
                                 <React.Fragment key={f.id}>
                                    <FieldReorderInsertSlot
                                       visible={!!showInsertGap}
                                       variant="between"
                                       dragTargetHandlers={makeInsertSlotHandlers("business", f.id)}
                                    />
                                    <div
                                       style={{
                                          padding: "14px 16px",
                                          borderRadius: "10px",
                                          border: "1px solid #e3e3e3",
                                          background: "#fff",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "10px",
                                          opacity: rowDragging ? 0.52 : 1,
                                          transform: rowDragging ? "scale(0.992)" : "scale(1)",
                                          transition:
                                             "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)"
                                       }}
                                       {...makeFieldRowDragHandlers("business", f.id, idx)}
                                    >
                                    <FieldReorderDragHandle
                                       section="business"
                                       fieldId={f.id}
                                       onReorderDragStart={handleFieldReorderDragStart}
                                       onReorderDragEnd={endFieldReorderDrag}
                                    />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                       <div style={{ fontWeight: 600, color: "#202223" }}>{f.label}</div>
                                       <div style={{ fontSize: "0.8rem", color: "#6d7175", marginTop: "4px" }}>{f.type}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                                       <button type="button" title="Edit field" style={pencilBtnStyle} onClick={() => openFieldModal(f)}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                                             <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                             <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                          </svg>
                                       </button>
                                       <button type="button" onClick={() => removeFieldById(f.id)} style={{ ...pencilBtnStyle, color: "#8c9196" }} title="Remove">
                                          ×
                                       </button>
                                    </div>
                                 </div>
                                 </React.Fragment>
                              );
                           })}
                           <FieldReorderInsertSlot
                              visible={
                                 !!(
                                    fieldReorderDrag?.section === "business" &&
                                    fieldReorderInsert?.section === "business" &&
                                    fieldReorderInsert.beforeId === FIELD_REORDER_INSERT_END &&
                                    fieldReorderDrag.fieldId &&
                                    !isFieldReorderInsertNoOp(
                                       businessFields,
                                       fieldReorderDrag.fieldId,
                                       FIELD_REORDER_INSERT_END
                                    )
                                 )
                              }
                              variant="between"
                              dragTargetHandlers={makeInsertSlotHandlers("business", FIELD_REORDER_INSERT_END)}
                           />
                        </div>
                     )}
                  </div>
                  <div style={{ borderRadius: "12px", border: "1px solid #ececec", background: "#fff", padding: "16px 12px 12px" }}>
                     <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#202223", padding: "4px 10px 12px" }}>Business Details</div>
                     <div style={{ display: "flex", flexDirection: "column" }}>
                        {BUSINESS_FIELD_PALETTE.map((preset) => {
                           const added = fieldHasPresetInList(businessFields, preset.presetKey);
                           return (
                              <button
                                 key={preset.presetKey}
                                 type="button"
                                 disabled={added}
                                 onClick={() => addPresetField(preset)}
                                 style={{
                                    ...paletteRowStyle,
                                    opacity: added ? 0.92 : 1,
                                    cursor: added ? "default" : "pointer"
                                 }}
                              >
                                 <span
                                    style={{
                                       width: "20px",
                                       height: "20px",
                                       borderRadius: "6px",
                                       border: added ? "2px solid #008060" : "1px solid #d0d5d8",
                                       background: added ? "#e3f1ed" : "#f6f6f7",
                                       flexShrink: 0,
                                       display: "flex",
                                       alignItems: "center",
                                       justifyContent: "center"
                                    }}
                                 >
                                    {added ? (
                                       <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden>
                                          <path
                                             d="M1 5l3.5 3.5L11 1"
                                             stroke="#008060"
                                             strokeWidth="2"
                                             strokeLinecap="round"
                                             strokeLinejoin="round"
                                          />
                                       </svg>
                                    ) : null}
                                 </span>
                                 <span>{preset.label}</span>
                              </button>
                           );
                        })}
                     </div>
                  </div>
               </div>
            </div>

            {/* More Details — custom fields */}
            <div style={{ ...newFormCardStyle, marginTop: "20px" }}>
               <h2 style={{ margin: "0 0 20px", fontSize: "1.15rem", fontWeight: 700, color: "#202223" }}>More Details</h2>
               <div
                  style={{
                     display: "grid",
                     gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 300px)",
                     gap: "24px",
                     alignItems: "stretch"
                  }}
               >
                  <div
                     style={{
                        minHeight: "280px",
                        borderRadius: "12px",
                        border: "1px solid #ececec",
                        background: "#fafafa",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px"
                     }}
                  >
                     {customFields.length === 0 ? (
                        <div style={{ color: "#6d7175", fontSize: "0.9rem", textAlign: "center", margin: "auto", padding: "24px" }}>
                           Add custom fields from the list on the right.
                        </div>
                     ) : (
                        <>
                           <div style={{ ...reorderHintStyle, marginBottom: 0 }}>
                              <strong style={{ color: "#202223" }}>Reorder:</strong> drag from the handle. Use the <strong>top or bottom half</strong> of a card to insert before or after that field. A green slot appears only when the order would change, including at the end (within More Details).
                           </div>
                           {customFields.map((f: any, idx: number) => {
                              const rowDragging =
                                 fieldReorderDrag?.fieldId === f.id && fieldReorderDrag?.section === "custom";
                              const showInsertGap =
                                 fieldReorderDrag &&
                                 fieldReorderInsert?.section === "custom" &&
                                 fieldReorderInsert.beforeId === f.id &&
                                 fieldReorderDrag.fieldId !== f.id &&
                                 !isFieldReorderInsertNoOp(customFields, fieldReorderDrag.fieldId, f.id);
                              return (
                                 <React.Fragment key={f.id}>
                                    <FieldReorderInsertSlot
                                       visible={!!showInsertGap}
                                       variant="between"
                                       dragTargetHandlers={makeInsertSlotHandlers("custom", f.id)}
                                    />
                                    <div
                                       style={{
                                          padding: "12px 14px",
                                          borderRadius: "10px",
                                          border: "1px solid #e3e3e3",
                                          background: "#fff",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "8px",
                                          opacity: rowDragging ? 0.52 : 1,
                                          transform: rowDragging ? "scale(0.992)" : "scale(1)",
                                          transition:
                                             "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)"
                                       }}
                                       {...makeFieldRowDragHandlers("custom", f.id, idx)}
                                    >
                                    <div style={{ fontWeight: 600, color: "#202223" }}>{f.label}</div>
                                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                       <FieldReorderDragHandle
                                          section="custom"
                                          fieldId={f.id}
                                          onReorderDragStart={handleFieldReorderDragStart}
                                          onReorderDragEnd={endFieldReorderDrag}
                                       />
                                       <div style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "#6d7175" }}>
                                          {f.type === "textarea" ? (
                                             <div
                                                style={{
                                                   ...inputStyle,
                                                   minHeight: 72,
                                                   background: "#f9f9f9",
                                                   fontSize: "0.85rem",
                                                   color: "#999"
                                                }}
                                             >
                                                Sample multiline text
                                             </div>
                                          ) : f.type === "dropdown" ? (
                                             <select style={{ ...inputStyle, background: "#f9f9f9" }} disabled>
                                                <option>Select…</option>
                                             </select>
                                          ) : f.type === "choice_list" ? (
                                             <div style={{ fontSize: "0.85rem", color: "#6d7175", padding: "10px 0" }}>
                                                Choice list ({(f.options || []).length} options)
                                             </div>
                                          ) : f.type === "multi_choice" ? (
                                             <div style={{ fontSize: "0.85rem", color: "#6d7175", padding: "10px 0" }}>
                                                Multi choice ({(f.options || []).length} options)
                                             </div>
                                          ) : (
                                             <input style={{ ...inputStyle, background: "#f9f9f9" }} readOnly placeholder={f.label} />
                                          )}
                                       </div>
                                       <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                                          <button type="button" title="Edit field" style={pencilBtnStyle} onClick={() => openFieldModal(f)}>
                                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                             </svg>
                                          </button>
                                          <button type="button" title="Delete" style={pencilBtnStyle} onClick={() => removeFieldById(f.id)}>
                                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d72c0d" strokeWidth="2">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                             </svg>
                                          </button>
                                       </div>
                                    </div>
                                 </div>
                                 </React.Fragment>
                              );
                           })}
                           <FieldReorderInsertSlot
                              visible={
                                 !!(
                                    fieldReorderDrag?.section === "custom" &&
                                    fieldReorderInsert?.section === "custom" &&
                                    fieldReorderInsert.beforeId === FIELD_REORDER_INSERT_END &&
                                    fieldReorderDrag.fieldId &&
                                    !isFieldReorderInsertNoOp(
                                       customFields,
                                       fieldReorderDrag.fieldId,
                                       FIELD_REORDER_INSERT_END
                                    )
                                 )
                              }
                              variant="between"
                              dragTargetHandlers={makeInsertSlotHandlers("custom", FIELD_REORDER_INSERT_END)}
                           />
                        </>
                     )}
                  </div>
                  <div style={{ borderRadius: "12px", border: "1px solid #ececec", background: "#fff", padding: "16px 12px 12px" }}>
                     <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#202223", padding: "4px 10px 12px" }}>Custom Fields</div>
                     <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {CUSTOM_FIELD_PALETTE_ENTRIES.map((entry) => (
                           <button
                              key={entry.type + entry.defaultLabel}
                              type="button"
                              onClick={() => addCustomFieldFromPalette(entry)}
                              style={{
                                 padding: "12px 14px",
                                 borderRadius: "999px",
                                 border: "1px solid #dfe3e8",
                                 background: "#fafbfb",
                                 cursor: "pointer",
                                 textAlign: "left",
                                 fontSize: "0.9rem",
                                 color: "#202223"
                              }}
                           >
                              {entry.defaultLabel}
                           </button>
                        ))}
                     </div>
                  </div>
               </div>
            </div>
         </s-page>

         {fieldModal ? (
            <div
               style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.45)",
                  zIndex: 2000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "20px"
               }}
               role="presentation"
               onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setFieldModal(null);
               }}
            >
               <div
                  style={{
                     background: "#fff",
                     borderRadius: "12px",
                     maxWidth: "520px",
                     width: "100%",
                     maxHeight: "90vh",
                     overflow: "auto",
                     padding: "24px",
                     boxShadow: "0 12px 40px rgba(0,0,0,0.15)"
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
               >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                     <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Edit Field</h3>
                     <button type="button" style={{ border: "none", background: "none", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }} onClick={() => setFieldModal(null)}>
                        ×
                     </button>
                  </div>
                  <label style={labelStyle}>Label</label>
                  <input style={{ ...inputStyle, marginBottom: "12px" }} value={fieldModal.label} onChange={(e) => setFieldModal({ ...fieldModal, label: e.target.value })} />
                  <label style={labelStyle}>Hint</label>
                  <input style={{ ...inputStyle, marginBottom: "12px" }} value={fieldModal.hint || ""} onChange={(e) => setFieldModal({ ...fieldModal, hint: e.target.value })} />
                  <label style={labelStyle}>Name</label>
                  <input
                     style={{ ...inputStyle, marginBottom: "12px", background: fieldModal.section === "primary" ? "#f4f4f4" : undefined }}
                     value={fieldModal.name || ""}
                     disabled={fieldModal.section === "primary"}
                     onChange={(e) => setFieldModal({ ...fieldModal, name: e.target.value })}
                  />
                  <label style={labelStyle}>Default value</label>
                  <input style={{ ...inputStyle, marginBottom: "12px" }} value={fieldModal.defaultValue || ""} onChange={(e) => setFieldModal({ ...fieldModal, defaultValue: e.target.value })} />
                  <div style={{ border: "1px solid #e3e3e3", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
                     <div style={{ fontWeight: 700, marginBottom: "10px", fontSize: "0.9rem" }}>Validation</div>
                     <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input type="checkbox" checked={!!fieldModal.required} onChange={(e) => setFieldModal({ ...fieldModal, required: e.target.checked })} />
                        <span>Required</span>
                     </label>
                  </div>
                  {showOptionsInModal ? (
                     <div style={{ marginBottom: "16px" }}>
                        <div style={{ fontWeight: 700, marginBottom: "8px", fontSize: "0.9rem" }}>Options</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", fontSize: "0.8rem", fontWeight: 600, color: "#6d7175", marginBottom: "4px" }}>
                           <span>Label</span>
                           <span>Value</span>
                           <span />
                        </div>
                        {(fieldModal.options || []).map((opt: any, i: number) => (
                           <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginBottom: "8px" }}>
                              <input
                                 style={inputStyle}
                                 value={opt.label}
                                 placeholder="Enter option label"
                                 onChange={(e) => {
                                    const opts = [...(fieldModal.options || [])];
                                    opts[i] = { ...opts[i], label: e.target.value };
                                    setFieldModal({ ...fieldModal, options: opts });
                                 }}
                              />
                              <input
                                 style={inputStyle}
                                 value={opt.value}
                                 placeholder="Enter option value"
                                 onChange={(e) => {
                                    const opts = [...(fieldModal.options || [])];
                                    opts[i] = { ...opts[i], value: e.target.value };
                                    setFieldModal({ ...fieldModal, options: opts });
                                 }}
                              />
                              <button type="button" style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }} onClick={() => {
                                 const opts = (fieldModal.options || []).filter((_: any, j: number) => j !== i);
                                 setFieldModal({ ...fieldModal, options: opts });
                              }}>
                                 Delete
                              </button>
                           </div>
                        ))}
                        <button
                           type="button"
                           style={{ marginTop: "8px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #008060", background: "#fff", color: "#008060", cursor: "pointer", fontWeight: 600 }}
                           onClick={() => {
                              const opts = [...(fieldModal.options || []), { label: "", value: "" }];
                              setFieldModal({ ...fieldModal, options: opts });
                           }}
                        >
                           Add option
                        </button>
                     </div>
                  ) : null}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                     <button type="button" style={{ padding: "10px 18px", borderRadius: "8px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }} onClick={() => setFieldModal(null)}>
                        Cancel
                     </button>
                     <button type="button" style={{ padding: "10px 18px", borderRadius: "8px", border: "none", background: "#202223", color: "#fff", cursor: "pointer", fontWeight: 600 }} onClick={saveFieldModal}>
                        Done
                     </button>
                  </div>
               </div>
            </div>
         ) : null}
      </>
   );
}

/** Default tags from the registration form (per submission when viewing all forms). */
function defaultCustomerTagsForSubmission(submission: any, selectedForm: any | null, forms: any[]) {
   if (selectedForm) return (selectedForm.customerTags || "").trim();
   const matched = forms.find((f: any) => f.id === submission.formId);
   return (matched?.customerTags || "").trim();
}

/**
 * SUBMISSIONS VIEW
 */
function FormSubmissions({
   forms,
   selectedFormId,
   onSelectForm,
   form,
   submissions,
   priceLists,
   uniqueTags,
   onBack
}: any) {
   const fetcher = useFetcher<any>();
   const shopify = useAppBridge();
   const [draftRows, setDraftRows] = useState<Record<string, { status: string; customerTags: string }>>({});

   useEffect(() => {
      if (fetcher.data?.message) {
         shopify.toast.show(fetcher.data.message);
      }
   }, [fetcher.data, shopify]);

   useEffect(() => {
      const next: Record<string, { status: string; customerTags: string }> = {};
      for (const submission of submissions) {
         const existing = draftRows[submission.id];
         if (existing !== undefined) continue;
         next[submission.id] = getDefaultDraftRow(
            submission,
            defaultCustomerTagsForSubmission(submission, form, forms)
         );
      }
      if (Object.keys(next).length > 0) {
         setDraftRows((prev) => ({ ...prev, ...next }));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [submissions, form, forms, selectedFormId]);

   const pendingSubmissions = submissions.filter((submission: any) => submission.status === "pending");
   const mergedFormDefaultTags = form
      ? form.customerTags || ""
      : forms.map((f: any) => f.customerTags).filter(Boolean).join(",");
   const tagOptions = buildTagOptions(uniqueTags, mergedFormDefaultTags || undefined);
   const showFormColumn = selectedFormId === "all";
   const hasUnsavedChanges = submissions.some((submission: any) => {
      const draft = draftRows[submission.id];
      if (!draft) return false;
      const original = getDefaultDraftRow(
         submission,
         defaultCustomerTagsForSubmission(submission, form, forms)
      );
      return draft.status !== original.status || draft.customerTags !== original.customerTags;
   });

   const handleSave = () => {
      const rowsPayload = submissions.map((submission: any) => ({
         id: submission.id,
         status: draftRows[submission.id]?.status || submission.status,
         customerTags: (draftRows[submission.id]?.customerTags || "").trim()
      }));
      fetcher.submit(
         { actionType: "saveSubmissionAssignments", rows: JSON.stringify(rowsPayload) },
         { method: "POST" }
      );
   };

   const handleDiscard = () => {
      const resetRows: Record<string, { status: string; customerTags: string }> = {};
      for (const submission of submissions) {
         resetRows[submission.id] = getDefaultDraftRow(
            submission,
            defaultCustomerTagsForSubmission(submission, form, forms)
         );
      }
      setDraftRows(resetRows);
   };

   return (
      <>
         {hasUnsavedChanges && (
            <div style={unsavedBarStyle}>
               <div style={{ color: "white", fontWeight: 600 }}>Unsaved changes</div>
               <div style={{ display: "flex", gap: "10px" }}>
                  <button
                     style={unsavedDiscardButtonStyle}
                     disabled={fetcher.state === "submitting"}
                     onClick={handleDiscard}
                  >
                     Discard
                  </button>
                  <button
                     style={unsavedSaveButtonStyle}
                     disabled={fetcher.state === "submitting"}
                     onClick={handleSave}
                  >
                     {fetcher.state === "submitting" ? "Saving..." : "Save"}
                  </button>
               </div>
            </div>
         )}
         <Breadcrumbs items={[{ label: "Registration Forms", onClick: onBack }, { label: "Submissions" }]} />
         <s-page heading={`Edit Customer Group`} back-action-url="/app/customer-management?mode=onboarding">
            <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
               <s-button variant="secondary" onClick={onBack}>← Back</s-button>
            </div>
            <div style={{ marginBottom: "24px" }}>
               <div style={formCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                     <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Registration form</div>
                        <select
                           value={selectedFormId}
                           onChange={(e) => onSelectForm(e.target.value)}
                           disabled={fetcher.state === "submitting"}
                           style={{ ...inputStyle, padding: "8px 10px", width: "100%", maxWidth: 480, appearance: "auto" }}
                        >
                           <option value="all">All forms</option>
                           {forms.map((f: any) => (
                              <option key={f.id} value={f.id}>
                                 {f.name}
                              </option>
                           ))}
                        </select>
                        <div style={{ marginTop: 6, color: "#6d7175", fontSize: "0.85em" }}>
                           Filter submissions by form, or show every form at once.
                        </div>
                     </div>
                     <div style={{ whiteSpace: "nowrap", color: "#6d7175", fontSize: "0.85em" }}>
                        Pending: <strong>{pendingSubmissions.length}</strong> / Total: <strong>{submissions.length}</strong>
                     </div>
                  </div>
               </div>
            </div>

            <div style={formCardStyle}>
               <div style={{ fontWeight: 700, marginBottom: 12 }}>Assign Customer(s)</div>

               {submissions.length === 0 ? (
                  <Text as="p" tone="subdued">No applications submitted yet.</Text>
               ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                     <thead>
                        <tr style={{ textAlign: "left", background: "#fcfcfc", borderBottom: "1px solid #eee" }}>
                           <th style={thStyle}>Name</th>
                           <th style={thStyle}>Email</th>
                           {showFormColumn ? <th style={thStyle}>Form</th> : null}
                           <th style={thStyle}>Status</th>
                           <th style={thStyle}>Customer Tags</th>
                           <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
                        </tr>
                     </thead>
                     <tbody>
                        {submissions.map((submission: any) => {
                           const data = parseSubmissionPayload(submission.formData);
                           const firstName = getPayloadValue(data, ["first_name", "firstName", "fname", "first", "name"]);
                           const lastName = getPayloadValue(data, ["last_name", "lastName", "lname", "last"]);
                           const displayName = `${firstName} ${lastName}`.trim() || "N/A";
                           const draft =
                              draftRows[submission.id] ||
                              getDefaultDraftRow(
                                 submission,
                                 defaultCustomerTagsForSubmission(submission, form, forms)
                              );
                           const selectedTags = draft.customerTags;
                           const submissionFormName =
                              forms.find((f: any) => f.id === submission.formId)?.name || "—";

                           return (
                              <tr key={submission.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                 <td style={tdStyle}>{displayName}</td>
                                 <td style={tdStyle}>{submission.customerEmail || "N/A"}</td>
                                 {showFormColumn ? <td style={tdStyle}>{submissionFormName}</td> : null}
                                 <td style={tdStyle}>
                                    <select
                                       value={draft.status}
                                       title={
                                          submission.status === "approved"
                                             ? "Approved submissions cannot change status."
                                             : undefined
                                       }
                                       disabled={fetcher.state === "submitting" || submission.status === "approved"}
                                       style={{ ...inputStyle, padding: "8px 10px", maxWidth: 220, appearance: "auto" }}
                                       onChange={(e) => {
                                          const nextStatus = e.target.value;
                                          setDraftRows((prev) => ({
                                             ...prev,
                                             [submission.id]: {
                                                status: nextStatus,
                                                customerTags: selectedTags
                                             }
                                          }));
                                       }}
                                    >
                                       <option value="pending">Pending</option>
                                       <option value="approved">Approved</option>
                                    </select>
                                 </td>
                                 <td style={tdStyle}>
                                    <TagCombobox
                                       value={selectedTags}
                                       onChange={(nextTag) =>
                                          setDraftRows((prev) => ({
                                             ...prev,
                                             [submission.id]: {
                                                status: draft.status,
                                                customerTags: nextTag
                                             }
                                          }))
                                       }
                                       availableTags={tagOptions}
                                       placeholder="e.g. ALL, wholesale_gold"
                                    />
                                 </td>
                                 <td style={{ ...tdStyle, textAlign: "right" }}>
                                    <button
                                       title="Delete"
                                       disabled={fetcher.state === "submitting"}
                                       onClick={() => {
                                          if (confirm("Delete this submission?")) {
                                             fetcher.submit({ actionType: "deleteSubmission", submissionId: submission.id }, { method: "POST" });
                                          }
                                       }}
                                       style={deleteButtonStyle}
                                    >
                                       🗑️ Delete
                                    </button>
                                 </td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               )}
            </div>
         </s-page>
      </>
   );
}

/** Opens Shopify Admin customer profile (numeric id from Customer GID). */
function shopifyAdminCustomerEditUrl(shopDomain: string, customerGid: string): string {
   const handle = shopDomain.replace(/\.myshopify\.com$/i, "");
   const numericId = customerGid.split("/").pop() || "";
   return `https://admin.shopify.com/store/${handle}/customers/${numericId}`;
}

function parseSubmissionPayload(payload: string) {
   try {
      return JSON.parse(payload || "{}");
   } catch (_error) {
      return {};
   }
}

function getPayloadValue(payload: Record<string, any>, keys: string[]) {
   for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
         return value.trim();
      }
   }
   return "";
}

function buildTagOptions(uniqueTags: string[], formCustomerTags: string | null | undefined) {
   const options = new Set<string>();
   (uniqueTags || []).forEach((tag) => {
      const normalized = String(tag || "").trim();
      if (normalized) options.add(normalized);
   });
   if (formCustomerTags) {
      formCustomerTags
         .split(",")
         .map((t) => t.trim())
         .filter(Boolean)
         .forEach((t) => options.add(t));
   }
   if (!options.has("ALL")) options.add("ALL");
   return Array.from(options).filter(Boolean);
}

function getDefaultDraftRow(submission: any, formCustomerTags: string | null | undefined) {
   return {
      status: submission.status,
      customerTags: (submission.customerTags || formCustomerTags || "").trim()
   };
}

async function approveSubmissionAndCreateCustomer({
   admin,
   submission,
   fallbackTags
}: {
   admin: any;
   submission: any;
   fallbackTags: string;
}) {
   const registrationForm = await db.registrationForm.findUnique({ where: { id: submission.formId } });
   const payload = parseSubmissionPayload(submission.formData);
   const customerEmail = (submission.customerEmail || payload.email || "").trim();

   if (!customerEmail) {
      return { success: false, message: "Submission is missing email" };
   }

   const firstName = getPayloadValue(payload, ["first_name", "firstName", "fname", "first", "name"]);
   const lastName = getPayloadValue(payload, ["last_name", "lastName", "lname", "last"]);
   const source = fallbackTags || registrationForm?.customerTags || "";
   const tags = source
      .split(",")
      .map((tag: string) => tag.trim())
      .filter(Boolean);

   const existingRes = await admin.graphql(
      `#graphql
      query FindCustomerByEmail($query: String!) {
         customers(first: 1, query: $query) {
            edges {
               node { id email tags }
            }
         }
      }`,
      { variables: { query: `email:${customerEmail}` } }
   );
   const existingJson: any = await existingRes.json();
   const existingCustomer = existingJson.data?.customers?.edges?.[0]?.node;

   if (existingCustomer?.id) {
      const currentTags = normalizeTags(existingCustomer.tags || []);
      const desiredTags = normalizeTags(tags);
      // Merge: keep current tags and add new ones from submission (not replace)
      const mergedTags = normalizeTags([...currentTags, ...desiredTags]);
      const hasTagChanges = mergedTags.join("|") !== currentTags.join("|");
      if (hasTagChanges) {
         const updateResult = await updateCustomerTags(admin, existingCustomer.id, mergedTags);
         if (!updateResult.success) return updateResult;
      }
   } else {
      const createCustomerRes = await admin.graphql(
         `#graphql
         mutation CreateCustomer($input: CustomerInput!) {
            customerCreate(input: $input) {
               customer {
                  id
               }
               userErrors {
                  field
                  message
               }
            }
         }`,
         {
            variables: {
               input: {
                  email: customerEmail,
                  firstName: firstName || undefined,
                  lastName: lastName || undefined,
                  tags
               }
            }
         }
      );

      const createCustomerJson: any = await createCustomerRes.json();
      const userErrors = createCustomerJson.data?.customerCreate?.userErrors || [];
      const createdCustomer = createCustomerJson.data?.customerCreate?.customer;

      if (userErrors.length > 0 || !createdCustomer?.id) {
         const firstError = userErrors[0]?.message || "Failed to create customer";
         return { success: false, message: firstError };
      }
   }

   await db.formSubmission.update({
      where: { id: submission.id },
      data: { status: "approved" }
   });

   return { success: true };
}

async function updateCustomerTags(admin: any, customerId: string, tags: string[]) {
   const updateRes = await admin.graphql(
      `#graphql
      mutation UpdateCustomerTags($input: CustomerInput!) {
         customerUpdate(input: $input) {
            customer {
               id
            }
            userErrors {
               field
               message
            }
         }
      }`,
      {
         variables: {
            input: {
               id: customerId,
               tags
            }
         }
      }
   );

   const updateJson: any = await updateRes.json();
   const userErrors = updateJson.data?.customerUpdate?.userErrors || [];
   if (userErrors.length > 0) {
      return { success: false, message: userErrors[0]?.message || "Failed to update customer tags" };
   }
   return { success: true };
}

function normalizeTags(tags: string[]) {
   return Array.from(
      new Set(
         (tags || [])
            .map((tag) => String(tag || "").trim())
            .filter(Boolean)
      )
   ).sort((a, b) => a.localeCompare(b));
}

// STYLES
const thStyle = { padding: "12px 15px" };
const tdStyle = { padding: "12px 15px" };
const tagStyle = { background: "#e1f5fe", color: "#0288d1", padding: "4px 8px", borderRadius: "4px", fontSize: "0.8em", fontWeight: "bold" };
const smallCardStyle = { background: "#fff", padding: "15px", borderRadius: "10px", border: "1px solid #eee", display: "flex", flexDirection: "column" as const, gap: "10px" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" as const };
const labelStyle = { display: "block", marginBottom: "5px", fontWeight: "bold", fontSize: "0.9em" };
const pendingBadgeStyle = { background: "#fff7e6", color: "#ad6800", padding: "4px 8px", borderRadius: "999px", fontSize: "0.8em", fontWeight: "bold" };
const approvedBadgeStyle = { background: "#f6ffed", color: "#237804", padding: "4px 8px", borderRadius: "999px", fontSize: "0.8em", fontWeight: "bold" };
const approveButtonStyle = { background: "#008060", color: "white", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" };
const deleteButtonStyle = { background: "none", border: "none", color: "#d72c0d", cursor: "pointer", fontWeight: 600 };
const formCardStyle = { background: "white", padding: "18px", borderRadius: "12px", border: "1px solid #ddd" };
const topSaveButtonStyle = { background: "#2b2b2b", color: "white", border: "none", borderRadius: "10px", padding: "10px 18px", fontWeight: 700, cursor: "pointer" };
const unsavedBarStyle = {
   position: "sticky" as const,
   top: 0,
   zIndex: 1100,
   marginBottom: "16px",
   background: "#1f1f1f",
   borderRadius: "12px",
   padding: "12px 16px",
   display: "flex",
   justifyContent: "space-between",
   alignItems: "center"
};
const unsavedDiscardButtonStyle = {
   background: "#3a3a3a",
   color: "white",
   border: "1px solid #4c4c4c",
   borderRadius: "10px",
   padding: "8px 14px",
   cursor: "pointer",
   fontWeight: 600
};
const unsavedSaveButtonStyle = {
   background: "white",
   color: "#202223",
   border: "none",
   borderRadius: "10px",
   padding: "8px 14px",
   cursor: "pointer",
   fontWeight: 700
};

const modalOverlayStyle = { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalContentStyle = { background: "white", padding: "30px", borderRadius: "12px", width: "450px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" };
