// ----------- File: /src/components/ReviewOutput.jsx -----------
import { useState } from "react";

function parseSections(text) {
  if (!text) return [];
  const sections = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split("\n").filter(Boolean);
    if (!lines.length) continue;
    const firstLine = lines[0].trim();
    const isHeader = firstLine.endsWith(":");
    if (isHeader && lines.length > 1) {
      sections.push({ label: firstLine.slice(0, -1), content: lines.slice(1).join("\n").trim() });
    } else if (isHeader) {
      sections.push({ label: firstLine.slice(0, -1), content: "" });
    } else {
      const inlineMatch = firstLine.match(/^([^:]+):\s*(.+)$/);
      if (inlineMatch) {
        sections.push({ label: inlineMatch[1].trim(), content: [inlineMatch[2].trim(), ...lines.slice(1)].join("\n").trim() });
      } else {
        sections.push({ label: null, content: block.trim() });
      }
    }
  }
  return sections;
}

function determinationColor(content) {
  const text = (content || "").toUpperCase();
  if (text.startsWith("FD"))     return "bg-red-50 border-red-300 text-red-800";
  if (text.startsWith("PD"))     return "bg-yellow-50 border-yellow-300 text-yellow-800";
  if (text.startsWith("PEND"))   return "bg-orange-50 border-orange-300 text-orange-800";
  if (text.startsWith("APPROV")) return "bg-green-50 border-green-300 text-green-800";
  return "bg-gray-50 border-gray-300 text-gray-800";
}

export default function ReviewOutput({ review }) {
  const [copied, setCopied] = useState(false);
  if (!review) return null;
  const sections = parseSections(review);
  const handleCopy = () => {
    navigator.clipboard.writeText(review).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="mt-8 border rounded-lg bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <h2 className="text-base font-semibold text-gray-800 tracking-wide uppercase">
          RapidNote — Prior Authorization Review
        </h2>
        <button onClick={handleCopy} className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-600 transition-colors">
          {copied ? "✓ Copied" : "Copy to clipboard"}
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {sections.map((section, i) => {
          const isDetermination = section.label && section.label.toLowerCase().includes("determination");
          const isApproved = section.label && section.label.toLowerCase().includes("approved visits");
          return (
            <div key={i} className="px-4 py-3">
              {section.label && (
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                  {section.label}
                </p>
              )}
              {isDetermination ? (
                <div className={`rounded border px-3 py-2 text-sm font-medium ${determinationColor(section.content)}`}>
                  {section.content}
                </div>
              ) : isApproved ? (
                <p className="text-2xl font-bold text-gray-900">{section.content}</p>
              ) : (
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{section.content}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
