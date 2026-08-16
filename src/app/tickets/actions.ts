"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { PRIORITIES, TICKET_KINDS, TICKET_STATUSES } from "./ticket-bits";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Each kind numbers independently (BUG-001, FR-001, …) so the ref itself says
// what the ticket is. Same collision walk as invoice numbers: `ref` is unique,
// so a racing double-submit skips ahead instead of blowing up.
async function nextRef(kind: string): Promise<{ number: number; ref: string }> {
  const top = await prisma.ticket.aggregate({ where: { kind }, _max: { number: true } });
  const start = (top._max.number ?? 0) + 1;
  for (let n = start; n < start + 50; n++) {
    const ref = `${kind}-${String(n).padStart(3, "0")}`;
    const exists = await prisma.ticket.findUnique({ where: { ref } });
    if (!exists) return { number: n, ref };
  }
  return { number: start, ref: `${kind}-${Date.now()}` };
}

export async function createTicket(formData: FormData) {
  const kind = str(formData.get("kind"));
  if (!kind || !(TICKET_KINDS as readonly string[]).includes(kind)) {
    redirect("/tickets/new?error=missing");
  }
  const title = str(formData.get("title"));
  if (!title) redirect(`/tickets/new?error=missing&kind=${kind}`);

  // Screenshot is optional — a bug logged in ten seconds beats one never logged.
  const file = formData.get("attachment");
  const attachment = file instanceof File && file.size > 0 ? await saveUpload(file) : null;

  const priority = str(formData.get("priority"));
  const { number, ref } = await nextRef(kind);

  const ticket = await prisma.ticket.create({
    data: {
      ref,
      kind,
      number,
      title,
      description: str(formData.get("description")),
      attachmentPath: attachment?.storageKey ?? null,
      ...(priority && (PRIORITIES as readonly string[]).includes(priority) ? { priority } : {}),
    },
  });

  redirect(`/tickets/${ticket.id}`);
}

export async function updateTicket(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/tickets");

  const title = str(formData.get("title"));
  if (!title) redirect(`/tickets/${id}?error=missing`);

  const priority = str(formData.get("priority"));
  const status = str(formData.get("status"));

  await prisma.ticket.update({
    where: { id },
    data: {
      title,
      description: str(formData.get("description")),
      devNotes: str(formData.get("devNotes")),
      ...(priority && (PRIORITIES as readonly string[]).includes(priority) ? { priority } : {}),
      ...(status && (TICKET_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    },
  });

  redirect(`/tickets/${id}`);
}

export async function deleteTicket(formData: FormData) {
  const id = str(formData.get("id"));
  if (id) await prisma.ticket.delete({ where: { id } });
  redirect("/tickets");
}
