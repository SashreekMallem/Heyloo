"use client";

import { use } from "react";
import { TemplateEditor } from "./template-editor";

export default function TemplateEditorPage({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = use(params);
  return <TemplateEditor vertical={vertical} />;
}
