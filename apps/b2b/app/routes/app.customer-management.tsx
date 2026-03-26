import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  // Search from URL
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("query") || "";

  // 1. Fetch PriceLists (Registration Groups)
  const pLists = await db.priceList.findMany({
    where: { shopId: session.shop, category: "REGISTRATION" },
    orderBy: { updatedAt: 'desc' }
  });

  // 2. Fetch Customers from Shopify with filtering
  const response = await admin.graphql(
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

  const customerJson: any = await response.json();
  const customers = customerJson.data?.customers?.edges || [];

  return { customers, priceLists: pLists, searchTerm, shopId: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
  }

  return { success: true };
};

export default function CustomerManagementPage() {
  const { customers, priceLists, searchTerm, shopId } = useLoaderData<typeof loader>();
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
                <s-button variant="secondary" onClick={() => {}}>View List</s-button>
             </div>
             <div style={smallCardStyle}>
                <strong>👥 Registration Groups</strong>
                <p style={{ fontSize: "0.85em", color: "#666" }}>Group customers by tags for wholesale pricing.</p>
                <s-button variant="secondary" onClick={() => {
                   const next = new URLSearchParams(searchParams);
                   next.set("mode", "groups");
                   setSearchParams(next);
                }}>Manage Groups</s-button>
             </div>
             <div style={smallCardStyle}>
                <strong>📧 Email Setup</strong>
                <p style={{ fontSize: "0.85em", color: "#666" }}>Configure automated emails for B2B status.</p>
                <s-button variant="secondary" onClick={() => {
                   window.location.href = "/app/email-setup";
                }}>Setup Emails</s-button>
             </div>
          </div>

          <div style={{ background: "white", padding: "20px", borderRadius: "12px", border: "1px solid #ddd", marginBottom: "20px", display: "flex", gap: "10px" }}>
            <input 
              type="text" 
              placeholder="Search by name, email, or tag..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              style={inputStyle} 
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

  return <div>Invalid View</div>;
}

// STYLES
const thStyle = { padding: "12px 15px" };
const tdStyle = { padding: "12px 15px" };
const tagStyle = { background: "#e1f5fe", color: "#0288d1", padding: "4px 8px", borderRadius: "4px", fontSize: "0.8em", fontWeight: "bold" };
const smallCardStyle = { background: "#fff", padding: "15px", borderRadius: "10px", border: "1px solid #eee", display: "flex", flexDirection: "column" as const, gap: "10px" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" as const };
const labelStyle = { display: "block", marginBottom: "5px", fontWeight: "bold", fontSize: "0.9em" };

const modalOverlayStyle = { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalContentStyle = { background: "white", padding: "30px", borderRadius: "12px", width: "450px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" };
