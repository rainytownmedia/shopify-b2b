import { useState, useEffect, useRef } from "react";

interface TagComboboxProps {
  value: string;
  onChange: (val: string) => void;
  availableTags: string[];
  placeholder?: string;
}

/**
 * Shopify-style tag combobox.
 * Uses position: fixed for the dropdown so it is never clipped
 * by parent containers with overflow: hidden (e.g. tables with border-radius).
 */
export function TagCombobox({
  value,
  onChange,
  availableTags,
  placeholder = "Search or add tag...",
}: TagComboboxProps) {
  const [inputValue, setInputValue] = useState(value || "");
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when parent value changes
  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Recalculate dropdown position whenever it opens or user scrolls/resizes
  const updateRect = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  };

  useEffect(() => {
    if (!isOpen) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setInputValue(value || "");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [value]);

  const trimmed = inputValue.trim();

  const filtered = [
    ...(("all".includes(trimmed.toLowerCase()) && availableTags.includes("ALL")) ? ["ALL"] : []),
    ...availableTags.filter(
      (t) => t !== "ALL" && t.toLowerCase().includes(trimmed.toLowerCase())
    ),
  ];

  const exactMatch = availableTags.some(
    (t) => t.toLowerCase() === trimmed.toLowerCase()
  );
  const showAdd = trimmed !== "" && !exactMatch;

  const selectTag = (tag: string) => {
    onChange(tag);
    setInputValue(tag);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "9px 12px",
          borderRadius: "8px",
          border: isOpen ? "2px solid #005bd3" : "1px solid #ccc",
          outline: "none",
          boxSizing: "border-box",
          fontSize: "14px",
          background: "white",
        }}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => { updateRect(); setIsOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (showAdd && trimmed) selectTag(trimmed);
            else if (filtered.length > 0) selectTag(filtered[0]);
          }
          if (e.key === "Escape") {
            setIsOpen(false);
            setInputValue(value || "");
          }
        }}
      />

      {/* Dropdown — position: fixed escapes any overflow: hidden ancestor */}
      {isOpen && rect && (
        <div
          style={{
            position: "fixed",
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 9999,
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {/* "⊕ Add [value]" */}
          {showAdd && (
            <div
              onMouseDown={(e) => { e.preventDefault(); selectTag(trimmed); }}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 14px", cursor: "pointer",
                borderBottom: filtered.length > 0 ? "1px solid #f0f0f0" : "none",
                fontSize: "14px", color: "#202223",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f6f8")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <span style={{
                width: "18px", height: "18px", borderRadius: "50%",
                border: "1.5px solid #005bd3", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "#005bd3", fontSize: "16px", flexShrink: 0,
              }}>+</span>
              <span>Add <strong>{trimmed}</strong></span>
            </div>
          )}

          {/* Empty state */}
          {filtered.length === 0 && !showAdd && (
            <div style={{ padding: "12px 14px", color: "#888", fontSize: "14px" }}>
              No tags found
            </div>
          )}

          {/* Tag list */}
          {filtered.map((tag) => {
            const isSelected = tag === value;
            return (
              <div
                key={tag}
                onMouseDown={(e) => { e.preventDefault(); selectTag(tag); }}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px", cursor: "pointer",
                  fontSize: "14px", color: "#202223", background: "white",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f6f8")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
              >
                <span style={{
                  width: "18px", height: "18px", borderRadius: "4px",
                  border: isSelected ? "none" : "1.5px solid #ccc",
                  background: isSelected ? "#005bd3" : "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span>{tag}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
