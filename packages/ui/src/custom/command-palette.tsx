"use client";

import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../primitives/command.js";

export interface CommandPaletteCommand {
  label: string;
  group?: string;
  run: () => void;
}

/** ⌘K palette, admin topbar only (FRONTEND_SPEC.md §1.3/§9.5). */
export function CommandPalette({ commands }: { commands: CommandPaletteCommand[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = new Map<string, CommandPaletteCommand[]>();
  for (const command of commands) {
    const key = command.group ?? "Commands";
    const list = groups.get(key) ?? [];
    list.push(command);
    groups.set(key, list);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a tenant, page, or action…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {[...groups.entries()].map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((command) => (
              <CommandItem
                key={command.label}
                onSelect={() => {
                  command.run();
                  setOpen(false);
                }}
              >
                {command.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
