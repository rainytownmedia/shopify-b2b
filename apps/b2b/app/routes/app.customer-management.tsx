import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import React from "react";
import { Text } from "@shopify/polaris";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { TagCombobox } from "../components/TagCombobox";
import { getComboboxTagOptions } from "../utils/customer-tags.server";

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
      await db.registrationForm.create({
         data: {
            shopId: session.shop,
            name: "New Wholesale Form",
            fields: JSON.stringify([
               { id: "fname", label: "First Name", type: "text", required: true },
               { id: "eml", label: "Email Address", type: "email", required: true }
            ]),
            status: "active"
         }
      });
      return { success: true, message: "New form created" };
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

         const nextStatus = row.status === "approved" ? "approved" : "pending";
         const prevStatus = submission.status;
         const tagSource = (row.customerTags || "").trim();

         if (prevStatus === "pending" && nextStatus === "approved") {
            const approveResult = await approveSubmissionAndCreateCustomer({
               admin,
               submission,
               fallbackTags: tagSource
            });
            if (!approveResult.success) {
               return { success: false, message: approveResult.message || "Failed to approve customer" };
            }
            updatedCount += 1;
            continue;
         }

         // Keep Shopify tags in sync for already-approved rows when merchant edits tags.
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
            if (existingCustomer?.id) {
               const desiredTags = normalizeTags((tagSource || "").split(","));
               const currentTags = normalizeTags(existingCustomer.tags || []);
               const hasTagChanges = desiredTags.join("|") !== currentTags.join("|");
               if (hasTagChanges) {
                  const updateResult = await updateCustomerTags(admin, existingCustomer.id, desiredTags);
                  if (!updateResult.success) {
                     return { success: false, message: updateResult.message || "Failed to update customer tags" };
                  }
                  updatedCount += 1;
               }
            }
         }

         if (prevStatus !== nextStatus) {
            await db.formSubmission.update({
               where: { id: submission.id },
               data: { status: nextStatus }
            });
            updatedCount += 1;
         }
      }

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
               <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", marginBottom: "30px" }}>
                  <div style={smallCardStyle}>
                     <strong>📋 All Customers</strong>
                     <p style={{ fontSize: "0.85em", color: "#666" }}>View and manage your Shopify customer database.</p>
                     <s-button variant="secondary" onClick={() => { }}>View List</s-button>
                  </div>
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
                        window.location.href = "/app/email-setup";
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
                        </tr>
                     </thead>
                     <tbody>
                        {customers.length === 0 ? (
                           <tr><td colSpan={4} style={{ textAlign: "center", padding: "40px", color: "#888" }}>No customers found.</td></tr>
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

   const activeForm = registrationForms.find((f: any) => f.id === activeFormId);
   const activeFormSubmissions = (formSubmissions || []).filter((s: any) => s.formId === activeFormId);

   const handleCreate = () => {
      fetcher.submit({ actionType: "createRegistrationForm" }, { method: "POST" });
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
      if (fetcher.data?.success) {
         shopify.toast.show(fetcher.data.message);
      }
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
                  <s-button variant="primary" onClick={handleCreate} loading={fetcher.state === "submitting"}>Create New Form</s-button>
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
   if (view === 'designer' && activeForm) {
      return <FormDesigner form={activeForm} onBack={() => setView('list')} />;
   }

   /**
    * VIEW: SUBMISSIONS
    */
   if (view === 'submissions' && activeForm) {
      return <FormSubmissions form={activeForm} submissions={activeFormSubmissions} priceLists={priceLists} uniqueTags={uniqueTags} onBack={() => setView('list')} />;
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
function FormDesigner({ form, onBack }: any) {
   const fetcher = useFetcher<any>();
   const shopify = useAppBridge();

   const [formName, setFormName] = useState(form.name);
   const [autoApprove, setAutoApprove] = useState(form.autoApprove);
   const [fields, setFields] = useState(JSON.parse(form.fields || "[]"));

   const addField = () => {
      setFields([...fields, { id: `fld_${Date.now()}`, label: "New Field", type: "text", required: false }]);
   };

   const updateField = (id: string, key: string, value: any) => {
      setFields(fields.map((f: any) => f.id === id ? { ...f, [key]: value } : f));
   };

   const handleSave = () => {
      fetcher.submit({
         actionType: "saveRegistrationForm",
         formId: form.id,
         name: formName,
         autoApprove: autoApprove.toString(),
         fields: JSON.stringify(fields)
      }, { method: "POST" });
   };

   useEffect(() => {
      if (fetcher.data?.success) shopify.toast.show(fetcher.data.message);
   }, [fetcher.data, shopify]);

   return (
      <>
         <Breadcrumbs items={[{ label: "Registration Forms", onClick: onBack }, { label: "Designer" }]} />
         <s-page heading={`Design: ${formName}`} back-action-url="/app/customer-management?mode=onboarding">
            <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between" }}>
               <s-button variant="secondary" onClick={onBack}>← Back to List</s-button>
               <s-button variant="primary" onClick={handleSave} loading={fetcher.state === "submitting"}>Save Changes</s-button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: "30px" }}>
               <div style={{ background: "white", padding: "30px", borderRadius: "12px", border: "1px solid #ddd" }}>
                  <h3 style={{ marginTop: 0 }}>Fields</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                     {fields.map((f: any) => (
                        <div key={f.id} style={{ padding: "15px", border: "1px solid #eee", borderRadius: "8px", background: "#fcfcfc" }}>
                           <div style={{ display: "flex", gap: "15px" }}>
                              <div style={{ flex: 1 }}>
                                 <label style={labelStyle}>Label</label>
                                 <input style={inputStyle} value={f.label} onChange={e => updateField(f.id, "label", e.target.value)} />
                              </div>
                              <div style={{ width: "120px" }}>
                                 <label style={labelStyle}>Type</label>
                                 <select style={{...inputStyle, appearance: "auto"}} value={f.type} onChange={e => updateField(f.id, "type", e.target.value)}>
                                    <option value="text">Text</option>
                                    <option value="email">Email</option>
                                    <option value="tel">Phone</option>
                                    <option value="textarea">Textarea</option>
                                 </select>
                              </div>
                              <button onClick={() => setFields(fields.filter((x: any) => x.id !== f.id))} style={{ border: "none", background: "none", cursor: "pointer", paddingTop: "25px" }}>🗑️</button>
                           </div>
                        </div>
                     ))}
                     <s-button variant="secondary" onClick={addField}>+ Add Field</s-button>
                  </div>
               </div>
               <div style={{ background: "white", padding: "20px", borderRadius: "12px", border: "1px solid #ddd" }}>
                  <h3 style={{ marginTop: 0 }}>Settings</h3>
                  <label style={labelStyle}>Form Name</label>
                  <input style={{...inputStyle, marginBottom: "15px"}} value={formName} onChange={e => setFormName(e.target.value)} />
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                     <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} id="aa" />
                     <label htmlFor="aa" style={{ fontWeight: "bold", fontSize: "0.9em" }}>Auto-approve</label>
                  </div>
               </div>
            </div>
         </s-page>
      </>
   );
}

/**
 * SUBMISSIONS VIEW
 */
function FormSubmissions({ form, submissions, priceLists, uniqueTags, onBack }: any) {
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
         next[submission.id] = getDefaultDraftRow(submission, form.customerTags);
      }
      if (Object.keys(next).length > 0) {
         setDraftRows((prev) => ({ ...prev, ...next }));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [submissions, form.customerTags]);

   const pendingSubmissions = submissions.filter((submission: any) => submission.status === "pending");
   const tagOptions = buildTagOptions(uniqueTags, form.customerTags);
   const hasUnsavedChanges = submissions.some((submission: any) => {
      const draft = draftRows[submission.id];
      if (!draft) return false;
      const original = getDefaultDraftRow(submission, form.customerTags);
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
         resetRows[submission.id] = getDefaultDraftRow(submission, form.customerTags);
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
                     <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Customer Group Name</div>
                        <input style={inputStyle} value={form.name} disabled />
                        <div style={{ marginTop: 6, color: "#6d7175", fontSize: "0.85em" }}>
                           Create and assign customer groups to offer discounts for specific customer segments.
                        </div>
                     </div>
                     <div style={{ whiteSpace: "nowrap", color: "#6d7175", fontSize: "0.85em" }}>
                        Pending: <strong>{pendingSubmissions.length}</strong> / Total: <strong>{form.customerCount}</strong>
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
                           const draft = draftRows[submission.id] || { status: submission.status, customerTags: (form.customerTags || "").trim() };
                           const selectedTags = draft.customerTags;

                           return (
                              <tr key={submission.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                 <td style={tdStyle}>{displayName}</td>
                                 <td style={tdStyle}>{submission.customerEmail || "N/A"}</td>
                                 <td style={tdStyle}>
                                    <select
                                       value={draft.status}
                                       disabled={fetcher.state === "submitting"}
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
      customerTags: (formCustomerTags || "").trim()
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
      const hasTagChanges = desiredTags.join("|") !== currentTags.join("|");
      if (hasTagChanges) {
         const updateResult = await updateCustomerTags(admin, existingCustomer.id, desiredTags);
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
