import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await db.storefrontConfig.findFirst({
    where: { shopId: session.shop }
  });
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const emailApprovedSubject = formData.get("emailApprovedSubject") as string;
  const emailApprovedBody = formData.get("emailApprovedBody") as string;
  const emailRejectedSubject = formData.get("emailRejectedSubject") as string;
  const emailRejectedBody = formData.get("emailRejectedBody") as string;

  await db.storefrontConfig.upsert({
    where: { shopId: session.shop },
    update: { emailApprovedSubject, emailApprovedBody, emailRejectedSubject, emailRejectedBody },
    create: { shopId: session.shop, emailApprovedSubject, emailApprovedBody, emailRejectedSubject, emailRejectedBody }
  });

  return { success: true };
};

export default function EmailSetupPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [approvedSubject, setApprovedSubject] = useState(settings?.emailApprovedSubject || "🎉 Your B2B Account has been approved!");
  const [approvedBody, setApprovedBody] = useState(settings?.emailApprovedBody || "Hi {{firstName}}, welcome to our B2B portal.");
  const [rejectedSubject, setRejectedSubject] = useState(settings?.emailRejectedSubject || "B2B Registration Status");
  const [rejectedBody, setRejectedBody] = useState(settings?.emailRejectedBody || "Hi {{firstName}}, sorry we cannot approve your B2B account at this time.");

  const handleSave = () => {
    fetcher.submit({
      emailApprovedSubject: approvedSubject,
      emailApprovedBody: approvedBody,
      emailRejectedSubject: rejectedSubject,
      emailRejectedBody: rejectedBody
    }, { method: "POST" });
    shopify.toast.show("Email settings saved");
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "B2B Customers", url: "/app/customer-management" }, { label: "Email Setup" }]} />
      <s-page heading="Email Notifications Setup" back-action-url="/app/customer-management">
        <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "30px" }}>
            
            {/* Approved Email Overlay */}
            <div style={formCardStyle}>
               <h3 style={{ marginTop: 0 }}>Approved Account Email</h3>
               <p style={helpTextStyle}>This email is sent when you manually approve a wholesale application.</p>
               <div style={{ marginBottom: "15px" }}>
                  <label style={labelStyle}>Subject Line</label>
                  <input type="text" value={approvedSubject} onChange={e => setApprovedSubject(e.target.value)} style={inputStyle} />
               </div>
               <div>
                  <label style={labelStyle}>Email Body (Markdown supported)</label>
                  <textarea value={approvedBody} onChange={e => setApprovedBody(e.target.value)} style={{ ...inputStyle, minHeight: "150px" }} />
                  <p style={hintTextStyle}>Variables: {"{{firstName}}"}, {"{{lastName}}"}, {"{{shopName}}"}</p>
               </div>
            </div>

            {/* Rejected Email Overlay */}
            <div style={formCardStyle}>
               <h3 style={{ marginTop: 0 }}>Rejected Account Email</h3>
               <p style={helpTextStyle}>This email is sent when a wholesale application is rejected.</p>
               <div style={{ marginBottom: "15px" }}>
                  <label style={labelStyle}>Subject Line</label>
                  <input type="text" value={rejectedSubject} onChange={e => setRejectedSubject(e.target.value)} style={inputStyle} />
               </div>
               <div>
                  <label style={labelStyle}>Email Body</label>
                  <textarea value={rejectedBody} onChange={e => setRejectedBody(e.target.value)} style={{ ...inputStyle, minHeight: "150px" }} />
               </div>
            </div>

            <div style={{ textAlign: "right", paddingBottom: "40px" }}>
               <s-button variant="primary" onClick={handleSave}>SAVE EMAIL SETTINGS</s-button>
            </div>
        </div>
      </s-page>
    </>
  );
}

const formCardStyle = { background: "white", padding: "30px", borderRadius: "12px", border: "1px solid #ddd" };
const labelStyle = { display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "0.9em" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" as const };
const helpTextStyle = { fontSize: "0.85em", color: "#666", marginBottom: "20px" };
const hintTextStyle = { fontSize: "0.8em", color: "#aaa", marginTop: "8px" };
