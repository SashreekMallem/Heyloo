"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@heyloo/ui";
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";

interface ParsedItem {
  name: string;
  category?: string;
  price_cents?: number;
  duration_minutes?: number;
  allergens?: string[];
  modifiers?: { name: string; price_cents?: number }[];
}

/**
 * Paste-or-upload menu import (GAP_REGISTER.md §4 Cluster E) — parsing
 * happens server-side via `api-menu-import` (Cluster G's edge function,
 * proxied by `POST /api/tenant/offerings/import`, this cluster's own
 * route); this page never invents structure client-side. Every parsed row
 * is shown for review/edit/removal before anything is written — nothing
 * reaches `offerings` until the tenant explicitly confirms, via the same
 * `offeringWriteSchema` validation a manual add goes through
 * (`POST /api/tenant/offerings/bulk`).
 */
export default function MenuImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState("");
  const [menuUrl, setMenuUrl] = useState("");
  const [pendingFile, setPendingFile] = useState<{
    media_type: string;
    data_base64: string;
  } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function handleFile(file: File) {
    setFileName(file.name);
    if (file.type === "application/pdf" || file.type.startsWith("image/")) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const data_base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setPendingFile({ media_type: file.type, data_base64 });
      setRawText("");
      return;
    }
    setPendingFile(null);
    const text = await file.text();
    setRawText(text);
  }

  async function runImport(body: unknown) {
    setParsing(true);
    setUnavailable(false);
    const res = await fetch("/api/tenant/offerings/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setParsing(false);
    if (res.status === 503) {
      setUnavailable(true);
      return;
    }
    if (!res.ok) {
      toast.error("Couldn't read that menu — please check the format and try again.");
      return;
    }
    const parsedBody = (await res.json()) as { items?: ParsedItem[] };
    setItems(parsedBody.items ?? []);
    if (!parsedBody.items || parsedBody.items.length === 0) {
      toast.error("No items found — try pasting plain text with one item per line.");
    }
  }

  async function parse() {
    if (pendingFile) {
      await runImport({ source: { kind: "file", ...pendingFile } });
      return;
    }
    if (!rawText.trim()) {
      toast.error("Paste your menu text or upload a file first.");
      return;
    }
    await runImport({ raw_text: rawText });
  }

  async function importFromUrl() {
    if (!menuUrl.trim()) {
      toast.error("Enter a menu URL first.");
      return;
    }
    await runImport({ source: { kind: "url", url: menuUrl.trim() } });
  }

  function removeItem(index: number) {
    setItems((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function updateItem(index: number, patch: Partial<ParsedItem>) {
    setItems((prev) =>
      prev ? prev.map((item, i) => (i === index ? { ...item, ...patch } : item)) : prev,
    );
  }

  async function confirmImport() {
    if (!items || items.length === 0) return;
    setConfirming(true);
    const res = await fetch("/api/tenant/offerings/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offerings: items.map((item) => ({
          name: item.name,
          category: item.category,
          price_cents: item.price_cents,
          duration_minutes: item.duration_minutes,
          metadata: { allergens: item.allergens ?? [], modifiers: item.modifiers ?? [] },
        })),
      }),
    });
    setConfirming(false);
    if (!res.ok) {
      toast.error("Couldn't import — please try again.");
      return;
    }
    const body = (await res.json()) as { created?: number };
    toast.success(`Added ${body.created ?? items.length} items to your menu`);
    router.push("/dashboard/setup/offerings");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import menu"
        description="Paste your menu below, upload a file (text, PDF, or a photo), or import from a URL — you'll review every item before anything is added."
      />

      {!items && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Textarea
              rows={12}
              placeholder={
                "e.g.\nMargherita Pizza — $14.00 — tomato, mozzarella, basil\nCaesar Salad — $9.50 — contains dairy, gluten"
              }
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Upload a menu file (text, PDF, or photo)"
                accept=".txt,.csv,.md,image/*,application/pdf"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" /> Choose file
              </Button>
              <span className="truncate text-sm text-muted-foreground">
                {fileName ?? "No file chosen"}
              </span>
              <Button onClick={parse} disabled={parsing}>
                {parsing ? "Reading menu…" : "Parse menu"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Input
                type="url"
                placeholder="https://example.com/menu"
                value={menuUrl}
                onChange={(e) => setMenuUrl(e.target.value)}
                className="max-w-xs"
              />
              <Button variant="outline" onClick={importFromUrl} disabled={parsing}>
                {parsing ? "Reading menu…" : "Import from URL"}
              </Button>
            </div>
            {unavailable && (
              <p className="text-sm text-destructive">
                Menu import isn&apos;t available yet — please add items manually from the Offerings
                page for now, or try again shortly.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {items && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Review {items.length} item{items.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing parsed — go back and try different text.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Allergens</TableHead>
                      <TableHead className="text-right">Remove</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are reordered by index-based removal, not by identity
                      <TableRow key={i}>
                        <TableCell>
                          <Input
                            value={item.name}
                            onChange={(e) => updateItem(i, { name: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.category ?? ""}
                            onChange={(e) => updateItem(i, { category: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          {item.price_cents != null ? formatCentsUSD(item.price_cents) : "—"}
                        </TableCell>
                        <TableCell>
                          {(item.allergens ?? []).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {(item.allergens ?? []).map((a) => (
                                <Badge key={a} variant="destructive">
                                  {a}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(i)}
                            aria-label={`Remove ${item.name || `item ${i + 1}`}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setItems(null)}>
                Start over
              </Button>
              <Button onClick={confirmImport} disabled={confirming || items.length === 0}>
                {confirming
                  ? "Adding…"
                  : `Add ${items.length} item${items.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
