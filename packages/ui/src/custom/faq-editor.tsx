"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../lib/utils.js";
import { Button } from "../primitives/button.js";
import { Input } from "../primitives/input.js";
import { Textarea } from "../primitives/textarea.js";

export interface FaqItemData {
  question: string;
  answer: string;
}

export interface FAQEditorProps {
  items: FaqItemData[];
  onChange: (items: FaqItemData[]) => void;
}

const WARN_BYTES = 3 * 1024;

/** Q/A list with a byte-size warning past ~3KB — Agent → FAQ (FRONTEND_SPEC.md §1.3/§6.6, latency-budget note SYSTEM_DESIGN §5). */
export function FAQEditor({ items, onChange }: FAQEditorProps) {
  const byteSize = useMemo(() => new TextEncoder().encode(JSON.stringify(items)).length, [items]);

  function updateItem(index: number, patch: Partial<FaqItemData>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-md border p-2 text-xs",
          byteSize > WARN_BYTES
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border text-muted-foreground",
        )}
      >
        {(byteSize / 1024).toFixed(1)} KB of FAQ content
        {byteSize > WARN_BYTES &&
          " — large FAQs may slow every call turn. We'll move this to a lookup tool automatically past this size."}
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: FaqItemData (canonical-types) has no stable id field
          <div key={index} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-start gap-2">
              <Input
                placeholder="Question"
                value={item.question}
                onChange={(e) => updateItem(index, { question: e.target.value })}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              placeholder="Answer"
              value={item.answer}
              onChange={(e) => updateItem(index, { answer: e.target.value })}
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, { question: "", answer: "" }])}
      >
        <Plus className="size-3.5" /> Add question
      </Button>
    </div>
  );
}
