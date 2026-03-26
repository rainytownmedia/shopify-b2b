import React from "react";
import { useNavigate } from "react-router";

interface BreadcrumbItem {
  label: string;
  url?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const navigate = useNavigate();

  return (
    <div style={{ 
      display: "flex", 
      alignItems: "center", 
      gap: "8px", 
      fontSize: "0.9em", 
      color: "#6d7175", 
      marginBottom: "20px",
      padding: "0 20px",
      maxWidth: "1000px",
      margin: "0 auto 10px auto"
    }}>
      <span 
        onClick={() => navigate("/app/dashboard")} 
        style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
        title="Home"
      >
        🏠
      </span>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <span>/</span>
          {item.url ? (
            <span 
              onClick={() => navigate(item.url!)} 
              style={{ cursor: "pointer", color: "#005bd3" }}
            >
              {item.label}
            </span>
          ) : (
            <span style={{ fontWeight: "500", color: "#202223" }}>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
