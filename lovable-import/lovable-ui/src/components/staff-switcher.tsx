import { useState } from "react";
import { Users, X, Plus, Trash2, KeyRound } from "lucide-react";
import { useStaff } from "@/lib/staff-store";

export function StaffSwitcher() {
  const { staff, activeStaffId, addStaff, removeStaff, switchTo, signOutStaff } = useStaff();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "pin" | "add">("list");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [err, setErr] = useState("");

  const active = staff.find((s) => s.id === activeStaffId) ?? null;

  const openSwitch = (id: string) => {
    setPendingId(id);
    setPin("");
    setErr("");
    setMode("pin");
  };

  const confirmPin = () => {
    if (!pendingId) return;
    if (switchTo(pendingId, pin)) {
      setOpen(false);
      setMode("list");
      setPin("");
    } else {
      setErr("Wrong PIN");
    }
  };

  const handleAdd = () => {
    if (!name.trim() || newPin.length < 4) {
      setErr("Name + 4+ digit PIN required");
      return;
    }
    addStaff(name.trim(), newPin, staff.length === 0 ? "owner" : "cashier");
    setName(""); setNewPin(""); setErr("");
    setMode("list");
  };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setMode("list"); setErr(""); }}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-foreground/80 hover:bg-muted"
        title="Switch staff"
      >
        <Users className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{active ? active.name : "Staff"}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-background p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">
                {mode === "pin" ? "Enter PIN" : mode === "add" ? "Add staff" : "Switch staff"}
              </h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            {mode === "list" && (
              <>
                {staff.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No staff yet. Add yourself as owner, then add cashiers with their own PIN.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {staff.map((s) => (
                      <li
                        key={s.id}
                        className={`flex items-center justify-between rounded-2xl border p-3 ${
                          s.id === activeStaffId ? "border-waka-500 bg-waka-50" : "border-border"
                        }`}
                      >
                        <button
                          onClick={() => openSwitch(s.id)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-waka-100 text-sm font-black text-waka-700">
                            {s.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <span className="block text-sm font-bold">{s.name}</span>
                            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                              {s.role} {s.id === activeStaffId ? "· active" : ""}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => removeStaff(s.id)}
                          className="rounded-full p-1.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => { setMode("add"); setErr(""); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground"
                  >
                    <Plus className="h-4 w-4" /> Add staff
                  </button>
                  {active && (
                    <button
                      onClick={() => { signOutStaff(); setOpen(false); }}
                      className="rounded-full border border-border px-4 py-2.5 text-sm font-bold"
                    >
                      Lock
                    </button>
                  )}
                </div>
              </>
            )}

            {mode === "pin" && (
              <div className="mt-4">
                <KeyRound className="mx-auto h-8 w-8 text-waka-700" />
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  Enter PIN for{" "}
                  <span className="font-bold text-foreground">
                    {staff.find((s) => s.id === pendingId)?.name}
                  </span>
                </p>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && confirmPin()}
                  className="mt-4 w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-2xl font-black tracking-widest outline-none focus:border-primary"
                  maxLength={6}
                />
                {err && <p className="mt-2 text-center text-sm text-destructive">{err}</p>}
                <button
                  onClick={confirmPin}
                  className="mt-4 w-full rounded-full bg-waka-600 py-3 text-sm font-bold text-primary-foreground"
                >
                  Unlock
                </button>
                <button
                  onClick={() => setMode("list")}
                  className="mt-2 w-full rounded-full px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}

            {mode === "add" && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Name</label>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">PIN (4–6 digits)</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-xl tracking-widest"
                  />
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <button
                  onClick={handleAdd}
                  className="w-full rounded-full bg-waka-600 py-3 text-sm font-bold text-primary-foreground"
                >
                  Save
                </button>
                <button
                  onClick={() => setMode("list")}
                  className="w-full rounded-full px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
