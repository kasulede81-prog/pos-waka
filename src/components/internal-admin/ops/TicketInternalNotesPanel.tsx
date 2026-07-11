import { useEffect, useState } from "react";
import { addTicketInternalNote, fetchTicketInternalNotes, type SharedInternalNote } from "../../../lib/internalOpsHardening";

type Props = { ticketId: string };

export function TicketInternalNotesPanel({ ticketId }: Props) {
  const [notes, setNotes] = useState<SharedInternalNote[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchTicketInternalNotes(ticketId).then(setNotes);
  }, [ticketId]);

  const add = () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    void addTicketInternalNote(ticketId, body).then((r) => {
      setBusy(false);
      if (r.ok) {
        setBody("");
        void fetchTicketInternalNotes(ticketId).then(setNotes);
      }
    });
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
      <p className="text-xs font-black text-violet-900">Internal notes (shared)</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-border px-2 py-1.5 text-xs"
        placeholder="Staff note on this ticket…"
      />
      <button
        type="button"
        disabled={busy}
        onClick={add}
        className="min-h-[36px] w-full rounded-lg bg-violet-600 text-xs font-black text-white disabled:opacity-50"
      >
        Add note
      </button>
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-card px-2 py-1.5 text-xs">
            <p className="font-semibold text-foreground">{n.body}</p>
            <p className="text-[10px] text-muted-foreground">
              {n.author} · {new Date(n.created_at).toLocaleString("en-GB")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
