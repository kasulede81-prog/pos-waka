import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

export interface Staff {
  id: string;
  name: string;
  pin: string; // 4-6 digits
  role: "owner" | "cashier";
  createdAt: number;
}

interface StaffState {
  staff: Staff[];
  activeStaffId: string | null;
  addStaff: (name: string, pin: string, role?: Staff["role"]) => Staff;
  removeStaff: (id: string) => void;
  switchTo: (id: string, pin: string) => boolean;
  signOutStaff: () => void;
}

const idbStorage: StateStorage = {
  getItem: async (k) => (await idbGet(k)) ?? null,
  setItem: async (k, v) => { await idbSet(k, v); },
  removeItem: async (k) => { await idbDel(k); },
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useStaff = create<StaffState>()(
  persist(
    (set, get) => ({
      staff: [],
      activeStaffId: null,
      addStaff: (name, pin, role = "cashier") => {
        const s: Staff = { id: newId(), name, pin, role, createdAt: Date.now() };
        set((st) => ({
          staff: [s, ...st.staff],
          activeStaffId: st.activeStaffId ?? s.id,
        }));
        return s;
      },
      removeStaff: (id) =>
        set((st) => ({
          staff: st.staff.filter((s) => s.id !== id),
          activeStaffId: st.activeStaffId === id ? null : st.activeStaffId,
        })),
      switchTo: (id, pin) => {
        const s = get().staff.find((x) => x.id === id);
        if (!s || s.pin !== pin) return false;
        set({ activeStaffId: id });
        return true;
      },
      signOutStaff: () => set({ activeStaffId: null }),
    }),
    {
      name: "waka.staff",
      storage: createJSONStorage(() => idbStorage),
    },
  ),
);

export const activeStaff = () => {
  const { staff, activeStaffId } = useStaff.getState();
  return staff.find((s) => s.id === activeStaffId) ?? null;
};
